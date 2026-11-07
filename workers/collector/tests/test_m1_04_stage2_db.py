"""M1-04 Stage 2 and default sizes on the local stack (MARGO_DB_TESTS=1): exclusive items through the worker and the
view, what the AI teaches kept in public.m1_attr_learning, a default size priced per 100 ml, and the report's new
rows. All stores and items are SINTÉTICO; the reader is a fake, never a recorded model answer."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from margo_collector.food import FoodAttrs
from margo_collector.handlers import local_db_url
from margo_collector.repo import PostgresXrayRepo
from margo_collector.steps import calc_step, pair_step

sys.path.insert(0, str(Path(__file__).parent))
from test_b01_m1_load_db import Hood  # noqa: E402
from test_m1_04_stage1_db import report, rows  # noqa: E402

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
        c.execute("delete from public.job where type in ('extract_discover', 'extract_capture', 'xray_neighborhood')")
        c.execute("delete from public.m1_attr_learning")
        yield c


@pytest.fixture
def repo():
    r = PostgresXrayRepo(local_db_url())
    yield r
    r.close()


class FakeReader:
    model = "modelo-de-teste"

    def __init__(self, answer: FoodAttrs) -> None:
        self.answer = answer
        self.calls = 0

    def read(self, items):
        self.calls += 1
        return {i.ref: (self.answer, 0.8) for i in items}


def menu(h: Hood, own: list[dict], theirs: list[dict], n: int) -> None:
    h.capture(h.ext(0), own)
    for i in range(1, n + 1):
        h.capture(h.ext(i), [{**o, "price_cents": o["price_cents"] + 10 * i} for o in theirs])
    h.finish_all()
    h.conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")


def it(ext: str, name: str, price: int, category: str = "Lanches", description: str | None = None) -> dict:
    return {"external_item_id": ext, "name": name, "price_cents": price, "category": category, "description": description}


def test_M1_04_B7_exclusive_through_the_worker_is_no_review_and_has_no_parity(conn, repo):
    h = Hood(conn, 2)
    menu(
        h,
        [it("a", "Dog de bacon", 2000), it("b", "Especial da vila", 4000, description="Pão, hambúrguer, frango, ovo, bacon")],
        [it("a", "Dog de bacon e queijo", 2100), it("b", "Especial da vila frango", 3000, description="Pão, filé de frango")],
        2,
    )
    out = pair_step(repo, h.xid)
    assert out["exclusivo"] == 1 and out["ai_skipped"] is True
    r = rows(conn, h.xid)
    ex = r["Especial da vila"]
    assert (ex["pair_status"], ex["pair_note"], ex["accepted_pairs"]) == ("exclusivo", "exclusivo, sem comparação", 0)
    assert ex["comparables"] == 2, "listed so a founder can pair it by hand"
    assert (r["Dog de bacon"]["pair_status"], r["Dog de bacon"]["pair_note"], r["Dog de bacon"]["comparables"]) == (
        "revisar", "poucos pares", 2), "two stores of the same attributes: few pairs, not exclusive"
    for i in conn.execute("select id from public.xray_item where xray_id = %s and pair_status = 'revisar'", (h.xid,)).fetchall():
        conn.execute("select public.xray_item_set_skipped(%s, true, %s)", (i["id"], h.founder))
    conn.execute("update public.xray set status = 'pairing' where id = %s", (h.xid,))
    conn.execute("select public.xray_calculate(%s, %s)", (h.xid, h.founder))  # an exclusive item does not block
    calc_step(repo, h.xid)
    assert rows(conn, h.xid)["Especial da vila"]["parity_cents"] is None
    assert conn.execute("select count(*) as n from public.m1_attr_learning").fetchone()["n"] == 0, "no key, nothing learned"


def test_M1_04_learnings_are_kept_promoted_and_skip_the_ai(conn, repo):
    bacon = FoodAttrs("burguer", frozenset({"bovino", "bacon"}), 1, None, None, frozenset(), "ia")
    xids = []
    for _ in range(3):
        h = Hood(conn, 1)
        menu(h, [it("a", "Gigante da vila", 3000)], [it("a", "Gigante bacon", 3100, description="Pão, hambúrguer, bacon")], 1)
        reader = FakeReader(bacon)
        out = pair_step(repo, h.xid, reader)
        assert reader.calls == 1 and out["ai_items"] == 1 and out["ai_model"] == "modelo-de-teste"
        xids.append(h.xid)
    learned = conn.execute(
        "select l.tokens, l.items_seen, count(r.*) as runs, max(r.model) as model from public.m1_attr_learning l"
        " join public.m1_attr_learning_run r on r.learning_id = l.id group by l.id"
    ).fetchall()
    assert [(x["tokens"], x["runs"], x["model"]) for x in learned] == [(["gigante", "vila"], 3, "modelo-de-teste")]
    h = Hood(conn, 1)
    menu(h, [it("a", "Gigante da vila", 3000)], [it("a", "Gigante bacon", 3100, description="Pão, hambúrguer, bacon")], 1)
    reader = FakeReader(bacon)
    out = pair_step(repo, h.xid, reader)
    assert reader.calls == 0 and out["attr_learned"] == 1, "promoted after 3 runs: no AI call"


def test_M1_04_a_default_size_is_recorded_noted_and_priced_per_100ml(conn, repo):
    h = Hood(conn, 2)
    menu(h, [it("a", "Água mineral unidade", 400, "Bebidas")], [it("a", "Água mineral natural 500ml", 450, "Bebidas")], 2)
    pair_step(repo, h.xid)
    r = rows(conn, h.xid)["Água mineral unidade"]
    assert (r["pair_status"], r["pair_note"], r["norm_unit"]) == ("normalizado", "tamanho presumido 500 ml", "100ml")
    presumed = conn.execute("select size_presumed_ml from public.xray_item where id = %s", (r["id"],)).fetchone()
    assert presumed["size_presumed_ml"] == 500
    conn.execute("select public.xray_item_review(%s, array(select id from public.xray_pair where xray_item_id = %s), %s)",
                 (r["id"], r["id"], h.founder))
    calc_step(repo, h.xid)
    assert rows(conn, h.xid)["Água mineral unidade"]["parity_cents"] == 465
    out = report(h.xid, "--dry-run").stdout
    assert "pares com tamanho presumido: 2" in out and "A1 bebida com outro tamanho: 0 pela regra" in out


def test_M1_04_the_learnings_report_masks_store_words(conn, repo):
    bacon = FoodAttrs("burguer", frozenset({"bovino", "bacon"}), 1, None, None, frozenset(), "ia")
    h = Hood(conn, 1)
    menu(h, [it("a", "Lanche Zabumba", 3000)], [it("a", "Zabumba bacon", 3100)], 1)
    pair_step(repo, h.xid, FakeReader(bacon))
    import subprocess

    from test_m1_04_stage1_db import ROOT, SCRIPT

    env = {**os.environ, "MARGO_LOCAL_DB_URL": local_db_url()}
    out = subprocess.run([sys.executable, str(SCRIPT), "--learnings"], capture_output=True, text=True, env=env, cwd=ROOT)
    assert out.returncode == 0, out.stderr
    assert "pendentes 1" in out.stdout and "[lanche *]" in out.stdout and "zabumba" not in out.stdout.lower()
