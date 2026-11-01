"""worker-match's database side over a direct connection (local stack, 02 §3).

Writes ingredient_match rows. A GTIN or auto-confirming rule match with a known conversion is
confirmed through public.confirm_ingredient_match (which writes the CST-01 price); every other match stays
`suggested` and writes no price (D02, D14). Rules are learned per account and globally (learn_rules).
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


def rules(conn: Any, account_id: str | None = None) -> list[Rule]:
    """Catalog and learned global rules, plus the account's own rules when account_id is given (D14)."""
    rows = conn.execute(
        "select id, ingredient_id, keywords, ncm_prefix, unit, source, auto_confirm from public.ingredient_rule"
    ).fetchall()
    out = [
        Rule(
            str(r["id"]),
            str(r["ingredient_id"]),
            tuple(r["keywords"]),
            r["ncm_prefix"],
            r["unit"],
            "catalog" if r["source"] == "catalog" else "global",
            r["source"] == "catalog" or bool(r["auto_confirm"]),
        )
        for r in rows
    ]
    if account_id is not None:
        rows = conn.execute(
            """select id, ingredient_id, keywords, ncm_prefix, unit from public.ingredient_account_rule
               where account_id = %s""",
            (account_id,),
        ).fetchall()
        out += [
            Rule(
                str(r["id"]),
                str(r["ingredient_id"]),
                tuple(r["keywords"]),
                r["ncm_prefix"],
                r["unit"],
                "account",
            )
            for r in rows
        ]
    return out


def param(conn: Any, key: str) -> Decimal:
    """A rule_param value (04: values marked param)."""
    row = conn.execute("select value from public.rule_param where key = %s", (key,)).fetchone()
    if row is None:
        raise LookupError(f"rule_param {key} is missing")
    return Decimal(row["value"])


def learn_rules(conn: Any) -> int:
    """D14 (Marlon, 31/out): each confirmation by a person, counted once (ingredient_match.learned_at),
    creates or reinforces a rule of its account and counts toward the same global rule. A global rule picked
    against (a person chose another ingredient for a line it matches) is disputed: suggest only, flagged
    for a founder in C11. A learned global rule auto-confirms once m3.global_rule_min_accounts distinct
    accounts hold it and it is not disputed. Catalog rules are never touched. Returns global rules added."""
    min_accounts = param(conn, "m3.global_rule_min_accounts")
    rows = conn.execute(
        """select m.id, m.account_id, m.ingredient_id, m.confirmed_by, il.description, il.ncm, il.unit
           from public.ingredient_match m join public.invoice_line il on il.id = m.invoice_line_id
           where m.status = 'confirmed' and m.confirmed_by is not null and m.learned_at is null
           order by m.updated_at, m.id"""
    ).fetchall()
    added = 0
    for r in rows:
        rule = learned_rule(r["description"], r["ncm"], r["unit"], str(r["ingredient_id"]))
        line = LineIn(str(r["id"]), r["description"], r["ncm"], None, r["unit"])
        with conn.transaction():
            for g in rules(conn):
                if g.scope == "global" and g.ingredient_id != rule.ingredient_id and g.matches(line):
                    conn.execute(
                        """update public.ingredient_rule
                              set auto_confirm = false, disputed_at = now(), disputed_ingredient_id = %s
                            where id = %s and disputed_at is null""",
                        (rule.ingredient_id, g.id),
                    )
            conn.execute(
                """insert into public.ingredient_account_rule (account_id, ingredient_id, keywords, ncm_prefix, unit, created_by)
                   values (%s, %s, %s, %s, %s, %s)
                   on conflict (account_id, ingredient_id, keywords, ncm_prefix, unit)
                   do update set confirmations = public.ingredient_account_rule.confirmations + 1""",
                (
                    r["account_id"],
                    rule.ingredient_id,
                    list(rule.keywords),
                    rule.ncm_prefix,
                    rule.unit,
                    r["confirmed_by"],
                ),
            )
            cur = conn.execute(
                """insert into public.ingredient_rule (ingredient_id, keywords, ncm_prefix, unit, source)
                   values (%s, %s, %s, %s, 'confirmation')
                   on conflict (ingredient_id, keywords, ncm_prefix, unit) do nothing""",
                (rule.ingredient_id, list(rule.keywords), rule.ncm_prefix, rule.unit),
            )
            added += cur.rowcount
            conn.execute("update public.ingredient_match set learned_at = now() where id = %s", (r["id"],))
    conn.execute(
        """update public.ingredient_rule g
              set auto_confirm = v.auto
             from (select g2.id,
                          g2.disputed_at is null and
                          (select count(distinct a.account_id) from public.ingredient_account_rule a
                            where a.ingredient_id = g2.ingredient_id and a.keywords = g2.keywords
                              and a.ncm_prefix is not distinct from g2.ncm_prefix
                              and a.unit is not distinct from g2.unit) >= %s as auto
                     from public.ingredient_rule g2 where g2.source = 'confirmation') v
            where v.id = g.id and g.auto_confirm is distinct from v.auto""",
        (min_accounts,),
    )
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
    """D14 steps 1 and 2 for every pending line of the account. A suggest-only rule match (a global rule not
    yet agreed by enough accounts, or rules in conflict) stays `suggested` and writes no price (D02)."""
    cat, rs = catalog(conn), rules(conn, account_id)
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
            if mid and m.conversion_factor and not m.suggest_only:
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
