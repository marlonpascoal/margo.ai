"""P06 module 3 section: the close's contribution as P06 prints it (CST-01, CST-02, CST-04, CTB-01, DLV-01).

Reads what worker-cost stored for the close (contribution, close_decision, recipe_line prices); the row
choice and the coverage count are margo_cost's functions, so P06, C13 and W01 agree.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from margo_cost.compute import IngredientUse, P06Row, p06_rows, top_ingredient_coverage
from margo_cost.rules import Decision

from .p06 import COPY, MONTHS, CostItem, CostSection, money2

CHANNEL = {"ifood": "iFood", "food99": "99Food", "keeta": "Keeta", "rappi": "Rappi"}


def brl2(cents: int) -> str:
    return f"R$ {money2(cents)}"


def decision_text(d: Decision, item: str) -> str:
    """DLV-01 sentence of P06 (drawn for a campaign: "quase a metade dos")."""
    if d.kind == "campaign" and d.campaign_discount_pct is not None and d.base_left_cents:
        ratio = Decimal(d.left_cents) / Decimal(d.base_left_cents)
        compare: dict[str, str] = COPY["decision_compare"]  # type: ignore[assignment]
        key = (
            "less_than_half"
            if ratio < Decimal("0.5")
            else "almost_half"
            if ratio < Decimal("0.65")
            else "other"
        )
        return str(COPY["decision_campaign"]).format(
            pct=int(d.campaign_discount_pct * 100),
            item=item,
            com=brl2(d.left_cents),
            comparacao=compare[key],
            sem=brl2(d.base_left_cents),
        )
    return str(COPY["decision_lowest"]).format(
        item=item, sobra=brl2(d.left_cents), canal=CHANNEL.get(d.channel, d.channel)
    )


def load_cost_section(conn: Any, close_period_id: str) -> CostSection | None:
    """None when the close has no contribution yet ("falta custo")."""
    rows = conn.execute(
        """select c.menu_item_id::text, mi.name, c.channel::text, c.campaign_name, c.campaign_discount_pct,
                  c.units,
                  c.price_cents, c.left_cents, c.ingredient_error_pct
           from public.contribution c join public.menu_item mi on mi.id = c.menu_item_id
           where c.close_period_id = %s""",
        (close_period_id,),
    ).fetchall()
    if not rows:
        return None
    cp = conn.execute(
        "select account_id, month from public.close_period where id = %s", (close_period_id,)
    ).fetchone()
    names = {r["menu_item_id"]: r["name"] for r in rows}
    p06 = [
        P06Row(
            r["menu_item_id"],
            r["channel"],
            r["campaign_name"],
            Decimal(r["campaign_discount_pct"]) if r["campaign_discount_pct"] is not None else None,
            r["units"],
            r["price_cents"],
            r["left_cents"],
        )
        for r in rows
    ]
    dr = conn.execute(
        """select kind::text, menu_item_id::text, channel::text, campaign_name, campaign_discount_pct,
                  left_cents,
                  base_left_cents from public.close_decision where close_period_id = %s""",
        (close_period_id,),
    ).fetchone()
    decision = (
        Decision(
            dr["kind"],
            dr["menu_item_id"],
            dr["channel"],
            dr["campaign_name"],
            Decimal(dr["campaign_discount_pct"]) if dr["campaign_discount_pct"] is not None else None,
            dr["left_cents"],
            dr["base_left_cents"],
        )
        if dr
        else None
    )
    chosen = p06_rows(p06, decision)
    best = chosen[0].menu_item_id if chosen else None
    items = [
        CostItem(
            str(COPY["item_campaign"]).format(
                item=names[r.menu_item_id],
                pct=int((r.campaign_discount_pct or 0) * 100),
                canal=CHANNEL.get(r.channel, r.channel),
            )
            if r.campaign_name
            else str(COPY["item"]).format(
                item=names[r.menu_item_id], canal=CHANNEL.get(r.channel, r.channel)
            ),
            r.price_cents,
            r.left_cents,
            attention=r.menu_item_id != best,
        )
        for r in chosen
    ]
    units: dict[str, int] = {}
    for r in rows:
        units[r["menu_item_id"]] = units.get(r["menu_item_id"], 0) + r["units"]
    uses = [
        IngredientUse(
            u["ingredient_id"],
            Decimal(u["cost_cents"]) if u["cost_cents"] is not None else None,
            units.get(u["menu_item_id"], 0),
            u["price_source"],
        )
        for u in conn.execute(
            """select rl.ingredient_id::text, rl.cost_cents, rl.price_source::text, r.menu_item_id::text
               from public.recipe_line rl join public.recipe r on r.id = rl.recipe_id
               where r.account_id = %s and r.status = 'ready'""",
            (cp["account_id"],),
        )
    ]
    top_n = conn.execute("select value from public.rule_param where key = 'm3.top_ingredients'").fetchone()
    invoice, prior, missing = top_ingredient_coverage(uses, int(top_n["value"]) if top_n else 20)
    month = cp["month"]
    return CostSection(
        invoice_count=invoice,
        top_count=invoice + prior + missing,
        prior_count=prior,
        items=items,
        decision_title=str(COPY["decision_title"]).format(mes=MONTHS[month.month % 12]) if decision else None,
        decision_text=decision_text(decision, names.get(decision.menu_item_id, "")) if decision else None,
        error_pct=max(Decimal(r["ingredient_error_pct"]) for r in rows),
    )
