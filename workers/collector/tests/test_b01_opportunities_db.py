"""B01 P23 "Oportunidades" on the local stack (MARGO_DB_TESTS=1): a calculated own run queues one xray_opportunities job
when m1.oportunidades_ia is on; without a key the job is done with no row; with a (fake) writer the valid
opportunities are stored once, never rewritten, and monitor_opportunities returns them with the item names. All stores,
items and people are SINTÉTICO; the writer is a fake, never a recorded model answer."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from margo_collector.handlers import local_db_url
from margo_collector.opportunities import PROMPT_VERSION, ClaudeOpportunityWriter, brl, opportunities_step
from margo_collector.repo import PostgresXrayRepo
from margo_collector.steps import calc_step

sys.path.insert(0, str(Path(__file__).parent))
from test_b01_monitor_db import BURGER, Account, capture_all, item, menus, one, run_job, start, to_ready  # noqa: E402

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")


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


@pytest.fixture
def acc(conn):
    a = Account(conn)
    yield a
    a.cleanup()


class Block:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class FakeClient:
    """Says what the test asks; never a recorded model answer."""

    def __init__(self, answer):
        self.answer, self.calls = answer, 0

    @property
    def messages(self):
        return self

    def create(self, **kw):
        self.calls += 1
        r = type("R", (), {})()
        r.stop_reason, r.content = "end_turn", [Block(json.dumps({"oportunidades": self.answer}, ensure_ascii=False))]
        return r


def queued(conn, xid: str) -> int:
    return one(
        conn,
        "select count(*) as n from public.job where type = 'xray_opportunities' and status = 'queued'"
        " and payload ->> 'xray_id' = %s and dedupe_key = 'xray_opportunities:' || %s",
        (xid, xid),
    )["n"]


def test_B01_opportunities_job_after_calc_skip_without_key_then_stored_once(conn, repo, acc):
    mid, xid = start(conn, acc)
    capture_all(conn, acc, menus(acc))
    to_ready(conn, repo, xid)
    assert one(conn, "select target_kind from public.xray where id = %s", (xid,))["target_kind"] == "own"
    assert queued(conn, xid) == 1, "B01: the calculation queues the opportunities of the run"

    # No ANTHROPIC_API_KEY: done, no row.
    run_job(conn, "xray_opportunities", xid, lambda: opportunities_step(repo, xid, None))
    assert one(conn, "select public.monitor_opportunities(%s) as o", (xid,))["o"] is None

    # The owner answers the doubt; the recalculation queues it again (no row yet).
    conn.execute("select public.monitor_confirm_suggestions(%s, null, %s)", (xid, acc.dono))
    run_job(conn, "xray_calc", xid, lambda: calc_step(repo, xid))
    burger = item(conn, xid, BURGER)
    assert burger["reading"] == "pode_subir" and burger["parity_cents"] in (2600, 2800)
    assert queued(conn, xid) == 1

    bid = str(burger["id"])
    title = f"Suba o X-Burger para {brl(burger['parity_cents'])}"
    why = f"Está {brl(burger['parity_cents'] - 2000)} abaixo do meio. Subir pode vender menos."
    client = FakeClient(
        [
            {"title": title, "why": why, "item_ids": [bid], "lever": "subir_preco"},
            {"title": "Suba para R$ 31,40", "why": "Número inventado.", "item_ids": [bid], "lever": "subir_preco"},
            {"title": "Mais lucro no lanche", "why": "Subir.", "item_ids": [bid], "lever": "subir_preco"},
        ]
    )
    writer = ClaudeOpportunityWriter(client=client, model="modelo-de-teste")
    run_job(conn, "xray_opportunities", xid, lambda: opportunities_step(repo, xid, writer))
    o = one(conn, "select public.monitor_opportunities(%s) as o", (xid,))["o"]
    assert o["dropped"] == 2 and o["model"] == "modelo-de-teste" and o["prompt_version"] == PROMPT_VERSION
    assert o["items"] == [
        {"rank": 1, "title": title, "why": why, "lever": "subir_preco", "items": [{"item_id": bid, "name": BURGER}]}
    ]

    # Once per run: a later finished calculation queues nothing, and the row is never rewritten.
    j = one(
        conn,
        "insert into public.job (type, payload, account_id, status) values ('xray_calc', %s, %s, 'running') returning id",
        (json.dumps({"xray_id": xid}), acc.id),
    )["id"]
    conn.execute("update public.job set status = 'done' where id = %s", (j,))
    assert queued(conn, xid) == 0
    assert opportunities_step(repo, xid, writer) == {"skipped": "exists"} and client.calls == 1
    with pytest.raises(Exception, match="never changed"):
        conn.execute("update public.xray_opportunity set dropped = 0 where xray_id = %s", (xid,))


def test_B01_opportunities_flag_off_queues_nothing(conn, repo, acc):
    conn.execute(
        "insert into public.feature_override (flag_key, env, account_id, value, reason)"
        " values ('m1.oportunidades_ia', 'sandbox', %s, false, 'teste')",
        (acc.id,),
    )
    mid, xid = start(conn, acc)
    capture_all(conn, acc, menus(acc))
    try:
        to_ready(conn, repo, xid)
        assert queued(conn, xid) == 0
    finally:
        conn.execute("delete from public.feature_override where account_id = %s", (acc.id,))

