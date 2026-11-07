"""B01 on the local stack (MARGO_DB_TESTS=1): from extraction copies to the X-ray rows, through the SQL functions
behind /api/extract and the worker's steps. Fixtures are SINTÉTICO; ids get a tag per run, since copies are never
deleted, and the coordinates a tag of their own so that neighbors of other runs stay out of the radius."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

import pytest
from margo_collector.handlers import local_db_url
from margo_collector.repo import PostgresXrayRepo
from margo_collector.steps import calc_step, collect_step, neighborhood_job_step, pair_step
from psycopg.types.json import Jsonb

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "m1" / "extract"


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
        yield c


@pytest.fixture
def repo():
    r = PostgresXrayRepo(local_db_url())
    yield r
    r.close()


class Run:
    def __init__(self, conn: Any) -> None:
        self.conn = conn
        self.tag = uuid.uuid4().hex[:8]
        self.shift = (int(self.tag[:4], 16) % 3000) / 10  # up to 300 degrees of longitude: another place

    def fixture(self, name: str) -> dict[str, Any]:
        text = (FIXTURES / name).read_text().replace("5e000000-0000-4000", f"{self.tag}-0000-4000")
        data = json.loads(text)
        for s in [data.get("capture", {}).get("store"), data.get("discover", {}).get("target"),
                  *data.get("discover", {}).get("stores", [])]:
            if s and "lng" in s:
                s["lng"] = round(s["lng"] + self.shift - 150, 6)
        return data

    def ext(self, n: int) -> str:
        return f"{self.tag}-0000-4000-8000-{n:012d}"

    def store_id(self, n: int) -> str:
        return str(
            self.conn.execute("select id from public.public_store where external_id = %s", (self.ext(n),)).fetchone()["id"]
        )

    def xray(self, categories: list[str]) -> str:
        founder = self.conn.execute("select id from public.person where email = 'marlon@margoai.com'").fetchone()["id"]
        url = self.fixture("discover.json")["discover"]["target"]["url"]
        return str(
            self.conn.execute(
                "select public.xray_create(%s, %s, 3, %s, '{}'::jsonb, %s) as id", (self.ext(1), url, categories, founder)
            ).fetchone()["id"]
        )

    def claim(self) -> dict[str, Any]:
        return self.conn.execute("select * from public.extract_claim_next('teste', 'sandbox')").fetchone()

    def record(self, job_id: Any, name: str) -> None:
        body = self.fixture(name)
        if "discover" in body:
            d = body["discover"]
            copies = [{"external_id": d["target"]["external_id"], "content": {"kind": "discover_target", "store": d["target"]}}]
            for s in d["stores"]:
                extra = {k: s.pop(k) for k in ("distance_km", "search_terms", "taxonomies") if k in s}
                s.pop("reviews", None), s.pop("raw_html", None), s.pop("last_seen_open_at", None)
                copies.append({"external_id": s["external_id"], "content": {"kind": "discover_store", "store": s, **extra}})
        else:
            c = body["capture"]
            copies = [{"external_id": c["store"]["external_id"], "content": {"kind": "capture", **c}}]
        self.conn.execute(
            "select public.extract_record_result(%s, 'scraper', %s, %s)", (job_id, body["collected_at"], Jsonb(copies))
        )


@pytest.fixture
def run(conn):
    conn.execute("delete from public.job where type in ('extract_discover', 'extract_capture', 'xray_neighborhood')")
    yield Run(conn)
    conn.execute("delete from public.job where type in ('extract_discover', 'extract_capture', 'xray_neighborhood')")


def rows_of(conn: Any, xid: str) -> dict[str, dict[str, Any]]:
    return {
        str(r["public_store_id"]): r
        for r in conn.execute("select * from public.xray_store where xray_id = %s", (xid,)).fetchall()
    }


def test_B01_from_discovery_to_pairs_with_copies_only(conn, repo, run):
    xid = run.xray(["Lanches"])
    assert collect_step(repo, xid, "sandbox") == {"queued": 1}
    job = run.claim()
    assert job["kind"] == "discover"
    run.record(job["job_id"], "discover.json")

    next_jobs = conn.execute(
        "select payload from public.job where type = 'xray_neighborhood' and payload ->> 'xray_id' = %s", (xid,)
    ).fetchall()
    assert next_jobs == [{"payload": {"xray_id": xid, "queue_captures": True}}]

    out = neighborhood_job_step(repo, xid, "sandbox", queue_captures=True)
    assert out == {"stores": 2, "in_set": 1, "captures": 2}
    rows = rows_of(conn, xid)
    assert rows[run.store_id(2)]["distance_m"] == 1200, "M1-01: distance from the discovery copy"
    assert rows[run.store_id(3)]["exclusion_reason"] == "regra: outra categoria", "M1-02"
    assert run.store_id(4) not in rows, "M1-01: beyond the radius"
    assert conn.execute("select lat from public.public_store where id = %s", (run.store_id(2),)).fetchone()["lat"] is None

    # Captures: the target first, then the set. The last one queues the neighborhood again, without captures.
    conn.execute(
        "update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood' and status = 'queued'"
    )
    first = run.claim()
    assert first["payload"] == {"url": run.fixture("discover.json")["discover"]["target"]["url"]}
    run.record(first["job_id"], "capture-target.json")
    assert (
        conn.execute("select count(*) as n from public.job where type = 'xray_neighborhood' and status = 'queued'").fetchone()["n"]
        == 0
    )
    second = run.claim()
    run.record(second["job_id"], "capture-store.json")
    again = conn.execute("select payload from public.job where type = 'xray_neighborhood' and status = 'queued'").fetchall()
    assert again == [{"payload": {"xray_id": xid, "queue_captures": False}}]
    assert neighborhood_job_step(repo, xid, "sandbox", queue_captures=False)["captures"] == 0
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood' and status = 'queued'")
    rows = rows_of(conn, xid)
    # M1-01: haversine now that both have coordinates (0.01 degree of latitude is about 1.11 km).
    assert rows[run.store_id(2)]["distance_m"] == 1112
    assert rows[run.store_id(2)]["included"]

    assert pair_step(repo, xid)["items"] == 2
    target_items = {
        r["name"]: r
        for r in conn.execute(
            "select m.name, i.id, (select count(*) from public.xray_pair p where p.xray_item_id = i.id) as pairs"
            " from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id where i.xray_id = %s",
            (xid,),
        ).fetchall()
    }
    assert set(target_items) == {"Hambúrguer sintético", "Batata sintética"}


def test_B01_M1_05_and_removed_items_in_pairing(conn, repo, run):
    run.xray(["Lanches"])
    for name in ("capture-store.json", "capture-store-newer.json"):
        conn.execute(
            "insert into public.job (type, payload) values ('extract_capture', %s)",
            (Jsonb({"url": "u", "channel": "ifood", "external_id": run.ext(2)}),),
        )
        run.record(run.claim()["job_id"], name)
    sid = run.store_id(2)
    items = {i.name: i for i in repo.items_of_stores([sid])}
    assert "Suco sintético" not in items, "D47c: a removed item stays out of pairing"
    assert items["Monte seu lanche sintético"].price_cents == 1900, "M1-05: the minimum price when the price is 0"
    assert items["Hambúrguer sintético duplo"].price_cents == 3000, "M1-05: the current price"
    assert items["Hambúrguer sintético duplo"].taxonomy_level2 == "HAMBURGUERES"


def test_B01_a_delivered_xray_keeps_its_numbers_after_a_newer_capture(conn, repo, run):
    xid = run.xray(["Lanches"])
    conn.execute(
        "insert into public.job (type, payload) values ('extract_capture', %s)",
        (Jsonb({"url": "u", "channel": "ifood", "external_id": run.ext(1)}),),
    )
    run.record(run.claim()["job_id"], "capture-target.json")
    conn.execute("update public.xray set collected_at = now() where id = %s", (xid,))
    pair_step(repo, xid)
    calc_step(repo, xid)
    cents = "select own_cents from public.xray_item_view where xray_id = %s and name = 'Hambúrguer sintético'"
    assert conn.execute(cents, (xid,)).fetchone()["own_cents"] == 2500
    conn.execute(
        "update public.public_menu_item set price_cents = 9999 where external_item_id = 'item-alvo-1' and public_store_id = %s",
        (run.store_id(1),),
    )
    assert conn.execute(cents, (xid,)).fetchone()["own_cents"] == 2500


def test_B01_a_capture_without_the_minimum_takes_the_item_out_of_pairing(conn, repo, run):
    """M1-05: a stale minimum at price 0 must not enter parity once the complete menu no longer has it."""
    run.xray(["Lanches"])
    conn.execute(
        "insert into public.job (type, payload) values ('extract_capture', %s)",
        (Jsonb({"url": "u", "channel": "ifood", "external_id": run.ext(2)}),),
    )
    run.record(run.claim()["job_id"], "capture-store-newer.json")
    sid = run.store_id(2)
    assert {i.name: i.price_cents for i in repo.items_of_stores([sid])}["Monte seu lanche sintético"] == 1900

    conn.execute(
        "insert into public.job (type, payload) values ('extract_capture', %s)",
        (Jsonb({"url": "u", "channel": "ifood", "external_id": run.ext(2)}),),
    )
    later = {
        "kind": "capture",
        "store": {"external_id": run.ext(2)},
        "items": [{"external_item_id": "item-a-2", "name": "Monte seu lanche sintético", "price_cents": 0}],
    }
    conn.execute(
        "select public.extract_record_result(%s, 'scraper', '2026-11-14T08:00:00-03:00', %s)",
        (run.claim()["job_id"], Jsonb([{"external_id": run.ext(2), "content": later}])),
    )
    assert "Monte seu lanche sintético" not in {i.name for i in repo.items_of_stores([sid])}
    row = conn.execute(
        "select minimum_price_cents, comparison_price_cents, taxonomy_level2 from public.public_menu_item"
        " where public_store_id = %s and external_item_id = 'item-a-2'",
        (sid,),
    ).fetchone()
    assert row == {"minimum_price_cents": None, "comparison_price_cents": 0, "taxonomy_level2": "HAMBURGUERES"}


def test_B01_M1_01_taxonomy_from_another_run_is_not_a_discovery(conn, run):
    xid = conn.execute("select id, target_store_id from public.xray where status = 'delivered' order by created_at desc limit 1").fetchone()
    target = xid["target_store_id"]
    other = conn.execute(
        "select id from public.public_store where id <> %s and lat is not null limit 1", (target,)
    ).fetchone()["id"]
    conn.execute(
        "insert into public.public_menu_item (public_store_id, external_item_id, name, price_cents, taxonomy_level2)"
        " values (%s, 'outra-execucao', 'Item de outra execucao', 1000, 'HAMBURGUERES')",
        (other,),
    )
    try:
        found = conn.execute("select public_store_id from public.xray_discovery(%s)", (xid["id"],)).fetchall()
    finally:
        conn.execute("delete from public.public_menu_item where external_item_id = 'outra-execucao'")
    assert other not in [r["public_store_id"] for r in found]
