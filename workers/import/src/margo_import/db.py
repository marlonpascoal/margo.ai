"""worker-import's database side, over a direct connection to the local stack (02 §3, local env).

Reads layouts, stores and facts; writes canonical rows with natural keys (on conflict do nothing, D31),
the monthly close, differences and contestations. Contestations move only through
public.contestation_mark (04 §3).
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from .claims import claim_text
from .close import StoreMonth, compute_close
from .contestation import Contested, Credit, match_credits
from .layout import SAO_PAULO, Mapping_, Parsed, month_bounds
from .rules import Campaign, Entry, Order, Params, Terms, initial_status

LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


def connect(url: str = LOCAL_DB_URL) -> Any:
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(url, autocommit=True, row_factory=dict_row)


# Layouts and stores ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class SavedMapping:
    id: str
    signature: str
    name: str
    mapping: Mapping_


def mappings(conn: Any, channel: str) -> list[SavedMapping]:
    rows = conn.execute(
        "select id, file_signature, name, mapping from public.column_mapping where channel = %s order by created_at",
        (channel,),
    ).fetchall()
    return [
        SavedMapping(str(r["id"]), r["file_signature"], r["name"], Mapping_.from_json(r["mapping"]))
        for r in rows
    ]


@dataclass(frozen=True)
class StoreRef:
    id: str
    company_id: str | None
    authorized_company: bool


def stores(conn: Any, account_id: str, channel: str) -> dict[str, StoreRef]:
    """External id to store, with whether its CNPJ has an owner_authorization (C06)."""
    rows = conn.execute(
        """
        select cs.id, cs.external_id, k.company_id,
               exists (select 1 from public.owner_authorization oa
                       where oa.account_id = cs.account_id and oa.company_id = k.company_id) as authorized
        from public.channel_store cs left join public.kitchen k on k.id = cs.kitchen_id
        where cs.account_id = %s and cs.channel = %s
        """,
        (account_id, channel),
    ).fetchall()
    return {
        r["external_id"]: StoreRef(
            str(r["id"]), str(r["company_id"]) if r["company_id"] else None, r["authorized"]
        )
        for r in rows
    }


def authorized_cnpjs(conn: Any, account_id: str) -> set[str]:
    rows = conn.execute(
        """select c.cnpj from public.company c
           where c.account_id = %s and exists (select 1 from public.owner_authorization oa where oa.company_id = c.id)""",
        (account_id,),
    ).fetchall()
    return {r["cnpj"] for r in rows}


def is_synthetic(conn: Any, account_id: str) -> bool:
    row = conn.execute("select is_synthetic from public.account where id = %s", (account_id,)).fetchone()
    return bool(row and row["is_synthetic"])


def params(conn: Any) -> tuple[Params, dict[str, int], Decimal]:
    v = {r["key"]: r["value"] for r in conn.execute("select key, value from public.rule_param").fetchall()}
    p = Params(
        min_shown_cents=int(v.get("m2.dif_min_cents", 500)),
        dif04_grace_days=int(v.get("m2.dif04_grace_days", 7)),
        rounding_tolerance_cents=int(v.get("m2.rounding_tolerance_cents", 1)),
    )
    deadlines = {k.rsplit(".", 1)[1]: int(val) for k, val in v.items() if k.startswith("m2.deadline_days.")}
    return p, deadlines, Decimal(str(v.get("m2.credit_match_pct", "0.10")))


# Canonical rows -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class WriteCounts:
    rows_new: int
    rows_duplicate: int
    canonical_new: int


def write_parsed(
    conn: Any, account_id: str, run_id: str, parsed: Parsed, refs: dict[str, StoreRef]
) -> WriteCounts:
    """Insert every canonical row; existing natural keys are left alone (D31). A file row is "new" when
    it produced at least one new canonical row, else duplicate (C07)."""
    new_keys: set[tuple[str, ...]] = set()
    with conn.transaction():
        cur = conn.cursor()
        for (store, order), o in parsed.orders.items():
            row = cur.execute(
                """insert into public.order_fact (account_id, channel_store_id, external_order_id, ordered_at, gross_cents,
                     items_cents, delivery_fee_cents, discount_store_cents, discount_channel_cents, status, cancelled_by,
                     cancel_reason, import_run_id)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (channel_store_id, external_order_id) do nothing returning id""",
                (
                    account_id,
                    refs[store].id,
                    order,
                    o.ordered_at,
                    o.gross_cents,
                    o.items_cents,
                    o.delivery_fee_cents,
                    o.discount_store_cents,
                    o.discount_channel_cents,
                    o.status,
                    o.cancelled_by,
                    o.cancel_reason,
                    run_id,
                ),
            ).fetchone()
            if row:
                new_keys.add(("order", store, order))
        ids = {
            (r["channel_store_id"], r["external_order_id"]): str(r["id"])
            for r in cur.execute(
                "select id, channel_store_id::text, external_order_id from public.order_fact where account_id = %s"
                " and channel_store_id = any(%s)",
                (account_id, [refs[s].id for s in parsed.store_exts]),
            ).fetchall()
        }
        for (store, order, n), it in parsed.items.items():
            row = cur.execute(
                """insert into public.order_item_fact (account_id, order_fact_id, line_no, item_name, qty, unit_price_cents)
                   values (%s, %s, %s, %s, %s, %s) on conflict (order_fact_id, line_no) do nothing returning id""",
                (account_id, ids[(refs[store].id, order)], n, it.item_name, it.qty, it.unit_price_cents),
            ).fetchone()
            if row:
                new_keys.add(("item", store, order, str(n)))
        for (store, key), e in parsed.entries.items():
            order_id = ids.get((refs[store].id, e.external_order_id)) if e.external_order_id else None
            row = cur.execute(
                """insert into public.ledger_entry (account_id, channel_store_id, external_entry_id, order_fact_id,
                     entry_date, expected_payment_date, type, raw_type, amount_cents, import_run_id)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (channel_store_id, external_entry_id) do nothing returning id""",
                (
                    account_id,
                    refs[store].id,
                    key,
                    order_id,
                    e.entry_date,
                    e.expected_payment_date,
                    e.type,
                    e.raw_type,
                    e.amount_cents,
                    run_id,
                ),
            ).fetchone()
            if row:
                new_keys.add(("entry", store, key))
    rows_new = sum(1 for keys in parsed.row_keys if any(k in new_keys for k in keys))
    return WriteCounts(rows_new, parsed.rows_in_file - rows_new, len(new_keys))


# Close ----------------------------------------------------------------------------------------------


def _d(x: Any) -> Decimal:
    return Decimal(str(x))


def load_month(conn: Any, account_id: str, month: date) -> list[StoreMonth]:
    """C19: only stores linked to a kitchen in analysis count for the close."""
    start, end = month_bounds(month)
    store_rows = conn.execute(
        """select cs.id::text, cs.channel::text from public.channel_store cs join public.kitchen k on k.id = cs.kitchen_id
           where cs.account_id = %s and k.in_analysis order by cs.id""",
        (account_id,),
    ).fetchall()
    out = []
    for s in store_rows:
        sid = s["id"]
        terms = [
            Terms(
                _d(r["commission_pct"]),
                _d(r["payment_fee_pct"]),
                r["delivery_model"],
                r["valid_from"],
                r["valid_to"],
            )
            for r in conn.execute(
                "select commission_pct, payment_fee_pct, delivery_model::text, valid_from, valid_to"
                " from public.contract_terms where channel_store_id = %s",
                (sid,),
            ).fetchall()
        ]
        campaigns = [
            Campaign(
                str(r["id"]),
                sid,
                _d(r["discount_pct"]),
                _d(r["channel_share_pct"]),
                r["starts_on"],
                r["ends_on"],
            )
            for r in conn.execute(
                "select id, discount_pct, channel_share_pct, starts_on, ends_on from public.campaign where channel_store_id = %s",
                (sid,),
            ).fetchall()
        ]
        orders = [
            Order(
                id=str(r["id"]),
                store_id=sid,
                external_id=r["external_order_id"],
                ordered_on=r["day"],
                gross_cents=r["gross_cents"],
                items_cents=r["items_cents"],
                delivery_fee_cents=r["delivery_fee_cents"],
                discount_store_cents=r["discount_store_cents"],
                discount_channel_cents=r["discount_channel_cents"],
                status=r["status"],
                cancelled_by=r["cancelled_by"],
                cancel_reason=r["cancel_reason"],
            )
            for r in conn.execute(
                """select id, external_order_id, (ordered_at at time zone 'America/Sao_Paulo')::date as day, gross_cents,
                          items_cents, delivery_fee_cents, discount_store_cents, discount_channel_cents, status::text,
                          cancelled_by::text, cancel_reason
                   from public.order_fact where channel_store_id = %s
                     and (ordered_at at time zone 'America/Sao_Paulo')::date between %s and %s""",
                (sid, start, end),
            ).fetchall()
        ]
        order_ids = [o.id for o in orders]
        by_order: dict[str, list[Entry]] = defaultdict(list)
        for r in conn.execute(
            """select id, order_fact_id, entry_date, type::text, amount_cents, expected_payment_date
               from public.ledger_entry where order_fact_id = any(%s::uuid[])""",
            (order_ids,),
        ).fetchall():
            by_order[str(r["order_fact_id"])].append(
                Entry(
                    str(r["id"]),
                    sid,
                    str(r["order_fact_id"]),
                    r["entry_date"],
                    r["type"],
                    r["amount_cents"],
                    r["expected_payment_date"],
                )
            )
        month_entries = [
            Entry(
                str(r["id"]),
                sid,
                str(r["order_fact_id"]) if r["order_fact_id"] else None,
                r["entry_date"],
                r["type"],
                r["amount_cents"],
                r["expected_payment_date"],
            )
            for r in conn.execute(
                """select id, order_fact_id, entry_date, type::text, amount_cents, expected_payment_date
                   from public.ledger_entry where channel_store_id = %s and entry_date between %s and %s""",
                (sid, start, end),
            ).fetchall()
        ]
        out.append(StoreMonth(sid, s["channel"], terms, campaigns, orders, dict(by_order), month_entries))
    return out


def months_touched(parsed: Parsed) -> set[date]:
    days = {o.ordered_at.astimezone(SAO_PAULO).date() for o in parsed.orders.values()}
    days |= {e.entry_date for e in parsed.entries.values()}
    return {d.replace(day=1) for d in days}


def recompute_close(conn: Any, account_id: str, month: date, as_of: date) -> dict[str, int]:
    """Close lines, differences and new contestations of one month (C08, C09, C16). Idempotent."""
    p, deadlines, _ = params(conn)
    stores_month = load_month(conn, account_id, month)
    if not any(s.orders or s.month_entries for s in stores_month):
        return {"lines": 0, "differences": 0}
    result = compute_close(stores_month, p, as_of)
    channel_of = {s.store_id: s.channel for s in stores_month}
    order_day = {o.id: o.ordered_on for s in stores_month for o in s.orders}
    created = 0
    with conn.transaction():
        cp = conn.execute(
            """insert into public.close_period (account_id, kitchen_id, month) values (%s, null, %s)
               on conflict (account_id, kitchen_id, month) do update set updated_at = now() returning id""",
            (account_id, month),
        ).fetchone()["id"]
        conn.execute("delete from public.close_line where close_period_id = %s", (cp,))
        for line in result.lines:
            conn.execute(
                """insert into public.close_line (account_id, close_period_id, channel_store_id, gross_cents, commission_cents,
                     payment_cents, delivery_cents, promotion_cents, anticipation_cents, payout_cents)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    account_id,
                    cp,
                    line.store_id,
                    line.gross_cents,
                    line.commission_cents,
                    line.payment_cents,
                    line.delivery_cents,
                    line.promotion_cents,
                    line.anticipation_cents,
                    line.payout_cents,
                ),
            )
        keep: list[str] = []
        for x in result.findings:
            shown = x.rule_id in result.shown
            detail = {**x.detail, "short": x.short}
            d = conn.execute(
                """insert into public.difference (account_id, close_period_id, channel_store_id, rule_id, finding_key,
                     description, orders_count, amount_cents, confidence, shown, detail)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (close_period_id, channel_store_id, finding_key) do update set
                     description = excluded.description, orders_count = excluded.orders_count,
                     amount_cents = excluded.amount_cents, confidence = excluded.confidence,
                     shown = excluded.shown, detail = excluded.detail
                   returning id""",
                (
                    account_id,
                    cp,
                    x.store_id,
                    x.rule_id,
                    x.finding_key,
                    x.description,
                    x.orders_count,
                    x.amount_cents,
                    x.confidence,
                    shown,
                    json.dumps(detail, default=str),
                ),
            ).fetchone()["id"]
            keep.append(str(d))
            conn.execute("delete from public.difference_order where difference_id = %s", (d,))
            conn.cursor().executemany(
                "insert into public.difference_order (account_id, difference_id, order_fact_id, amount_cents)"
                " values (%s, %s, %s, %s)",
                [(account_id, d, oid, a) for oid, a in x.orders],
            )
            status = initial_status(x)
            if shown and status:
                last = max(order_day[oid] for oid, _ in x.orders)
                days = deadlines.get(channel_of[x.store_id], 30)
                deadline = date.fromordinal(last.toordinal() + days)
                row = conn.execute(
                    """insert into public.contestation (account_id, difference_id, status, deadline_on, claim_text)
                       values (%s, %s, %s, %s, %s) on conflict (difference_id) do nothing returning id""",
                    (account_id, d, status, deadline, claim_text(x, month, channel_of[x.store_id])),
                ).fetchone()
                created += 1 if row else 0
        # A difference no longer found goes away unless someone already acted on it.
        conn.execute(
            """delete from public.difference d where d.close_period_id = %s and not (d.id = any(%s::uuid[]))
               and not exists (select 1 from public.contestation c where c.difference_id = d.id
                               and (c.marked_at is not null or c.closed_at is not null))""",
            (cp, keep),
        )
    return {"lines": len(result.lines), "differences": len(result.findings), "contestations_created": created}


def settle_contestations(conn: Any, account_id: str, as_of: date) -> dict[str, int]:
    """04 §3 system transitions: creditada when the credit shows in the repasse; prazo_vencido after the deadline."""
    _, _, tolerance = params(conn)
    contested = [
        Contested(str(r["id"]), str(r["channel_store_id"]), r["amount_cents"], r["marked_at"])
        for r in conn.execute(
            """select c.id, d.channel_store_id, d.amount_cents, c.marked_at from public.contestation c
               join public.difference d on d.id = c.difference_id
               where c.account_id = %s and c.status = 'contestada' and c.closed_at is null""",
            (account_id,),
        ).fetchall()
    ]
    credited = 0
    if contested:
        used = {
            str(r["credited_entry_id"])
            for r in conn.execute(
                "select credited_entry_id from public.contestation where account_id = %s and credited_entry_id is not null",
                (account_id,),
            ).fetchall()
        }
        since = min(k.marked_at for k in contested).astimezone(SAO_PAULO).date()
        credits = [
            Credit(str(r["id"]), str(r["channel_store_id"]), r["type"], r["amount_cents"], r["entry_date"])
            for r in conn.execute(
                """select id, channel_store_id, type::text, amount_cents, entry_date from public.ledger_entry
                   where account_id = %s and type in ('adjustment', 'refund') and amount_cents > 0 and entry_date >= %s""",
                (account_id, since),
            ).fetchall()
            if str(r["id"]) not in used
        ]
        for cid, entry_id in match_credits(contested, credits, tolerance):
            conn.execute(
                "select public.contestation_mark(%s, 'credito_encontrado', 'system', null, null, %s)",
                (cid, entry_id),
            )
            credited += 1
    expired = conn.execute(
        """select id from public.contestation where account_id = %s and status = 'a_contestar'
           and closed_at is null and deadline_on < %s""",
        (account_id, as_of),
    ).fetchall()
    for r in expired:
        conn.execute("select public.contestation_mark(%s, 'prazo_passou', 'system')", (r["id"],))
    return {"credited": credited, "expired": len(expired)}


def today_sao_paulo(now: datetime | None = None) -> date:
    return (now or datetime.now(SAO_PAULO)).astimezone(SAO_PAULO).date()


def update_run(conn: Any, run_id: str, **fields: Any) -> None:
    sets = ", ".join(f"{k} = %s" for k in fields)
    values = [json.dumps(v, default=str) if k == "log" else v for k, v in fields.items()]
    conn.execute(f"update public.import_run set {sets} where id = %s", (*values, run_id))  # noqa: S608 (keys are ours)


def iter_months(days: Iterable[date]) -> list[date]:
    return sorted({d.replace(day=1) for d in days})
