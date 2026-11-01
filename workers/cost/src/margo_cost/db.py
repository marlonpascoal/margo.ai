"""worker-cost and the database: read one close's inputs, write what compute_close returns.

Cost reads only prices of confirmed matches (D14): an invoice price whose line is not confirmed to that
ingredient is ignored, and `sync_invoice_prices` removes it. Every write here is the system's (the job), so
it carries no audit row; people's edits (C12) are audited by the web action that queues the job.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from .compute import (
    CampaignIn,
    ChannelClose,
    CloseInputs,
    CloseResult,
    MenuItem,
    RecipeIn,
    RecipeLineIn,
    SoldLine,
    StoreIn,
    compute_close,
)
from .rules import CostParams, PricePoint

SP = ZoneInfo("America/Sao_Paulo")


def today_sp() -> date:
    return datetime.now(SP).date()


def load_params(conn: Any) -> CostParams:
    """04 §4 params from rule_param."""
    rows = {r["key"]: Decimal(r["value"]) for r in conn.execute("select key, value from public.rule_param where key like 'm3.%'")}
    return CostParams(
        window_days=int(rows["m3.price_window_days"]),
        yield_error={k: rows[f"m3.yield_error_pct.{k}"] for k in ("medido", "declarado", "estimado")},
        prior_error=rows["m3.regional_prior_error_pct"],
    )


def sync_invoice_prices(conn: Any, account_id: str) -> None:
    """CST-01 source rows: one ingredient_price per confirmed match line; none for any other (D14)."""
    conn.execute(
        """delete from public.ingredient_price ip where ip.account_id = %s and ip.source = 'invoice'
           and not exists (select 1 from public.ingredient_match m where m.invoice_line_id = ip.invoice_line_id
                           and m.ingredient_id = ip.ingredient_id and m.status = 'confirmed')""",
        (account_id,),
    )
    conn.execute(
        """insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source, invoice_line_id)
           select m.account_id, m.ingredient_id, il.unit_price_cents / m.conversion_factor,
                  (i.issued_at at time zone 'America/Sao_Paulo')::date, 'invoice', il.id
           from public.ingredient_match m join public.invoice_line il on il.id = m.invoice_line_id
           join public.invoice i on i.id = il.invoice_id
           where m.account_id = %s and m.status = 'confirmed'
             and not exists (select 1 from public.ingredient_price ip where ip.invoice_line_id = il.id)""",
        (account_id,),
    )


def load_prices(conn: Any, account_id: str) -> dict[str, list[PricePoint]]:
    """CST-01 (confirmed lines only, D14) and CST-02 prices of the account, per ingredient."""
    prices: dict[str, list[PricePoint]] = defaultdict(list)
    for r in conn.execute(
        """select ip.ingredient_id::text, ip.price_per_base_unit_cents as price, ip.observed_on, ip.source::text,
                  ip.invoice_line_id::text
           from public.ingredient_price ip
           where ip.account_id = %s and (ip.source = 'regional_prior' or exists (
             select 1 from public.ingredient_match m where m.invoice_line_id = ip.invoice_line_id
               and m.ingredient_id = ip.ingredient_id and m.status = 'confirmed'))""",
        (account_id,),
    ):
        prices[r["ingredient_id"]].append(
            PricePoint(Decimal(r["price"]), r["observed_on"], r["source"], r["invoice_line_id"])
        )
    return prices


def load_recipes(conn: Any, account_id: str) -> list[RecipeIn]:
    rows = conn.execute(
        """select r.id::text as recipe_id, r.menu_item_id::text, rl.id::text as line_id, rl.ingredient_id::text,
                  rl.qty_base_units, rl.yield_pct, rl.yield_confidence::text
           from public.recipe r join public.recipe_line rl on rl.recipe_id = r.id
           where r.account_id = %s and r.status = 'ready' order by r.id, rl.created_at, rl.id""",
        (account_id,),
    ).fetchall()
    lines: dict[tuple[str, str], list[RecipeLineIn]] = defaultdict(list)
    for r in rows:
        lines[(r["recipe_id"], r["menu_item_id"])].append(
            RecipeLineIn(r["line_id"], r["ingredient_id"], Decimal(r["qty_base_units"]), Decimal(r["yield_pct"]),
                         r["yield_confidence"])
        )
    return [RecipeIn(rid, mid, ls) for (rid, mid), ls in lines.items()]


def load_inputs(conn: Any, close_period_id: str, as_of: date) -> tuple[str, CloseInputs]:
    """Account id and everything compute_close needs for one close period."""
    cp = conn.execute(
        "select account_id::text, month from public.close_period where id = %s", (close_period_id,)
    ).fetchone()
    if cp is None:
        raise LookupError(f"close_period {close_period_id} not found")
    acc, month = cp["account_id"], cp["month"]
    store_rows = conn.execute(
        """select cs.id::text, cs.channel::text, cs.brand_id::text, cl.gross_cents, cl.commission_cents,
                  cl.payment_cents
           from public.close_line cl join public.channel_store cs on cs.id = cl.channel_store_id
           where cl.close_period_id = %s""",
        (close_period_id,),
    ).fetchall()
    stores = [StoreIn(r["id"], r["channel"], r["brand_id"]) for r in store_rows]
    channel_close: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for r in store_rows:
        channel_close[r["channel"]][0] += r["gross_cents"]
        channel_close[r["channel"]][1] += r["commission_cents"]
        channel_close[r["channel"]][2] += r["payment_cents"]
    store_ids = [s.id for s in stores]
    items = [
        MenuItem(r["id"], r["name"], r["brand_id"], r["top20_rank"] if r["is_top20"] else None,
                 {k: str(v) for k, v in (r["channel_item_ids"] or {}).items()})
        for r in conn.execute(
            """select id::text, name, brand_id::text, is_top20, top20_rank, channel_item_ids
               from public.menu_item where account_id = %s""",
            (acc,),
        )
    ]
    packaging = {
        (r["menu_item_id"], r["channel"]): r["cost_cents"]
        for r in conn.execute(
            "select menu_item_id::text, channel::text, cost_cents from public.packaging_cost where account_id = %s",
            (acc,),
        )
    }
    camp_items: dict[str, set[str]] = defaultdict(set)
    for r in conn.execute(
        "select campaign_id::text, menu_item_id::text from public.campaign_item where account_id = %s", (acc,)
    ):
        camp_items[r["campaign_id"]].add(r["menu_item_id"])
    campaigns = [
        CampaignIn(r["id"], r["channel_store_id"], r["name"], Decimal(r["discount_pct"]), r["starts_on"],
                   r["ends_on"], frozenset(camp_items.get(r["id"], ())), Decimal(r["channel_share_pct"]))
        for r in conn.execute(
            """select id::text, channel_store_id::text, name, discount_pct, channel_share_pct, starts_on, ends_on
               from public.campaign
               where account_id = %s and channel_store_id = any(%s::uuid[])""",
            (acc, store_ids),
        )
    ]
    sold = [
        SoldLine(r["store_id"], r["ordered_on"], r["store_discount"], r["item_name"], r["external_item_id"],
                 int(r["qty"]), r["unit_price_cents"])
        for r in conn.execute(
            """select o.channel_store_id::text as store_id, (o.ordered_at at time zone 'America/Sao_Paulo')::date as ordered_on,
                      o.discount_store_cents > 0 as store_discount, oi.item_name, oi.external_item_id, oi.qty,
                      oi.unit_price_cents
               from public.order_item_fact oi join public.order_fact o on o.id = oi.order_fact_id
               where o.account_id = %s and o.status = 'concluido' and o.channel_store_id = any(%s::uuid[])
                 and o.ordered_at >= (%s::date)::timestamp at time zone 'America/Sao_Paulo'
                 and o.ordered_at < ((%s::date + interval '1 month')::date)::timestamp at time zone 'America/Sao_Paulo'""",
            (acc, store_ids, month, month),
        )
    ]
    inputs = CloseInputs(
        month=month,
        as_of=as_of,
        stores=stores,
        items=items,
        recipes=load_recipes(conn, acc),
        prices=load_prices(conn, acc),
        packaging=packaging,
        campaigns=campaigns,
        sold=sold,
        channel_close={k: ChannelClose(v[0], v[1], v[2]) for k, v in channel_close.items()},
    )
    return acc, inputs


def write_recipe_costs(conn: Any, result: CloseResult, as_of: date) -> None:
    """C12: cost of each ready recipe and line as of `as_of` (CST-01 to CST-04)."""
    for r in result.recipes:
        conn.execute(
            """update public.recipe set cost_cents = %s, error_pct = %s, cost_as_of = %s, cost_computed_at = now()
               where id = %s""",
            (r.cost_cents, r.error_pct, as_of, r.recipe_id),
        )
        for ln in r.lines:
            conn.execute(
                """update public.recipe_line set price_per_base_unit_cents = %s, price_source = %s,
                          price_observed_on = %s, cost_cents = %s where id = %s""",
                (
                    ln.price.price if ln.price else None,
                    ln.price.source if ln.price else None,
                    ln.price.observed_on if ln.price else None,
                    ln.cost.quantize(Decimal("0.0001")) if ln.cost is not None else None,
                    ln.line_id,
                ),
            )


def write_close(conn: Any, account_id: str, close_period_id: str, result: CloseResult, as_of: date) -> None:
    """C13, P06, W01: contribution rows, insumos per store and the decision of one close (replaced whole)."""
    conn.execute("delete from public.contribution where close_period_id = %s", (close_period_id,))
    conn.execute("delete from public.close_cost_line where close_period_id = %s", (close_period_id,))
    conn.execute("delete from public.close_decision where close_period_id = %s", (close_period_id,))
    for r in result.rows:
        conn.execute(
            """insert into public.contribution (account_id, close_period_id, menu_item_id, channel, campaign_name,
                 campaign_discount_pct, units, price_cents, channel_take_cents, ingredient_cents, packaging_cents,
                 ingredient_error_pct, left_cents, left_pct, can_invert, prices_as_of)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (account_id, close_period_id, r.menu_item_id, r.channel, r.campaign_name, r.campaign_discount_pct, r.units,
             r.price_cents, r.channel_take_cents, r.ingredient_cents, r.packaging_cents, r.ingredient_error_pct,
             r.left_cents, r.left_pct, r.can_invert, as_of),
        )
    for s in result.store_costs:
        conn.execute(
            """insert into public.close_cost_line (account_id, close_period_id, channel_store_id, units, uncovered_units,
                 ingredient_cents, packaging_cents) values (%s, %s, %s, %s, %s, %s, %s)""",
            (account_id, close_period_id, s.store_id, s.units, s.uncovered_units, s.ingredient_cents,
             s.packaging_cents),
        )
    d = result.decision
    if d is not None:
        conn.execute(
            """insert into public.close_decision (close_period_id, account_id, kind, menu_item_id, channel, campaign_name,
                 campaign_discount_pct, left_cents, base_left_cents) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (close_period_id, account_id, d.kind, d.menu_item_id, d.channel, d.campaign_name,
             d.campaign_discount_pct, d.left_cents, d.base_left_cents),
        )


def compute_and_store(conn: Any, close_period_id: str, as_of: date | None = None) -> CloseResult:
    """The compute_contribution job: prices, recipe costs, contribution, insumos and decision of one close."""
    as_of = as_of or today_sp()
    acc = conn.execute("select account_id::text from public.close_period where id = %s", (close_period_id,)).fetchone()
    if acc is None:
        raise LookupError(f"close_period {close_period_id} not found")
    sync_invoice_prices(conn, acc["account_id"])
    account_id, inputs = load_inputs(conn, close_period_id, as_of)
    result = compute_close(inputs, load_params(conn))
    write_recipe_costs(conn, result, as_of)
    write_close(conn, account_id, close_period_id, result, as_of)
    return result


def recost_account(conn: Any, account_id: str, as_of: date | None = None) -> str | None:
    """After a C12 edit: recipe costs, and the contribution of the account's latest whole-account close.

    Returns the close period recomputed, or None when the account has no close yet (recipe costs only).
    """
    as_of = as_of or today_sp()
    cp = conn.execute(
        """select id::text from public.close_period where account_id = %s and kitchen_id is null
           order by month desc limit 1""",
        (account_id,),
    ).fetchone()
    if cp is not None:
        compute_and_store(conn, cp["id"], as_of)
        return cp["id"]
    from .compute import CloseResult, cost_recipe

    sync_invoice_prices(conn, account_id)
    params = load_params(conn)
    prices = load_prices(conn, account_id)
    recipes = [cost_recipe(r, prices, as_of, params) for r in load_recipes(conn, account_id)]
    write_recipe_costs(conn, CloseResult(recipes, [], [], None), as_of)
    return None
