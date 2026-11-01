"""worker-match's database side over a direct connection (local stack, 02 §3).

Writes ingredient_match rows. A GTIN or rule match with a known conversion is confirmed through
public.confirm_ingredient_match (which writes the CST-01 price); every other match stays `suggested` and
writes no price (D02, D14).
"""

from __future__ import annotations

import os
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .ai import AiLine, Suggester, supplier_for_prompt, unit_price_text
from .matching import CatalogItem, LineIn, Rule, auto_match, conversion_factor, learned_rule, normalize

LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


def connect(url: str = LOCAL_DB_URL) -> Any:
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(url, autocommit=True, row_factory=dict_row)


def catalog(conn: Any) -> list[CatalogItem]:
    rows = conn.execute("select id, name, category, base_unit::text, gtin from public.ingredient").fetchall()
    return [
        CatalogItem(str(r["id"]), r["name"], r["category"], r["base_unit"], frozenset(r["gtin"] or []))
        for r in rows
    ]


def rules(conn: Any) -> list[Rule]:
    rows = conn.execute(
        "select id, ingredient_id, keywords, ncm_prefix, unit from public.ingredient_rule"
    ).fetchall()
    return [
        Rule(str(r["id"]), str(r["ingredient_id"]), tuple(r["keywords"]), r["ncm_prefix"], r["unit"])
        for r in rows
    ]


def learn_rules(conn: Any) -> int:
    """D14: every match a person confirmed (AI or manual) becomes a rule for the next client."""
    rows = conn.execute(
        """select distinct il.description, il.ncm, il.unit, m.ingredient_id, m.confirmed_by
           from public.ingredient_match m join public.invoice_line il on il.id = m.invoice_line_id
           where m.status = 'confirmed' and m.method in ('ai', 'manual')"""
    ).fetchall()
    added = 0
    for r in rows:
        rule = learned_rule(r["description"], r["ncm"], r["unit"], str(r["ingredient_id"]))
        cur = conn.execute(
            """insert into public.ingredient_rule (ingredient_id, keywords, ncm_prefix, unit, source, created_by)
               values (%s, %s, %s, %s, 'confirmation', %s)
               on conflict (ingredient_id, keywords, ncm_prefix, unit) do nothing""",
            (rule.ingredient_id, list(rule.keywords), rule.ncm_prefix, rule.unit, r["confirmed_by"]),
        )
        added += cur.rowcount
    return added


@dataclass(frozen=True)
class PendingLine:
    line: LineIn
    has_any_match: bool
    ai_allowed: bool
    ai_asked: bool


def pending_lines(conn: Any, account_id: str) -> list[PendingLine]:
    """Lines of the account with no suggested or confirmed match. ai_allowed: synthetic account, or the
    buyer company's owner_authorization includes AI processing (D48)."""
    rows = conn.execute(
        """select il.id, il.description, il.ncm, il.gtin, il.unit, il.qty, il.total_cents,
                  i.issuer_cnpj, i.issuer_name,
                  exists (select 1 from public.ingredient_match m where m.invoice_line_id = il.id) as has_any,
                  il.ai_asked_at is not null as ai_asked,
                  (a.is_synthetic or exists (select 1 from public.owner_authorization oa
                                             where oa.company_id = i.company_id and oa.includes_ai)) as ai_allowed
           from public.invoice_line il
           join public.invoice i on i.id = il.invoice_id
           join public.account a on a.id = il.account_id
           where il.account_id = %s
             and not exists (select 1 from public.ingredient_match m
                             where m.invoice_line_id = il.id and m.status in ('suggested', 'confirmed'))
           order by il.id""",
        (account_id,),
    ).fetchall()
    return [
        PendingLine(
            LineIn(
                str(r["id"]),
                r["description"],
                r["ncm"],
                r["gtin"],
                r["unit"],
                r["issuer_cnpj"],
                r["issuer_name"],
                r["qty"],
                r["total_cents"],
            ),
            r["has_any"],
            r["ai_allowed"],
            r["ai_asked"],
        )
        for r in rows
    ]


def _insert_match(
    conn: Any,
    account_id: str,
    line_id: str,
    ingredient_id: str,
    method: str,
    conversion: Decimal | None,
    rule_note: str | None = None,
    confidence: Decimal | None = None,
) -> str | None:
    row = conn.execute(
        """insert into public.ingredient_match
             (account_id, invoice_line_id, ingredient_id, method, status, conversion_factor, rule_note, confidence)
           values (%s, %s, %s, %s, 'suggested', %s, %s, %s)
           on conflict (invoice_line_id, ingredient_id) do nothing returning id""",
        (account_id, line_id, ingredient_id, method, conversion, rule_note, confidence),
    ).fetchone()
    return str(row["id"]) if row else None


@dataclass
class Counts:
    auto_confirmed: int = 0
    auto_suggested: int = 0
    ai_suggested: int = 0
    ai_lines_sent: int = 0
    left: int = 0


def run_auto(conn: Any, account_id: str) -> Counts:
    """D14 steps 1 and 2 for every pending line of the account."""
    cat, rs = catalog(conn), rules(conn)
    c = Counts()
    for p in pending_lines(conn, account_id):
        m = auto_match(p.line, cat, rs)
        if m is None:
            c.left += 1
            continue
        with conn.transaction():
            mid = _insert_match(
                conn, account_id, m.line_id, m.ingredient_id, m.method, m.conversion_factor, m.rule_note
            )
            if mid and m.conversion_factor:
                conn.execute("select public.confirm_ingredient_match(%s, null, null)", (mid,))
                c.auto_confirmed += 1
            elif mid:
                c.auto_suggested += 1
    return c


def _ai_line(ref: str, line: LineIn) -> AiLine:
    """What the model sees of a line (06 §6): no ids, no CNPJ, no CPF issuer name."""
    return AiLine(
        ref,
        line.description,
        line.ncm,
        line.unit,
        supplier_for_prompt(line.issuer_cnpj, line.issuer_name),
        unit_price_text(line.total_cents, line.qty, line.unit),
    )


def run_ai(conn: Any, account_id: str, suggester: Suggester) -> Counts:
    """D14 step 3: one question per distinct line text (description, NCM, unit) of lines never sent before
    (invoice_line.ai_asked_at), with the supplier name and unit price of the first line with that text (06 §6);
    the answer is stored as `suggested` on every line with that text. No price is written (D02)."""
    cat = catalog(conn)
    by_id = {x.id: x for x in cat}
    groups: dict[tuple[str, str | None, str], list[LineIn]] = defaultdict(list)
    for p in pending_lines(conn, account_id):
        if p.has_any_match or p.ai_asked or not p.ai_allowed:
            continue
        groups[(normalize(p.line.description), p.line.ncm, normalize(p.line.unit))].append(p.line)
    c = Counts()
    if not groups or not cat:
        return c
    keys = list(groups)
    ai_lines = [_ai_line(str(i), groups[k][0]) for i, k in enumerate(keys)]
    c.ai_lines_sent = len(ai_lines)
    answers = suggester.suggest(ai_lines, cat)
    asked = [line.id for k in keys for line in groups[k]]
    conn.execute("update public.invoice_line set ai_asked_at = now() where id = any(%s::uuid[])", (asked,))
    for s in answers:
        base = by_id[s.ingredient_id].base_unit
        for line in groups[keys[int(s.ref)]]:
            conv = conversion_factor(line.description, line.unit, base) or s.conversion_factor
            if _insert_match(conn, account_id, line.id, s.ingredient_id, "ai", conv, None, s.confidence):
                c.ai_suggested += 1
    return c


def enqueue_match(conn: Any, account_id: str) -> None:
    """One match_ai job per account at a time (dedupe key); the runner checks m3.depara_ia (A05)."""
    conn.execute(
        """insert into public.job (type, payload, account_id, dedupe_key)
           values ('match_ai', jsonb_build_object('account_id', %s::text), %s, %s)
           on conflict (type, dedupe_key) where dedupe_key is not null and status in ('queued', 'running')
           do nothing""",
        (account_id, account_id, f"match_ai:{account_id}"),
    )
