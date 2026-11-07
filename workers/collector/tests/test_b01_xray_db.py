"""B01 on the local stack (MARGO_DB_TESTS=1): the worker's three steps, run over the canonical rows of
G-SYN (public stores, their menu items, the founder's C03 and C04 decisions), give back exactly the
seeded X-ray of Pantanos Burguer: neighborhood, exclusions, pairs, parity, gaps, readings and Pareto.

Partial B01: the canonical rows are the seed, not recorded public pages. The "from recorded public pages"
half waits for Marlon's recordings (fixtures/m1/README.md).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from margo_collector.fetcher import CachedPage
from margo_collector.handlers import local_db_url
from margo_collector.rules import percent_label
from margo_collector.steps import calc_step, neighborhood_step, pair_step

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
        yield c


def xray_id(conn) -> str:
    return str(
        conn.execute(
            "select x.id from public.xray x join public.account a on a.id = x.account_id where a.code = 'G-01'"
            " and x.id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0'"
        ).fetchone()["id"]
    )


def snapshot(conn, xid: str):
    stores = conn.execute(
        "select public_store_id, distance_m, included, exclusion_reason from public.xray_store where xray_id = %s"
        " order by public_store_id",
        (xid,),
    ).fetchall()
    items = conn.execute(
        "select public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, loss_cents, reading, pair_status,"
        " pair_note, pareto_rank, pareto_cum_share,"
        " parity_full_cents, gap_full_pct, full_price_room from public.xray_item where xray_id = %s order by public_menu_item_id",
        (xid,),
    ).fetchall()
    pairs = conn.execute(
        "select i.public_menu_item_id as own, p.public_menu_item_id, p.similarity, p.accepted, p.by from public.xray_pair p"
        " join public.xray_item i on i.id = p.xray_item_id where i.xray_id = %s order by 1, 2",
        (xid,),
    ).fetchall()
    status = conn.execute("select status from public.xray where id = %s", (xid,)).fetchone()["status"]
    return stores, items, pairs, status


def test_B01_worker_steps_reproduce_the_seeded_xray_from_canonical_rows(conn):
    from margo_collector.repo import PostgresXrayRepo

    xid = xray_id(conn)
    before = snapshot(conn, xid)
    repo = PostgresXrayRepo(local_db_url())
    try:
        assert neighborhood_step(repo, xid) == {"stores": 107, "in_set": 84}
        assert pair_step(repo, xid) == {"items": 24, "revisar": 3}
        assert calc_step(repo, xid) == {"items": 24, "items_for_80": 6}
    finally:
        # The seed has no rank (M1-11 is null for rows from before the rule): C03 stays as drawn.
        conn.execute("update public.xray_store set capture_score = null, capture_rank = null where xray_id = %s", (xid,))
        repo.close()
    after = snapshot(conn, xid)
    assert after == before
    assert after[3] == "delivered", "recomputing does not undo the delivery"


def test_B01_drawn_numbers_from_the_worker_rows(conn):
    from fractions import Fraction

    xid = xray_id(conn)
    rows = {
        r["name"]: r
        for r in conn.execute(
            "select m.name, m.price_cents, i.parity_cents, i.gap_pct, i.reading, i.pareto_rank, i.pareto_cum_share"
            " from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id where i.xray_id = %s",
            (xid,),
        ).fetchall()
    }
    drawn = [
        ("Refrigerante lata 350 ml", 500, 650, "−23%"),
        ("Batata frita média", 1490, 1840, "−19%"),
        ("Milkshake 400 ml", 1690, 1990, "−15%"),
        ("Smash duplo", 2990, 3050, "−2%"),
        ("X-Bacon artesanal", 3690, 3150, "+17%"),
        ("Combo casal", 7990, 6990, "+14%"),
    ]
    for name, own, parity, gap in drawn:
        r = rows[name]
        assert (r["price_cents"], r["parity_cents"], percent_label(Fraction(r["gap_pct"]))) == (
            own,
            parity,
            gap,
        )
    pareto = sorted((r for r in rows.values() if r["pareto_rank"]), key=lambda r: r["pareto_rank"])[:6]
    assert [(r["name"], percent_label(Fraction(r["pareto_cum_share"]), signed=False)) for r in pareto] == [
        ("Batata frita média", "31%"),
        ("Refrigerante lata 350 ml", "53%"),
        ("Milkshake 400 ml", "67%"),
        ("Água 500 ml", "75%"),
        ("Sundae", "78%"),
        ("Molho especial extra", "80%"),
    ]


def test_B01_M1_05_the_seed_has_no_promotion_so_both_parities_agree(conn):
    """The numbers drawn in design/ stay to the centavo: no G-SYN item has a full parity of its own."""
    rows = conn.execute(
        "select parity_cents, parity_full_cents, gap_pct, gap_full_pct, full_price_room from public.xray_item"
        " where xray_id = %s and parity_cents is not null",
        (xray_id(conn),),
    ).fetchall()
    assert len(rows) == 24
    for r in rows:
        assert (r["parity_full_cents"], r["gap_full_pct"], r["full_price_room"]) == (r["parity_cents"], r["gap_pct"], False)


def test_B02_advisory_lock_lets_one_collector_run(conn):
    from margo_collector.repo import PostgresAdvisoryLock

    a, b = PostgresAdvisoryLock(local_db_url()), PostgresAdvisoryLock(local_db_url())
    assert a.try_acquire() is True
    assert b.try_acquire() is False
    a.release()
    assert b.try_acquire() is True
    b.release()


def test_B02_page_cache_in_postgres_keeps_7_days(conn):
    from margo_collector.repo import PostgresPageCache

    cache = PostgresPageCache(local_db_url())
    now = datetime.now(UTC)
    url = "https://www.ifood.com.br/teste-b02-cache"
    cache.put(CachedPage(url, 200, b"<html>x</html>", now - timedelta(days=6)))
    assert cache.get(url, now).body == b"<html>x</html>"
    assert cache.get(url, now + timedelta(days=1, seconds=1)) is None
    assert cache.purge(now + timedelta(days=2)) >= 1
    assert (
        conn.execute(
            "select count(*) as n from public.collector_page_cache where url = %s", (url,)
        ).fetchone()["n"]
        == 0
    )
