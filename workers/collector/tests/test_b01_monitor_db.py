"""B01 monitorings on the local stack (MARGO_DB_TESTS=1): a monitored run pairs and calculates by itself once 90% of
its captures finished, computes without the open doubts, recalculates after an owner answers, remembers the answer for
the next run, and forgets it on undo. All stores, items and people are SINTÉTICO; ids get a tag per test."""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from margo_collector.handlers import local_db_url
from margo_collector.repo import PostgresXrayRepo
from margo_collector.steps import calc_step, pair_step
from psycopg.types.json import Jsonb

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


BURGER = "X-Burger Sintético da Casa"
UNIQUE = "Prato Sintético Exclusivo Zeta"


class Account:
    """A Lucro (trial) account with a Dono, a Financeiro, a Gerente of kitchen 1 and its own iFood store."""

    def __init__(self, conn: Any) -> None:
        self.conn = conn
        self.tag = uuid.uuid4().hex[:8]
        t = self.tag
        q = conn.execute
        self.id = q(
            "insert into public.account (name, code, plan_id, is_synthetic) values (%s, %s,"
            " (select id from public.plan where code = 'lucro'), true) returning id",
            (f"Conta {t}", f"T-{t}"),
        ).fetchone()["id"]
        q(
            "insert into public.subscription (account_id, plan_id, status) values (%s,"
            " (select id from public.plan where code = 'lucro'), 'trial')",
            (self.id,),
        )
        co = q(
            "insert into public.company (account_id, cnpj, legal_name) values (%s, %s, 'Empresa') returning id",
            (self.id, f"{int(t, 16) % 10**14:014d}"),
        ).fetchone()["id"]
        self.k1, self.k2 = (
            q(
                "insert into public.kitchen (account_id, company_id, name) values (%s, %s, %s) returning id",
                (self.id, co, f"Cozinha {n}"),
            ).fetchone()["id"]
            for n in (1, 2)
        )
        self.dono = self.person("dono", "dono")
        self.fin = self.person("fin", "financeiro")
        self.ger = self.person("ger", "gerente", all_kitchens=False, kitchen=self.k1)
        self.ger2 = self.person("ger2", "gerente", all_kitchens=False, kitchen=self.k2)
        self.target_ext = self.ext(0)
        q(
            "insert into public.channel_store (account_id, kitchen_id, channel, external_id, name, source)"
            " values (%s, %s, 'ifood', %s, 'Loja própria', 'public')",
            (self.id, self.k1, self.target_ext),
        )

    def ext(self, n: int) -> str:
        return f"{self.tag}-0000-4000-8000-{n:012d}"

    @staticmethod
    def url(ext: str) -> str:
        return f"https://www.ifood.com.br/delivery/cidade-sintetica-pr/loja/{ext}"

    def person(self, role_tag: str, role: str, *, all_kitchens: bool = True, kitchen: Any = None) -> str:
        pid = self.conn.execute(
            "insert into public.person (name) values (%s) returning id", (f"{role_tag} {self.tag}",)
        ).fetchone()["id"]
        mid = self.conn.execute(
            "insert into public.membership (account_id, person_id, role, all_kitchens) values (%s, %s, %s, %s) returning id",
            (self.id, pid, role, all_kitchens),
        ).fetchone()["id"]
        if kitchen:
            self.conn.execute(
                "insert into public.membership_kitchen (membership_id, kitchen_id) values (%s, %s)", (mid, kitchen)
            )
        return str(pid)

    def cleanup(self) -> None:
        self.conn.execute("delete from public.job where account_id = %s", (self.id,))


@pytest.fixture
def acc(conn):
    a = Account(conn)
    yield a
    a.cleanup()


def one(conn: Any, sql: str, args: tuple[Any, ...] = ()) -> Any:
    return conn.execute(sql, args).fetchone()


def run_job(conn: Any, jtype: str, xid: str, fn: Any) -> None:
    """Claims the queued job of this run, runs the step, finishes the job (the trigger moves the run on)."""
    j = one(
        conn,
        "select id from public.job where type = %s and payload ->> 'xray_id' = %s and status = 'queued'",
        (jtype, xid),
    )
    assert j is not None, f"{jtype} queued for {xid}"
    conn.execute("select public.claim_job(%s)", (j["id"],))
    fn()
    conn.execute("select public.finish_job(%s, 'done', '{}')", (j["id"],))


def capture_all(conn: Any, acc: Account, menus: dict[str, list[dict[str, Any]]]) -> None:
    """Answers every queued capture of the account with the menus given, through the /api/extract functions."""
    while True:
        job = one(conn, "select * from public.extract_claim_next('teste', 'sandbox')")
        if job is None:
            return
        ext = one(conn, "select payload ->> 'external_id' as e from public.job where id = %s", (job["job_id"],))["e"]
        content = {"kind": "capture", "store": {"external_id": ext}, "items": menus.get(ext, [])}
        conn.execute(
            "select public.extract_record_result(%s, 'scraper', now(), %s)",
            (job["job_id"], Jsonb([{"external_id": ext, "content": content}])),
        )


def start(conn: Any, acc: Account) -> tuple[str, str]:
    """P20 for the account's own store, then a discovery stand-in: two neighbors in the set and their captures queued."""
    out = one(
        conn,
        "select public.monitor_create(%s, %s, %s, null, 7, 3, '{lanches}', '{}', %s, 'sandbox') as r",
        (acc.id, acc.target_ext, acc.url(acc.target_ext), acc.dono),
    )["r"]
    mid, xid = out["monitor_id"], out["xray_id"]
    disc = one(conn, "select id from public.job where type = 'extract_discover' and payload ->> 'xray_id' = %s", (xid,))
    assert disc is not None, "P20 queues the discovery of the first run"
    conn.execute("delete from public.job where id = %s", (disc["id"],))
    for n in (1, 2):
        ext = acc.ext(n)
        sid = one(
            conn,
            "insert into public.public_store (channel, external_id, name, url) values ('ifood', %s, %s, %s) returning id",
            (ext, f"Vizinha {acc.tag} {n}", acc.url(ext)),
        )["id"]
        conn.execute(
            "insert into public.xray_store (xray_id, public_store_id, distance_m, included, capture_slot, capture_rank)"
            " values (%s, %s, %s, true, true, %s)",
            (xid, sid, 100 * n, n),
        )
    conn.execute("update public.xray set collected_at = now() where id = %s", (xid,))
    conn.execute("select public.extract_queue_xray_captures(%s, 'sandbox')", (xid,))
    return mid, xid


def menus(acc: Account) -> dict[str, list[dict[str, Any]]]:
    def it(ext: str, name: str, price: int) -> dict[str, Any]:
        return {"external_item_id": ext, "name": name, "price_cents": price, "category": "Lanches"}

    return {
        acc.target_ext: [it("a1", BURGER, 2000), it("a2", UNIQUE, 4500)],
        acc.ext(1): [it("b1", BURGER, 2600)],
        acc.ext(2): [it("c1", BURGER, 2800)],
    }


def item(conn: Any, xid: str, name: str) -> dict[str, Any]:
    return one(
        conn,
        "select i.*, m.name from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id"
        " where i.xray_id = %s and m.name = %s",
        (xid, name),
    )


def status(conn: Any, xid: str) -> str:
    return one(conn, "select status from public.xray where id = %s", (xid,))["status"]


def to_ready(conn: Any, repo: PostgresXrayRepo, xid: str) -> None:
    run_job(conn, "xray_pair", xid, lambda: pair_step(repo, xid))
    run_job(conn, "xray_calc", xid, lambda: calc_step(repo, xid))


def test_B01_monitored_run_pairs_and_calculates_by_itself_without_the_doubts(conn, repo, acc):
    mid, xid = start(conn, acc)
    assert status(conn, xid) == "collecting"
    capture_all(conn, acc, menus(acc))
    assert status(conn, xid) == "pairing", "B01: the last capture puts the run in pairing, no founder"
    to_ready(conn, repo, xid)
    assert status(conn, xid) == "ready"
    burger = item(conn, xid, BURGER)
    assert burger["pair_status"] == "revisar" and burger["skipped"], "a doubt stays out of the result until answered"
    doubts = one(conn, "select public.monitor_doubts(%s) as d", (xid,))["d"]
    assert doubts["open"] == 1 and doubts["only_yours"] == 1
    assert doubts["items"][0]["group"] == "lanches"
    assert [c["suggested"] for c in doubts["items"][0]["candidates"]].count(True) == 1
    result = one(conn, "select public.monitor_result(%s) as r", (xid,))["r"]
    assert result["doubts_open"] == 1 and result["items_analyzed"] == 0


def test_B01_owner_answer_recalculates_and_applies_on_the_next_run_and_undo_forgets(conn, repo, acc):
    mid, xid = start(conn, acc)
    capture_all(conn, acc, menus(acc))
    to_ready(conn, repo, xid)
    burger = item(conn, xid, BURGER)
    pairs = [r["id"] for r in conn.execute("select id from public.xray_pair where xray_item_id = %s", (burger["id"],))]

    # A02/A03 side: Financeiro only sees; the Gerente of another kitchen may not answer.
    for who in (acc.fin, acc.ger2):
        with pytest.raises(Exception, match="monitor_not_allowed"):
            conn.execute("select public.monitor_answer(%s, %s, %s)", (burger["id"], pairs, who))

    # The Gerente of the store's kitchen answers "é o mesmo" for both (PROVISIONAL m1.portal_gerente_answers).
    conn.execute("select public.monitor_answer(%s, %s, %s)", (burger["id"], pairs, acc.ger))
    with pytest.raises(Exception, match="monitor_already_answered"):
        conn.execute("select public.monitor_answer(%s, %s, %s, true)", (burger["id"], [], acc.dono))
    run_job(conn, "xray_calc", xid, lambda: calc_step(repo, xid))
    burger = item(conn, xid, BURGER)
    assert not burger["skipped"] and burger["parity_cents"] == 2700, "M1-05: a reviewed item has parity from 2 stores"
    assert one(conn, "select count(*) as n from public.monitor_pair_decision where monitor_id = %s", (mid,))["n"] == 2
    assert one(
        conn, "select count(*) as n from public.audit_log where action = 'monitor.answer' and entity_id = %s", (burger["id"],)
    )["n"] == 1

    # The next run copies the store set, finds fresh captures, pairs at once and reuses the answer.
    conn.execute("update public.xray_monitor set next_run_at = now() - interval '1 minute' where id = %s", (mid,))
    assert one(conn, "select public.monitor_queue_due('sandbox') as n")["n"] >= 1
    x2 = str(one(conn, "select last_xray_id from public.xray_monitor where id = %s", (mid,))["last_xray_id"])
    assert x2 != xid and status(conn, x2) == "pairing"
    assert one(conn, "select count(*) as n from public.job where type = 'extract_discover' and payload ->> 'xray_id' = %s", (x2,))["n"] == 0
    to_ready(conn, repo, x2)
    b2 = item(conn, x2, BURGER)
    assert b2["reviewed_at"] is not None and not b2["skipped"], "M1-04: the monitoring's answer applies on the next run"
    assert b2["parity_cents"] == 2700
    assert one(conn, "select public.monitor_doubts(%s) as d", (x2,))["d"]["open"] == 0

    # Undo: the monitoring forgets, the run pairs again by the rules and the item is a doubt again.
    conn.execute("select public.monitor_undo(%s, %s)", (b2["id"], acc.dono))
    to_ready(conn, repo, x2)
    b2 = item(conn, x2, BURGER)
    assert b2["reviewed_at"] is None and b2["skipped"]
    assert one(conn, "select count(*) as n from public.monitor_pair_decision where monitor_id = %s", (mid,))["n"] == 0


def test_B01_confirm_all_suggestions_and_founder_decisions_still_apply(conn, repo, acc):
    mid, xid = start(conn, acc)
    capture_all(conn, acc, menus(acc))
    to_ready(conn, repo, xid)
    conn.execute("select public.monitor_confirm_suggestions(%s, null, %s)", (xid, acc.dono))
    run_job(conn, "xray_calc", xid, lambda: calc_step(repo, xid))
    burger = item(conn, xid, BURGER)
    accepted = one(conn, "select count(*) filter (where accepted) as n from public.xray_pair where xray_item_id = %s", (burger["id"],))
    assert accepted["n"] == 1 and burger["reviewed_at"] is not None
    # A founder's decision on the run stays on a re-run, ahead of the monitoring's memory (M1-04 unchanged).
    founder = one(conn, "select id from public.person where email = 'marlon@margoai.com'")["id"]
    conn.execute("select public.xray_item_review(%s, '{}', %s)", (burger["id"], founder))
    pair_step(repo, xid)
    assert one(conn, "select count(*) filter (where accepted) as n from public.xray_pair where xray_item_id = %s", (burger["id"],))["n"] == 0
