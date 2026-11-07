"""B01 on the local stack (MARGO_DB_TESTS=1): pairing waits for the load, the capture cap, parallel claims, and the
M1-03 size read from the item name. All stores and items are SINTÉTICO; ids get a tag per test."""

from __future__ import annotations

import os
import threading
import uuid
from fractions import Fraction
from typing import Any

import pytest
from margo_collector.handlers import local_db_url
from margo_collector.repo import PostgresXrayRepo
from margo_collector.rules import normalize_m1_03
from margo_collector.steps import LoadPending, neighborhood_job_step, pair_step
from psycopg import errors
from psycopg.types.json import Jsonb

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")

QUEUE = "('extract_discover', 'extract_capture', 'xray_neighborhood')"


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
        c.execute(f"delete from public.job where type in {QUEUE}")
        yield c
        c.execute(f"delete from public.job where type in {QUEUE}")


@pytest.fixture
def repo():
    r = PostgresXrayRepo(local_db_url())
    yield r
    r.close()


class Hood:
    """An X-ray with a target and `n` included neighbors, nearest first (100 m apart)."""

    def __init__(self, conn: Any, n: int = 2, *, rules: dict[str, Any] | None = None) -> None:
        self.conn = conn
        self.tag = uuid.uuid4().hex[:8]
        self.founder = conn.execute("select id from public.person where email = 'marlon@margoai.com'").fetchone()["id"]
        target_ext = self.ext(0)
        self.xid = str(
            conn.execute(
                "select public.xray_create(%s, %s, 3, '{}', %s, %s) as id",
                (target_ext, self.url(target_ext), Jsonb(rules or {}), self.founder),
            ).fetchone()["id"]
        )
        self.target = self.store_id(target_ext)
        self.stores = [self.neighbor(i, 100 * i) for i in range(1, n + 1)]

    def ext(self, n: int) -> str:
        return f"{self.tag}-0000-4000-8000-{n:012d}"

    @staticmethod
    def url(ext: str) -> str:
        return f"https://www.ifood.com.br/delivery/cidade-sintetica-pr/loja/{ext}"

    def store_id(self, ext: str) -> str:
        return str(self.conn.execute("select id from public.public_store where external_id = %s", (ext,)).fetchone()["id"])

    def neighbor(self, i: int, distance_m: int, *, included: bool = True) -> str:
        ext = self.ext(i)
        sid = str(
            self.conn.execute(
                "insert into public.public_store (channel, external_id, name, url) values ('ifood', %s, %s, %s) returning id",
                (ext, f"Vizinha {self.tag} {i}", self.url(ext)),
            ).fetchone()["id"]
        )
        self.conn.execute(
            "insert into public.xray_store (xray_id, public_store_id, distance_m, included, exclusion_reason)"
            " values (%s, %s, %s, %s, %s)",
            (self.xid, sid, distance_m, included, None if included else "regra: outra categoria"),
        )
        return sid

    def item(self, store: str, ext: str, name: str, price: int, unit: str = "un", qty: Any = None) -> str:
        return str(
            self.conn.execute(
                "insert into public.public_menu_item (public_store_id, external_item_id, name, price_cents, unit, unit_qty,"
                " collected_at) values (%s, %s, %s, %s, %s, %s, now()) returning id",
                (store, ext, name, price, unit, qty),
            ).fetchone()["id"]
        )

    def queue_captures(self) -> int:
        return self.conn.execute("select public.extract_queue_xray_captures(%s, 'sandbox') as n", (self.xid,)).fetchone()["n"]

    def claim(self) -> Any:
        return self.conn.execute("select * from public.extract_claim_next('teste', 'sandbox')").fetchone()

    def finish_all(self, *, failed_store: str | None = None) -> None:
        """Answers every queued capture: a permanent `fail` for failed_store, a result without items for the others."""
        while (job := self.claim()) is not None:
            store = self.job_store(job["job_id"])
            if store == failed_store:
                self.conn.execute("select public.extract_record_failure(%s, 'not_found', null)", (job["job_id"],))
            else:
                self.conn.execute("select public.finish_job(%s, 'done', '{}')", (job["job_id"],))
                self.conn.execute("update public.extract_run set status = 'done' where job_id = %s", (job["job_id"],))

    def job_store(self, job_id: Any) -> str:
        return self.conn.execute("select payload ->> 'public_store_id' as s from public.job where id = %s", (job_id,)).fetchone()["s"]

    def states(self) -> dict[str, str]:
        rows = self.conn.execute("select * from public.xray_capture_states(%s)", (self.xid,)).fetchall()
        return {str(r["public_store_id"]): r["state"] for r in rows}

    def blocker(self) -> str | None:
        return self.conn.execute("select public.xray_pair_blocker(%s) as b", (self.xid,)).fetchone()["b"]

    def confirm(self) -> None:
        self.conn.execute("select public.xray_confirm_stores(%s, %s)", (self.xid, self.founder))

    def capture(self, ext: str, items: list[dict[str, Any]], at: str = "2026-11-07T10:00:00-03:00") -> str:
        """A capture of one store through the functions behind /api/extract; the id of its copy."""
        sid = self.store_id(ext)
        self.conn.execute("select app.extract_queue_capture(%s, null)", (sid,))
        job = self.claim()
        content = {"kind": "capture", "store": {"external_id": ext}, "items": items}
        self.conn.execute(
            "select public.extract_record_result(%s, 'scraper', %s, %s)",
            (job["job_id"], at, Jsonb([{"external_id": ext, "content": content}])),
        )
        return str(
            self.conn.execute(
                "select c.id from public.extract_copy c join public.extract_run r on r.id = c.run_id where r.job_id = %s",
                (job["job_id"],),
            ).fetchone()["id"]
        )

    def row(self, ext: str, external_item: str) -> dict[str, Any]:
        return self.conn.execute(
            "select * from public.public_menu_item where public_store_id = %s and external_item_id = %s",
            (self.store_id(ext), external_item),
        ).fetchone()


# Pairing waits for the load -------------------------------------------------------------------------


def test_B01_C03_confirm_is_refused_while_a_capture_is_queued_or_running(conn):
    h = Hood(conn)
    assert h.queue_captures() == 3
    assert h.blocker() == "captures"
    audits = "select count(*) as n from public.audit_log where entity_id = %s and action = 'xray.confirm_stores'"
    with pytest.raises(errors.CheckViolation, match="xray_load_pending"):
        h.confirm()
    job = h.claim()
    assert job is not None
    with pytest.raises(errors.CheckViolation, match="xray_load_pending"):
        h.confirm()
    assert conn.execute(audits, (h.xid,)).fetchone()["n"] == 0
    assert conn.execute("select status from public.xray where id = %s", (h.xid,)).fetchone()["status"] == "collecting"
    h.finish_all()
    conn.execute("select public.finish_job(%s, 'done', '{}')", (job["job_id"],))
    assert h.blocker() is None
    h.confirm()
    assert conn.execute(audits, (h.xid,)).fetchone()["n"] == 1


def test_B01_xray_pair_that_arrives_early_fails_with_a_clear_reason(conn, repo):
    h = Hood(conn)
    h.queue_captures()
    with pytest.raises(LoadPending):
        pair_step(repo, h.xid)
    assert conn.execute("select count(*) as n from public.xray_item where xray_id = %s", (h.xid,)).fetchone()["n"] == 0


def test_B01_failed_captures_do_not_block_and_are_shown_as_failed(conn, repo):
    h = Hood(conn)
    h.queue_captures()
    h.finish_all(failed_store=h.stores[0])
    states = h.states()
    assert states[h.stores[0]] == "failed"
    assert states[h.stores[1]] == "done"
    assert states[h.target] == "done"
    # The failure asks for the neighborhood again; once that ran, nothing waits.
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    assert h.blocker() is None
    h.confirm()
    pair_step(repo, h.xid)


def test_B01_active_neighborhood_job_also_holds_the_pairing(conn, repo):
    """The last capture queues M1-02 again: pairing before it would read a set that is about to change."""
    h = Hood(conn)
    conn.execute(
        "insert into public.job (type, payload, dedupe_key) values ('xray_neighborhood', %s, %s)",
        (Jsonb({"xray_id": h.xid, "queue_captures": False}), f"xray_neighborhood:{h.xid}"),
    )
    assert h.blocker() == "neighborhood"
    with pytest.raises(LoadPending):
        pair_step(repo, h.xid)


def test_B01_a_capture_stuck_in_running_cannot_block_forever(conn):
    """02 §4: past 30 minutes it returns to the queue while it has attempts left (m1.extract_max_attempts, 3), then
    fails with an alert."""
    h = Hood(conn, 1)
    h.queue_captures()
    stuck = conn.execute(
        "select * from public.job where type = 'extract_capture' and payload ->> 'public_store_id' = %s", (h.stores[0],)
    ).fetchone()
    conn.execute("select public.claim_job(%s)", (stuck["id"],))
    conn.execute("delete from public.job where type = 'extract_capture' and id <> %s", (stuck["id"],))
    future = conn.execute("select now() + interval '31 minutes' as t").fetchone()["t"]

    conn.execute("select * from public.requeue_stuck_jobs(%s)", (future,))
    assert conn.execute("select status from public.job where id = %s", (stuck["id"],)).fetchone()["status"] == "queued"
    assert h.blocker() == "captures", "requeued once: still in the load"

    conn.execute("select public.claim_job(%s)", (stuck["id"],))
    later = conn.execute("select now() + interval '62 minutes' as t").fetchone()["t"]
    conn.execute("select * from public.requeue_stuck_jobs(%s)", (later,))
    assert conn.execute("select status from public.job where id = %s", (stuck["id"],)).fetchone()["status"] == "queued"

    conn.execute("select public.claim_job(%s)", (stuck["id"],))
    last = conn.execute("select now() + interval '93 minutes' as t").fetchone()["t"]
    conn.execute("select * from public.requeue_stuck_jobs(%s)", (last,))
    assert conn.execute("select status from public.job where id = %s", (stuck["id"],)).fetchone()["status"] == "failed"
    assert h.blocker() is None
    assert h.states()[h.stores[0]] == "failed"
    conn.execute("delete from public.alert where title like 'Tarefa extract_capture travou%'")


def test_B01_C03_states_read_only_this_xrays_stores(conn):
    h = Hood(conn)
    other = Hood(conn, 5)
    other.queue_captures()
    assert h.states() == {}, "another X-ray's queue says nothing about this one"
    assert h.blocker() is None


def test_B01_M1_04_rerun_cleans_stale_pairs_and_keeps_manual_decisions(conn, repo):
    h = Hood(conn, 3, rules={"min_pairs": 1})
    keep, toggled, gone = h.stores
    own = h.item(h.target, "own", "Hambúrguer sintético duplo", 2000)
    h.item(h.target, "own2", "Pudim sintético", 900)
    kept_item = h.item(keep, "a", "Hambúrguer sintético duplo", 2200)
    h.item(toggled, "b", "Hambúrguer sintético duplo", 2400)
    h.item(gone, "c", "Hambúrguer sintético duplo", 9900)
    pair_step(repo, h.xid)

    item = conn.execute("select id from public.xray_item where xray_id = %s and public_menu_item_id = %s", (h.xid, own)).fetchone()["id"]
    pairs = "select p.public_menu_item_id::text as m, p.accepted, p.by from public.xray_pair p where p.xray_item_id = %s"
    assert len(conn.execute(pairs, (item,)).fetchall()) == 3

    # A founder rejects the pair of the store that stays; another store is taken out, another leaves the neighborhood.
    conn.execute("select public.xray_item_review(%s, %s::uuid[], %s)", (item, [], h.founder))
    ts = conn.execute("select id from public.xray_store where xray_id = %s and public_store_id = %s", (h.xid, toggled)).fetchone()["id"]
    conn.execute("select public.xray_store_set_included(%s, false, %s)", (ts, h.founder))
    conn.execute("delete from public.xray_store where xray_id = %s and public_store_id = %s", (h.xid, gone))
    conn.execute("update public.xray_item set parity_cents = 1, gap_pct = 1, reading = 'na_media', norm_price_cents = 1 where id = %s", (item,))

    pair_step(repo, h.xid)

    rows = conn.execute(pairs, (item,)).fetchall()
    assert [r["m"] for r in rows] == [kept_item], "pairs to stores no longer included are gone"
    assert rows[0]["accepted"] is False and rows[0]["by"] == h.founder, "the founder's decision stays"
    after = conn.execute("select * from public.xray_item where id = %s", (item,)).fetchone()
    assert after["norm_price_cents"] == 2000, "xray_item is recalculated"
    assert after["parity_cents"] is None and after["gap_pct"] is None and after["reading"] is None
    assert after["reviewed_at"] is not None


# Capture cap ----------------------------------------------------------------------------------------


def test_B01_D47c_capture_cap_takes_the_nearest_and_never_queues_past_it(conn):
    assert conn.execute("select value from public.rule_param where key = 'm1.extract_max_captures_per_xray'").fetchone()["value"] == 30
    h = Hood(conn, 0)
    near = [h.neighbor(i, 100 * i) for i in range(1, 29)]
    tied = sorted([h.neighbor(29, 5000), h.neighbor(30, 5000), h.neighbor(31, 5000)])
    far = [h.neighbor(i, 6000 + i) for i in range(32, 36)]
    h.neighbor(40, 1, included=False)

    assert h.queue_captures() == 31, "the target plus 30"
    queued = {
        r["s"]
        for r in conn.execute(
            "select payload ->> 'public_store_id' as s from public.job where type = 'extract_capture' and status = 'queued'"
        ).fetchall()
    }
    assert queued == {h.target, *near, *tied[:2]}, "rows from before M1-11 have no rank: nearest first, ties by store id"

    assert h.queue_captures() == 0, "a re-run does not queue twice"
    states = h.states()
    assert {s for s, v in states.items() if v == "beyond_cap"} == {tied[2], *far}
    assert sum(v == "missing" for v in states.values()) == 31

    # A selected store leaving the set frees no place: the re-run stays within the cap.
    ts = conn.execute("select id from public.xray_store where xray_id = %s and public_store_id = %s", (h.xid, near[0])).fetchone()["id"]
    conn.execute("select public.xray_store_set_included(%s, false, %s)", (ts, h.founder))
    assert h.queue_captures() == 0
    assert h.states()[tied[2]] == "beyond_cap"

    # Stores past the cap do not hold the pairing.
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'extract_capture'")
    assert h.blocker() is None


def test_B01_D47c_capture_cap_holds_in_the_daily_cron(conn):
    h = Hood(conn, 33)
    h.queue_captures()
    conn.execute("update public.job set status = 'failed', finished_at = now() where type = 'extract_capture'")
    conn.execute("select public.extract_queue_due('sandbox')")
    queued = {
        r["s"]
        for r in conn.execute(
            "select payload ->> 'public_store_id' as s from public.job where type = 'extract_capture' and status = 'queued'"
        ).fetchall()
    }
    mine = queued & {h.target, *h.stores}
    assert h.target in mine
    assert mine == {h.target, *h.stores[:30]}


def test_B01_M1_11_rank_decides_the_capture_and_is_kept_per_xray(conn, repo):
    """Through the worker step: the score and rank land on xray_store, the top of the rank gets the capture, a store past
    the cap keeps its numbers, and a capture rewrites none of them."""
    h = Hood(conn, 0)
    conn.execute("update public.xray set collected_at = now() where id = %s", (h.xid,))
    conn.execute("update public.rule_param set value = 2 where key = 'm1.extract_max_captures_per_xray'")
    try:
        popular, near, other = (h.neighbor(1, 2500), h.neighbor(2, 100), h.neighbor(3, 2800))
        conn.execute("update public.public_store set rating_count = 5000 where id = %s", (popular,))
        run = conn.execute(
            "insert into public.extract_run (kind, worker, request, status) values ('discover', 't', %s, 'done') returning id",
            (Jsonb({"channel": "ifood", "external_id": h.ext(0)}),),
        ).fetchone()["id"]
        for i, km in ((0, 0), (1, 2.5), (2, 0.1), (3, 2.8)):
            content = {"kind": "discover_store", "store": {"external_id": h.ext(i)}, "distance_km": km}
            digest = uuid.uuid4().hex
            conn.execute("insert into public.extract_content (content_hash, payload) values (%s, %s)", (digest, Jsonb(content)))
            conn.execute(
                "insert into public.extract_copy (run_id, channel, store_external_id, collected_at, content_hash)"
                " values (%s, 'ifood', %s, now(), %s)",
                (run, h.ext(i), digest),
            )
        out = neighborhood_job_step(repo, h.xid, "sandbox", queue_captures=True)
        assert out["captures"] == 3, "the target plus the cap"

        def rows() -> dict[str, Any]:
            return {
                str(r["public_store_id"]): r
                for r in conn.execute("select * from public.xray_store where xray_id = %s", (h.xid,)).fetchall()
            }

        first = rows()
        assert [first[s]["capture_rank"] for s in (popular, near, other)] == [1, 2, 3]
        assert first[other]["capture_score"] is not None
        assert first[popular]["capture_slot"] and first[near]["capture_slot"] and not first[other]["capture_slot"]
        assert h.states()[other] == "beyond_cap", "shown as not captured by the cap"
        queued = "select count(*) as n from public.job where type = 'extract_capture'"
        before = conn.execute(queued).fetchone()["n"]

        # The re-run after the captures keeps what was recorded and queues nothing.
        conn.execute("update public.public_store set rating_count = 90000 where id = %s", (other,))
        assert neighborhood_job_step(repo, h.xid, "sandbox", queue_captures=False)["captures"] == 0
        assert rows()[other]["capture_rank"] == 3, "never rewritten by a later capture"
        # A new discovery of this X-ray recalculates, for this X-ray only, and no capture goes out twice or past the cap.
        assert neighborhood_job_step(repo, h.xid, "sandbox", queue_captures=True)["captures"] == 0
        again = rows()
        assert again[other]["capture_rank"] == 1
        assert not again[other]["capture_slot"], "the places already given stay"
        assert conn.execute(queued).fetchone()["n"] == before
    finally:
        conn.execute("update public.rule_param set value = 30 where key = 'm1.extract_max_captures_per_xray'")


def test_B01_M1_11_params_and_rows_from_before_the_rule_stay_null(conn):
    params = conn.execute("select key, value from public.rule_param where key like 'm1.rank_weight%'").fetchall()
    assert {r["key"]: r["value"] for r in params} == {
        "m1.rank_weight_ratings": 50,
        "m1.rank_weight_distance": 30,
        "m1.rank_weight_terms": 20,
    }
    seed = conn.execute(
        "select count(*) as n from public.xray_store where capture_rank is not null and xray_id in"
        " (select x.id from public.xray x join public.account a on a.id = x.account_id where a.is_synthetic)"
    ).fetchone()["n"]
    assert seed == 0


def test_B01_C03_no_cap_label_under_the_cap(conn):
    """G-SYN and every X-ray under the cap: a store with no capture job is no store beyond the cap."""
    h = Hood(conn, 3)
    assert h.states() == {}


# Parallel claims ------------------------------------------------------------------------------------


def _queue(h: Hood) -> None:
    assert h.queue_captures() > 0


@pytest.fixture
def limit_of_3(conn):
    """The limit logic, whatever the ceiling is today."""
    conn.execute("update public.rule_param set value = 3 where key = 'm1.extract_max_running'")
    yield
    conn.execute("update public.rule_param set value = 20 where key = 'm1.extract_max_running'")


def test_B01_extract_ceiling_is_20(conn):
    assert conn.execute("select value from public.rule_param where key = 'm1.extract_max_running'").fetchone()["value"] == 20


def test_B01_extract_claims_run_up_to_the_limit(conn, limit_of_3):
    h = Hood(conn, 4)
    _queue(h)
    jobs = [h.claim() for _ in range(3)]
    assert all(j is not None for j in jobs)
    assert len({j["job_id"] for j in jobs}) == 3
    assert h.claim() is None, "204 at the limit"
    conn.execute("select public.extract_record_failure(%s, 'blocked', null)", (jobs[0]["job_id"],))
    assert h.claim() is not None, "a place opened"


def test_B01_two_concurrent_claims_at_the_limit_get_one_job(conn, limit_of_3):
    import psycopg
    from psycopg.rows import dict_row

    h = Hood(conn, 5)
    _queue(h)
    assert h.claim() and h.claim()
    results: list[Any] = []
    barrier = threading.Barrier(2)

    def claim() -> None:
        with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
            barrier.wait()
            results.append(c.execute("select * from public.extract_claim_next('par', 'sandbox')").fetchone())

    threads = [threading.Thread(target=claim) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(r is not None for r in results) == 1
    running = "select count(*) as n from public.job where type in ('extract_discover', 'extract_capture') and status = 'running'"
    assert conn.execute(running).fetchone()["n"] == 3


def test_B01_stuck_recovery_stays_per_job(conn):
    h = Hood(conn, 4)
    _queue(h)
    jobs = [h.claim() for _ in range(3)]
    old = jobs[0]["job_id"]
    conn.execute("update public.job set claimed_at = now() - interval '31 minutes' where id = %s", (old,))
    next_job = h.claim()
    assert next_job is not None, "the stuck job gives its place back"
    states = {
        r["id"]: r["status"]
        for r in conn.execute(
            "select id, status from public.job where id = any(%s)", ([j["job_id"] for j in jobs[1:]],)
        ).fetchall()
    }
    assert set(states.values()) == {"running"}, "the others keep running"
    assert conn.execute("select status from public.extract_run where job_id = %s order by started_at limit 1", (old,)).fetchone()["status"] == "failed"


# M1-03 size from the name ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "unit", "qty"),
    [
        ("Fanta lata 350ml", "ml", 350),
        ("FANTA LATA 350 ML", "ml", 350),
        ("Fanta 2 litros", "ml", 2000),
        ("Fanta 1 Litro", "ml", 1000),
        ("Guaraná 1,5 l", "ml", 1500),
        ("Guaraná 1.5l", "ml", 1500),
        ("Água com gás 500ml", "ml", 500),
        ("ÁGUA 500 ml", "ml", 500),
        ("Chopp 0,5 L gelado", "ml", 500),
        ("Refri 1.000 ml", "ml", 1000),
        ("Batata 200g", "g", 200),
        ("Batata 200 gr", "g", 200),
        ("Picanha 1 kg", "g", 1000),
        ("Picanha 1,2kg", "g", 1200),
        ("Coxinha 12 unidades", "un", 12),
        ("Pão de queijo 6 un", "un", 6),
        ("Pão de queijo (6 un)", "un", 6),
        ("7up 350ml", "ml", 350),
    ],
)
def test_B01_M1_03_size_from_the_name(conn, name, unit, qty):
    r = conn.execute("select * from app.size_from_name_m1_03(%s)", (name,)).fetchone()
    assert (r["unit"], r["qty"]) == (unit, qty)


@pytest.mark.parametrize(
    "name",
    [
        "Combo X-Bacon + Fanta 350ml",
        "2 hambúrgueres e refri 2 litros",
        "Batata 200g + molho",
        "Pizza 8 pedaços",
        "Combo família 2 litros",
        "Kit festa 1 kg",
        "X-Burger com refri 350ml",
        "Burger c/ fritas 150g",
        "Hambúrguer, batata, refri 350ml",
        "Dois lanches 500g",
        "Fanta 350ml ou Coca 600ml",
        "Cerveja 6x350ml",
        "Cerveja 6 x 350ml",
        "Caixa 12 un 350ml",
        "Açaí 500ml 3 acompanhamentos",
        "Yakisoba para 2 pessoas 1kg",
        "Picanha 1.500 kg",
        "Refri 1,000 ml",
        "Coxinha 1,5 un",
        "Fanta 0 ml",
        "Fanta 999999999 ml",
        "Sal 0,5 g",
        "Refrigerante litro",
        "5 lanches",
        "X-Bacon",
        "",
    ],
)
def test_B01_M1_03_no_size_from_a_combo_or_an_ambiguous_name(conn, name):
    r = conn.execute("select * from app.size_from_name_m1_03(%s)", (name,)).fetchone()
    assert (r["unit"], r["qty"]) == (None, None)


def test_B01_M1_03_applying_a_copy_records_where_the_size_came_from(conn):
    h = Hood(conn, 1)
    ext = h.ext(1)
    h.capture(
        ext,
        [
            {"external_item_id": "a", "name": "Fanta lata 350ml", "price_cents": 700},
            {"external_item_id": "b", "name": "Fanta 2 litros", "price_cents": 1400, "unit": "un"},
            {"external_item_id": "c", "name": "Fanta 2 litros", "price_cents": 1400, "unit": "ml", "unit_qty": 1500},
            {"external_item_id": "d", "name": "Combo 350ml", "price_cents": 2000, "unit": "pack"},
            {"external_item_id": "e", "name": "Combo X-Bacon + Fanta 350ml", "price_cents": 3000},
            {"external_item_id": "f", "name": "Coxinha 500g", "price_cents": 3000, "unit": "un", "unit_qty": 1},
        ],
    )
    got = {k: h.row(ext, k) for k in "abcdef"}
    assert (got["a"]["unit"], got["a"]["unit_qty"], got["a"]["unit_from_name"]) == ("ml", 350, True)
    assert (got["b"]["unit"], got["b"]["unit_qty"], got["b"]["unit_from_name"]) == ("ml", 2000, True)
    assert (got["c"]["unit"], got["c"]["unit_qty"], got["c"]["unit_from_name"]) == ("ml", 1500, False), "the copy wins"
    assert (got["d"]["unit"], got["d"]["unit_qty"], got["d"]["unit_from_name"]) == ("pack", None, False), "an explicit combo"
    assert (got["e"]["unit"], got["e"]["unit_qty"], got["e"]["unit_from_name"]) == ("un", None, False)
    assert (got["f"]["unit"], got["f"]["unit_qty"], got["f"]["unit_from_name"]) == ("un", 1, False), "the copy wins"


def test_B01_M1_03_reapplying_an_old_copy_picks_the_size_up(conn):
    h = Hood(conn, 1)
    ext = h.ext(1)
    copy = h.capture(ext, [{"external_item_id": "a", "name": "Fanta lata 350ml", "price_cents": 700}])
    conn.execute(
        "update public.public_menu_item set unit = 'un', unit_qty = null, unit_from_name = false"
        " where public_store_id = %s and external_item_id = 'a'",
        (h.store_id(ext),),
    )
    conn.execute("select app.apply_extract_copy(%s)", (copy,))
    a = h.row(ext, "a")
    assert (a["unit"], a["unit_qty"], a["unit_from_name"]) == ("ml", 350, True)


def test_B01_M1_03_a_newer_copy_overrides_a_parsed_size_and_a_renamed_item_loses_it(conn):
    h = Hood(conn, 1)
    ext = h.ext(1)
    h.capture(ext, [{"external_item_id": "a", "name": "Fanta 350ml", "price_cents": 700},
                    {"external_item_id": "b", "name": "Fanta 350ml", "price_cents": 700}])
    h.capture(
        ext,
        [{"external_item_id": "a", "name": "Fanta", "price_cents": 700},
         {"external_item_id": "b", "name": "Fanta 350ml", "price_cents": 700, "unit_qty": 2}],
        at="2026-11-08T10:00:00-03:00",
    )
    a, b = h.row(ext, "a"), h.row(ext, "b")
    assert (a["unit"], a["unit_qty"], a["unit_from_name"]) == ("un", None, False)
    assert (b["unit"], b["unit_qty"], b["unit_from_name"]) == ("un", 2, False)
    # A later copy that says nothing leaves what a copy said.
    h.capture(ext, [{"external_item_id": "b", "name": "Fanta 350ml", "price_cents": 700}], at="2026-11-09T10:00:00-03:00")
    b = h.row(ext, "b")
    assert (b["unit"], b["unit_qty"], b["unit_from_name"]) == ("un", 2, False)


def test_B01_M1_03_sql_and_python_agree_and_pairs_stay_in_the_same_base_unit(conn, repo):
    h = Hood(conn, 2, rules={"min_pairs": 1})
    own_ext, a_ext, b_ext = h.ext(0), h.ext(1), h.ext(2)
    h.capture(own_ext, [{"external_item_id": "own", "name": "Fanta lata 350ml", "price_cents": 700},
                        {"external_item_id": "own2", "name": "Fanta lata", "price_cents": 500}])
    h.capture(a_ext, [{"external_item_id": "a", "name": "Fanta lata 350 ml", "price_cents": 800},
                      {"external_item_id": "a2", "name": "Fanta lata", "price_cents": 600}])
    h.capture(b_ext, [{"external_item_id": "b", "name": "Fanta lata 12 unidades", "price_cents": 6000}])
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    pair_step(repo, h.xid)

    rows = conn.execute(
        "select m.name, i.norm_unit, i.norm_price_cents, i.pair_status, array(select pm.name from public.xray_pair p"
        " join public.public_menu_item pm on pm.id = p.public_menu_item_id where p.xray_item_id = i.id) as cands"
        " from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id where i.xray_id = %s",
        (h.xid,),
    ).fetchall()
    by = {r["name"]: r for r in rows}
    assert by["Fanta lata 350ml"]["norm_unit"] == "100ml"
    assert by["Fanta lata 350ml"]["norm_price_cents"] == 200
    assert by["Fanta lata 350ml"]["cands"] == ["Fanta lata 350 ml"]
    assert by["Fanta lata 350ml"]["pair_status"] == "normalizado"
    assert by["Fanta lata"]["norm_unit"] == "un"
    assert "Fanta lata 350 ml" not in by["Fanta lata"]["cands"]

    for item in repo.items_of_stores([h.target, *h.stores]):
        sql = conn.execute(
            "select app.per_base_m1_03(comparison_price_cents, unit, unit_qty) as b, app.base_unit_m1_03(unit, unit_qty) as u"
            " from public.public_menu_item where id = %s",
            (item.id,),
        ).fetchone()
        norm = normalize_m1_03(item)
        assert Fraction(sql["b"]).limit_denominator(10_000) == norm.per_base
        assert sql["u"] == {"100g": "g", "100ml": "ml"}.get(norm.unit, norm.unit)


def test_B01_M1_03_G_SYN_rows_never_pass_through_the_parser(conn):
    """Seed rows have no copy: their units stay as written, and so do the drawn numbers (M1-03, 03 §6)."""
    n = conn.execute(
        "select count(*) as n from public.public_menu_item m join public.public_store s on s.id = m.public_store_id"
        " where m.unit_from_name and s.external_id like '91a9c35d%%'"
    ).fetchone()["n"]
    assert n == 0
    seed = conn.execute(
        "select count(*) as n from public.public_menu_item where name = 'Açaí 500 ml' and unit = 'un' and unit_qty is null"
    ).fetchone()["n"]
    assert seed > 0, "G-SYN keeps its Açaí 500 ml by unit"


