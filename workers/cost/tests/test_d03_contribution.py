"""D03: contribution and error bars of the top items match the seed (07 §2), and D14 on the cost side.

The seed's contribution rows (supabase/seed/g_syn_m3.sql) must be what the compute_contribution job
computes from the seed's own inputs. Runs against the local stack (MARGO_DB_TESTS=1), inside a transaction
that is rolled back.
"""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal

import pytest

DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))
LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
pytestmark = pytest.mark.skipif(not DB_TESTS, reason="MARGO_DB_TESTS=1 runs it against the local stack")

SEED_AS_OF = date(2026, 10, 30)
CONTRIBUTION_COLS = (
    "menu_item_id::text, channel::text, campaign_name, campaign_discount_pct, units, price_cents, channel_take_cents, "
    "ingredient_cents, packaging_cents, ingredient_error_pct, left_cents, left_pct, can_invert, prices_as_of"
)


@pytest.fixture
def conn():  # type: ignore[no-untyped-def]
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(LOCAL_DB_URL, row_factory=dict_row) as c:
        yield c
        c.rollback()


def close_id(conn) -> str:  # type: ignore[no-untyped-def]
    return conn.execute(
        """select cp.id::text from public.close_period cp join public.account a on a.id = cp.account_id
           where a.code = 'G-02' and cp.month = '2026-09-01' and cp.kitchen_id is null"""
    ).fetchone()["id"]


def snapshot(conn, cp: str) -> dict[str, list[tuple[object, ...]]]:  # type: ignore[no-untyped-def]
    def rows(sql: str) -> list[tuple[object, ...]]:
        return sorted((tuple(r.values()) for r in conn.execute(sql, (cp,))), key=repr)

    return {
        "contribution": rows(f"select {CONTRIBUTION_COLS} from public.contribution where close_period_id = %s"),
        "cost_lines": rows(
            """select channel_store_id::text, units, uncovered_units, ingredient_cents, packaging_cents
               from public.close_cost_line where close_period_id = %s"""
        ),
        "decision": rows(
            """select kind::text, menu_item_id::text, channel::text, campaign_name, campaign_discount_pct, left_cents,
                      base_left_cents from public.close_decision where close_period_id = %s"""
        ),
        "recipes": rows(
            """select r.id::text, r.cost_cents, r.error_pct, rl.id::text, rl.price_source::text, rl.price_observed_on,
                      round(rl.price_per_base_unit_cents, 10), round(rl.cost_cents, 4)
               from public.recipe r join public.recipe_line rl on rl.recipe_id = r.id
               where r.account_id = (select account_id from public.close_period where id = %s)"""
        ),
    }


def test_D03_job_recomputes_the_seed_contribution_exactly(conn) -> None:  # type: ignore[no-untyped-def]
    from margo_cost.db import compute_and_store

    cp = close_id(conn)
    seed = snapshot(conn, cp)
    assert len(seed["contribution"]) == 12 and seed["decision"]
    compute_and_store(conn, cp, SEED_AS_OF)
    assert snapshot(conn, cp) == seed


def test_D03_top_items_follow_ctb01_as_written(conn) -> None:  # type: ignore[no-untyped-def]
    """CTB-01 take = commission + payment fee + store share of the promotion (04 §4); the coupon is co-funded
    50/50 as M2 records it (campaign.channel_share_pct). Values differ from the C13 drawing, which used the
    channel's whole share (delivery and anticipation included) and a store-paid coupon."""
    from margo_cost.compute import compute_close
    from margo_cost.db import load_inputs, load_params

    _, inputs = load_inputs(conn, close_id(conn), SEED_AS_OF)
    result = compute_close(inputs, load_params(conn))
    name = {i.id: i.name for i in inputs.items}
    got = {
        (name[r.menu_item_id], r.channel, r.campaign_name): (r.price_cents, r.channel_take_cents, r.ingredient_cents,
                                                            r.left_cents, round(r.ingredient_error_pct * 100))
        for r in result.rows
    }
    assert got[("X-Bacon artesanal", "ifood", None)] == (3690, 561, 1244, 1885, 9)
    assert got[("X-Bacon artesanal", "food99", None)] == (3690, 450, 1244, 1996, 9)
    assert got[("Combo casal", "ifood", None)] == (7990, 1214, 3180, 3596, 8)
    assert got[("Combo casal", "ifood", "Cupom 20% cofinanciado")] == (7990, 1962, 3180, 2848, 8)
    assert got[("Batata frita média", "ifood", None)] == (1490, 226, 310, 954, 2)
    assert got[("Refrigerante lata", "ifood", None)] == (500, 76, 285, 139, 2)
    assert not any(r.can_invert for r in result.rows)


def test_D03_coupon_share_is_read_from_m2(conn) -> None:  # type: ignore[no-untyped-def]
    """M2 and M3 read the same campaign.channel_share_pct: a store-funded coupon costs the store the whole discount."""
    from margo_cost.compute import compute_close
    from margo_cost.db import load_inputs, load_params

    cp = close_id(conn)
    conn.execute(
        """update public.campaign set channel_share_pct = 0 where name = %s
           and account_id = (select account_id from public.close_period where id = %s)""",
        ("Cupom 20% cofinanciado", cp),
    )
    _, inputs = load_inputs(conn, cp, SEED_AS_OF)
    result = compute_close(inputs, load_params(conn))
    name = {i.id: i.name for i in inputs.items}
    row = next(r for r in result.rows if name[r.menu_item_id] == "Combo casal" and r.campaign_name)
    assert (row.channel_take_cents, row.left_cents) == (2761, 2049)


def test_D14_suggested_match_changes_no_cost(conn) -> None:  # type: ignore[no-untyped-def]
    """A newer AI suggestion for the blend at another price, even with a stray price row, changes nothing."""
    from margo_cost.db import compute_and_store

    cp = close_id(conn)
    before = snapshot(conn, cp)
    acc = conn.execute("select account_id::text from public.close_period where id = %s", (cp,)).fetchone()["account_id"]
    inv = conn.execute(
        """select id::text, company_id::text from public.invoice where account_id = %s
           and issued_at between '2026-10-13 00:00-03' and '2026-10-29 23:59-03' order by issued_at desc limit 1""",
        (acc,),
    ).fetchone()
    line = conn.execute(
        """insert into public.invoice_line (account_id, invoice_id, line_no, description, unit, qty, unit_price_cents,
             total_cents) values (%s, %s, 99, 'CARNE MOIDA PROMO KG', 'KG', 10, 1990, 19900) returning id::text""",
        (acc, inv["id"]),
    ).fetchone()["id"]
    blend = conn.execute("select id::text from public.ingredient where name = 'Carne bovina moída (blend)'").fetchone()["id"]
    conn.execute(
        """insert into public.ingredient_match (account_id, invoice_line_id, ingredient_id, method, status, confidence,
             conversion_factor) values (%s, %s, %s, 'ai', 'suggested', 0.95, 1000)""",
        (acc, line, blend),
    )
    conn.execute(
        """insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source,
             invoice_line_id) values (%s, %s, 1.99, '2026-10-29', 'invoice', %s)""",
        (acc, blend, line),
    )
    compute_and_store(conn, cp, SEED_AS_OF)
    assert snapshot(conn, cp) == before
    assert conn.execute("select count(*) as n from public.ingredient_price where invoice_line_id = %s", (line,)).fetchone()["n"] == 0

    # Once a founder confirms it, it is the latest CST-01 price and the X-Bacon gets cheaper.
    conn.execute(
        "update public.ingredient_match set status = 'confirmed', confirmed_by = (select id from public.person where email = 'marlon@margoai.com') where invoice_line_id = %s",
        (line,),
    )
    result = compute_and_store(conn, cp, SEED_AS_OF)
    xbacon = conn.execute(
        "select id::text from public.menu_item where account_id = %s and name = 'X-Bacon artesanal'", (acc,)
    ).fetchone()["id"]
    xb = next(r for r in result.recipes if r.menu_item_id == xbacon)
    assert xb.cost_cents is not None and xb.cost_cents < 1244
    assert next(ln for ln in xb.lines if ln.price and ln.price.invoice_line_id == line).price.price == Decimal("1.99")

