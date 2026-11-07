"""B01 on the local stack (MARGO_DB_TESTS=1): retry lives in the queue, not in the extractor (Marlon, 07/nov).

One attempt per claim. A transitory failure with attempts left goes back to the queue as the same job, with a
not_before time; a permanent one, or the last attempt, fails as before. All stores are SINTÉTICO."""

from __future__ import annotations

import os
import uuid
from datetime import timedelta
from typing import Any

import pytest
from margo_collector.handlers import local_db_url
from psycopg.types.json import Jsonb

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")

TRANSITORY = ("blocked", "timeout", "network")
PERMANENT = ("not_found", "parse_error", "other")
QUEUE = "('extract_discover', 'extract_capture', 'xray_neighborhood')"


class Hood:
    """An X-ray with a target and `n` included neighbors, 100 m apart (as in test_b01_m1_load_db)."""

    def __init__(self, conn: Any, n: int = 1) -> None:
        self.conn = conn
        tag = uuid.uuid4().hex[:8]
        ext = [f"{tag}-0000-4000-8000-{i:012d}" for i in range(n + 1)]
        url = "https://www.ifood.com.br/delivery/cidade-sintetica-pr/loja/{}".format
        founder = conn.execute("select id from public.person where email = 'marlon@margoai.com'").fetchone()["id"]
        self.xid = str(
            conn.execute(
                "select public.xray_create(%s, %s, 3, '{}', %s, %s) as id", (ext[0], url(ext[0]), Jsonb({}), founder)
            ).fetchone()["id"]
        )
        self.stores = []
        for i in range(1, n + 1):
            sid = conn.execute(
                "insert into public.public_store (channel, external_id, name, url) values ('ifood', %s, %s, %s)"
                " returning id",
                (ext[i], f"Vizinha {tag} {i}", url(ext[i])),
            ).fetchone()["id"]
            conn.execute(
                "insert into public.xray_store (xray_id, public_store_id, distance_m, included) values (%s, %s, %s, true)",
                (self.xid, sid, 100 * i),
            )
            self.stores.append(str(sid))

    def queue_captures(self) -> int:
        return self.conn.execute("select public.extract_queue_xray_captures(%s, 'sandbox') as n", (self.xid,)).fetchone()["n"]

    def claim(self) -> Any:
        return self.conn.execute("select * from public.extract_claim_next('teste', 'sandbox')").fetchone()

    def states(self) -> dict[str, str]:
        rows = self.conn.execute("select * from public.xray_capture_states(%s)", (self.xid,)).fetchall()
        return {str(r["public_store_id"]): r["state"] for r in rows}

    def blocker(self) -> str | None:
        return self.conn.execute("select public.xray_pair_blocker(%s) as b", (self.xid,)).fetchone()["b"]


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
        c.execute(f"delete from public.job where type in {QUEUE}")
        yield c
        c.execute(f"delete from public.job where type in {QUEUE}")
        c.execute("delete from public.alert where title like 'Tarefa extract_capture travou%'")


def one_capture(conn: Any) -> tuple[Hood, Any]:
    """An X-ray with one neighbor; only that neighbor's capture stays in the queue."""
    h = Hood(conn, 1)
    h.queue_captures()
    conn.execute(
        "delete from public.job where type = 'extract_capture' and payload ->> 'public_store_id' <> %s", (h.stores[0],)
    )
    return h, job_of(conn, h.stores[0])


def job_of(conn: Any, store: str) -> dict[str, Any]:
    return conn.execute(
        "select * from public.job where type = 'extract_capture' and payload ->> 'public_store_id' = %s", (store,)
    ).fetchone()


def job(conn: Any, job_id: Any) -> dict[str, Any]:
    return conn.execute("select * from public.job where id = %s", (job_id,)).fetchone()


def fail(conn: Any, job_id: Any, reason: str) -> dict[str, Any]:
    return conn.execute("select public.extract_record_failure(%s, %s, 'detalhe') as r", (job_id, reason)).fetchone()["r"]


def wait_over(conn: Any, job_id: Any) -> None:
    conn.execute("update public.job set not_before = now() - interval '1 second' where id = %s", (job_id,))


def now(conn: Any) -> Any:
    return conn.execute("select now() as t").fetchone()["t"]


def runs(conn: Any, job_id: Any) -> list[dict[str, Any]]:
    return conn.execute(
        "select status, error from public.extract_run where job_id = %s order by started_at, id", (job_id,)
    ).fetchall()


def test_B01_retry_params_and_reasons_live_in_one_place(conn):
    params = {
        r["key"]: r["value"]
        for r in conn.execute(
            "select key, value from public.rule_param where key like 'm1.extract\\_retry%%' or key = 'm1.extract_max_attempts'"
        ).fetchall()
    }
    assert params == {
        "m1.extract_max_attempts": 3,
        "m1.extract_retry_wait_minutes_1": 10,
        "m1.extract_retry_wait_minutes_2": 30,
        "m1.extract_retry_reason_blocked": 1,
        "m1.extract_retry_reason_timeout": 1,
        "m1.extract_retry_reason_network": 1,
        "m1.extract_retry_reason_stuck": 1,
        "m1.extract_retry_reason_not_found": 0,
        "m1.extract_retry_reason_parse_error": 0,
        "m1.extract_retry_reason_other": 0,
    }
    at = "select app.extract_retry_at(%s, %s, '2026-11-07T16:30:00-03:00') as t"
    assert conn.execute(at, ("blocked", 1)).fetchone()["t"].isoformat() == "2026-11-07T19:40:00+00:00"
    assert conn.execute(at, ("timeout", 2)).fetchone()["t"].isoformat() == "2026-11-07T20:00:00+00:00"
    assert conn.execute(at, ("network", 3)).fetchone()["t"] is None, "the third attempt was the last"
    assert conn.execute(at, ("not_found", 1)).fetchone()["t"] is None
    assert conn.execute(at, ("desconhecido", 1)).fetchone()["t"] is None, "an unknown reason is permanent"


@pytest.mark.parametrize("reason", TRANSITORY)
def test_B01_transitory_failure_requeues_the_same_job_and_fails_after_the_last_attempt(conn, reason):
    h, queued = one_capture(conn)
    first = h.claim()
    assert first["job_id"] == queued["id"]
    t0 = now(conn)
    assert fail(conn, first["job_id"], reason) == {"wake": []}

    j = job(conn, first["job_id"])
    assert (j["status"], j["attempts"], j["dedupe_key"]) == ("queued", 1, queued["dedupe_key"])
    assert j["claimed_at"] is None and j["finished_at"] is None
    assert timedelta(minutes=10) <= j["not_before"] - t0 < timedelta(minutes=11)
    assert j["log"][-1]["event"] == "retry_queued" and j["log"][-1]["reason"] == reason
    assert h.claim() is None, "not offered before not_before"

    wait_over(conn, j["id"])
    second = h.claim()
    assert second["job_id"] == j["id"], "the server re-offers the same job"
    t1 = now(conn)
    fail(conn, j["id"], reason)
    j = job(conn, j["id"])
    assert (j["status"], j["attempts"]) == ("queued", 2)
    assert timedelta(minutes=30) <= j["not_before"] - t1 < timedelta(minutes=31)

    wait_over(conn, j["id"])
    assert h.claim()["job_id"] == j["id"]
    fail(conn, j["id"], reason)
    j = job(conn, j["id"])
    assert (j["status"], j["attempts"]) == ("failed", 3)
    assert j["log"][-1]["event"] == "failed" and j["log"][-1]["reason"] == reason
    assert runs(conn, j["id"]) == [{"status": "failed", "error": f"{reason}: detalhe"}] * 3, "every attempt is its own run"
    assert h.states()[h.stores[0]] == "failed"


@pytest.mark.parametrize("reason", PERMANENT)
def test_B01_permanent_failure_fails_on_the_first_attempt(conn, reason):
    h, queued = one_capture(conn)
    h.claim()
    fail(conn, queued["id"], reason)
    j = job(conn, queued["id"])
    assert (j["status"], j["attempts"], j["not_before"]) == ("failed", 1, None)
    assert len(runs(conn, j["id"])) == 1


def test_B01_claim_skips_waiting_jobs_and_keeps_oldest_first(conn):
    h = Hood(conn, 2)
    h.queue_captures()
    order = [
        r["id"]
        for r in conn.execute(
            "select id from public.job where type = 'extract_capture' order by created_at, id"
        ).fetchall()
    ]
    assert h.claim()["job_id"] == order[0]
    fail(conn, order[0], "blocked")
    assert h.claim()["job_id"] == order[1], "the waiting job is skipped"
    wait_over(conn, order[0])
    assert h.claim()["job_id"] == order[0], "past its time it is the oldest again"
    assert h.claim()["job_id"] == order[2]


def test_B01_stuck_job_counts_its_attempts_and_fails_after_the_last(conn):
    """02 §4.5 for extract jobs: a stuck claim is an attempt like any other, with no extra ones."""
    h, queued = one_capture(conn)
    jid = queued["id"]
    for attempt in (1, 2):
        assert h.claim()["job_id"] == jid
        conn.execute("update public.job set claimed_at = now() - interval '31 minutes' where id = %s", (jid,))
        out = conn.execute("select * from public.requeue_stuck_jobs(now())").fetchall()
        assert [(r["job_id"], r["outcome"]) for r in out] == [(jid, "requeued")]
        j = job(conn, jid)
        assert (j["status"], j["attempts"]) == ("queued", attempt)
        assert j["not_before"] > now(conn), "waits like any transitory failure"
        assert h.blocker() == "captures"
        wait_over(conn, jid)
    assert h.claim()["job_id"] == jid
    conn.execute("update public.job set claimed_at = now() - interval '31 minutes' where id = %s", (jid,))
    out = conn.execute("select * from public.requeue_stuck_jobs(now())").fetchall()
    assert [(r["job_id"], r["outcome"]) for r in out] == [(jid, "failed")]
    assert out[0]["alert_id"] is not None
    j = job(conn, jid)
    assert (j["status"], j["attempts"], j["log"][-1]["reason"]) == ("failed", 3, "stuck")
    title = conn.execute("select title from public.alert where id = %s", (out[0]["alert_id"],)).fetchone()["title"]
    assert title == "Tarefa extract_capture travou na última tentativa: mais de 30 minutos rodando"
    assert h.states()[h.stores[0]] == "failed"


def test_B01_other_jobs_keep_the_stuck_rule_of_once(conn):
    jid = conn.execute("insert into public.job (type) values ('xray_neighborhood') returning id").fetchone()["id"]
    conn.execute("select public.claim_job(%s)", (jid,))
    future = conn.execute("select now() + interval '31 minutes' as t").fetchone()["t"]
    conn.execute("select * from public.requeue_stuck_jobs(%s)", (future,))
    assert job(conn, jid)["not_before"] is None
    conn.execute("select public.claim_job(%s)", (jid,))
    later = conn.execute("select now() + interval '62 minutes' as t").fetchone()["t"]
    conn.execute("select * from public.requeue_stuck_jobs(%s)", (later,))
    assert job(conn, jid)["status"] == "failed"
    conn.execute("delete from public.alert where title like 'Tarefa xray_neighborhood travou%'")


def test_B01_C03_waiting_to_retry_is_pending_for_pairing_and_failed_only_at_the_end(conn):
    h, queued = one_capture(conn)
    jid = queued["id"]
    h.claim()
    fail(conn, jid, "timeout")
    assert h.states()[h.stores[0]] == "missing"
    assert h.blocker() == "captures", "waiting to retry holds the pairing"
    retries = conn.execute("select * from public.xray_capture_retries(%s)", (h.xid,)).fetchall()
    assert [(str(r["public_store_id"]), r["retry_at"]) for r in retries] == [(h.stores[0], job(conn, jid)["not_before"])]
    assert conn.execute("select count(*) as n from public.job where type = 'xray_neighborhood'").fetchone()["n"] == 0, (
        "no M1-02 re-run while the capture still waits"
    )

    for _ in range(2):
        wait_over(conn, jid)
        h.claim()
        out = fail(conn, jid, "timeout")
    assert out["wake"], "the final failure wakes the neighborhood like any failed capture"
    assert h.states()[h.stores[0]] == "failed"
    assert conn.execute("select * from public.xray_capture_retries(%s)", (h.xid,)).fetchall() == []
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    assert h.blocker() is None


def test_B01_daily_cron_queues_no_duplicate_for_a_store_waiting_to_retry(conn):
    h, queued = one_capture(conn)
    h.claim()
    fail(conn, queued["id"], "network")
    conn.execute("select public.extract_queue_due('sandbox')")
    rows = conn.execute(
        "select id, status from public.job where type = 'extract_capture' and payload ->> 'public_store_id' = %s",
        (h.stores[0],),
    ).fetchall()
    assert [(r["id"], r["status"]) for r in rows] == [(queued["id"], "queued")]
    h.queue_captures()
    assert job_of(conn, h.stores[0])["id"] == queued["id"], "nor does a re-run of the X-ray's captures"


def test_B01_retry_functions_are_service_role_only(conn):
    priv = "select has_function_privilege(%s, %s, 'execute') as ok"
    for fn in ("public.xray_capture_retries(uuid)",):
        assert conn.execute(priv, ("service_role", fn)).fetchone()["ok"]
        assert not conn.execute(priv, ("authenticated", fn)).fetchone()["ok"]
    assert not conn.execute(priv, ("authenticated", "app.extract_retry_at(text, integer, timestamptz)")).fetchone()["ok"]
