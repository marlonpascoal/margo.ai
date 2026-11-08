"""M1-04 Stage 1 on the local stack (MARGO_DB_TESTS=1): the size column over the one parser, the worker's steps, C04's
example of a pair, the load gate, and the read-only pairing report. All stores and items are SINTÉTICO."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from margo_collector.handlers import local_db_url
from margo_collector.repo import PostgresXrayRepo
from margo_collector.steps import LoadPending, calc_step, pair_step
from psycopg import errors

sys.path.insert(0, str(Path(__file__).parent))
from test_b01_m1_load_db import Hood  # noqa: E402

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "m1_pairing_report.py"


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(local_db_url(), autocommit=True, row_factory=dict_row) as c:
        c.execute("delete from public.job where type in ('extract_discover', 'extract_capture', 'xray_neighborhood')")
        yield c


@pytest.fixture
def repo():
    r = PostgresXrayRepo(local_db_url())
    yield r
    r.close()


def sold(h: Hood, items: dict[str, tuple[str, int, str]], n: int) -> None:
    """Captures: the target's items, and the same menu in `n` neighbors."""
    own = [{"external_item_id": k, "name": v[0], "category": v[2], "price_cents": v[1]} for k, v in items.items()]
    h.capture(h.ext(0), own)
    for i in range(1, n + 1):
        h.capture(h.ext(i), [{**o, "price_cents": o["price_cents"] + i * 10} for o in own])
    h.finish_all()
    h.conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")


def rows(conn, xid: str) -> dict[str, dict]:
    return {
        r["name"]: r
        for r in conn.execute("select * from public.xray_item_view where xray_id = %s", (xid,)).fetchall()
    }


@pytest.mark.parametrize(
    ("name", "ml"),
    [
        ("Soda kiwi s/açúcar lt 300ml", 300),
        ("300ml - soda kiwi - pet 300ml", 300),
        ("Soda kiwi lata com 300ml", 300),
        ("Soda kiwi2 litros", 2000),
        ("Água c/ gás 300ml", 300),
        ("77 - Soda kiwi 300ml", 300),
        ("Soda kiwi 1 l", 1000),
        ("Soda kiwi 300ml 2l", None),
        ("Soda kiwi lata", None),
        ("Soda kiwi + limão 300ml", None),
        ("Batata 200g", None),
    ],
)
def test_A1_the_one_parser_and_the_column_read_a_size_in_ml(conn, name, ml):
    got = conn.execute("select app.size_from_name_ml_m1_04(%s) as v", (name,)).fetchone()["v"]
    assert got == ml


def test_A1_the_service_role_can_write_a_menu_row_and_its_size_is_read(conn):
    """The web app inserts menu rows as service_role: the generated size must not need the closed parser."""
    store = conn.execute(
        "insert into public.public_store (channel, external_id, name) values ('ifood', gen_random_uuid()::text, 'Loja SINTÉTICO')"
        " returning id"
    ).fetchone()["id"]
    with conn.transaction():
        conn.execute("set local role service_role")
        row = conn.execute(
            "insert into public.public_menu_item (public_store_id, external_item_id, name, price_cents, collected_at)"
            " values (%s, 'x', 'Soda kiwi 2 litros', 900, now()) returning size_from_name_ml",
            (store,),
        ).fetchone()
    assert row["size_from_name_ml"] == 2000


def test_B1_identical_beverages_confirm_through_the_worker_and_b4_shows_one(conn, repo):
    h = Hood(conn, 2)
    sold(
        h,
        {
            "a": ("Sprite pet 2 litros", 900, "Bebidas"),
            "b": ("Água fria com gás 500ml", 300, "Bebidas"),
            "c": ("Soda kiwi garrafa", 400, "Bebidas"),
        },
        2,
    )
    other = h.ext(1)
    h.capture(other, [{"external_item_id": "z", "name": "Sprite pet 350ml", "category": "Bebidas", "price_cents": 500}],
              at="2026-11-07T09:00:00-03:00")
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    pair_step(repo, h.xid)
    r = rows(conn, h.xid)
    two = r["Sprite pet 2 litros"]
    assert (two["pair_status"], two["pair_note"]) == ("normalizado", None), "two stores confirm, no poucos pares"
    assert two["accepted_pairs"] == two["comparables"] == 2
    assert two["example_name"] == "Sprite pet 2 litros", "B4: the example is the same product"
    assert r["Água fria com gás 500ml"]["pair_status"] == "normalizado"
    can = r["Soda kiwi garrafa"]
    assert (can["pair_status"], can["pair_note"], can["accepted_pairs"]) == ("revisar", "tamanho ilegível", 0)
    assert can["comparables"] == 2, "listed for a founder"
    assert can["example_name"] is None, "B4: an unconfirmed beverage shows no example"
    category = "select item_category from public.xray_item where id = %s"
    assert conn.execute(category, (two["id"],)).fetchone()["item_category"] == "bebidas"


def test_B3_parity_counts_stores_through_the_worker_and_a_founder_review_waives_it(conn, repo):
    h = Hood(conn, 2)
    sold(h, {"a": ("Sprite pet 2 litros", 900, "Bebidas"), "b": ("Soda kiwi 300ml", 300, "Bebidas")}, 2)
    pair_step(repo, h.xid)
    r = rows(conn, h.xid)
    conn.execute(
        "select public.xray_item_review(%s, array(select id from public.xray_pair where xray_item_id = %s), %s)",
        (r["Soda kiwi 300ml"]["id"], r["Soda kiwi 300ml"]["id"], h.founder),
    )
    calc_step(repo, h.xid)
    r = rows(conn, h.xid)
    assert r["Sprite pet 2 litros"]["parity_cents"] is None, "two stores, min_pairs 5"
    assert r["Soda kiwi 300ml"]["parity_cents"] == 315


def test_M1_04_founder_decisions_survive_a_rerun_even_on_a_blocked_pair(conn, repo):
    h = Hood(conn, 1)
    h.capture(h.ext(0), [{"external_item_id": "a", "name": "Sprite pet 2 litros", "category": "Bebidas", "price_cents": 900},
                         {"external_item_id": "b", "name": "Sprite pet 500 ml", "category": "Bebidas", "price_cents": 500}])
    h.capture(h.ext(1), [{"external_item_id": "a", "name": "Sprite 2l", "category": "Bebidas", "price_cents": 910},
                         {"external_item_id": "b", "name": "Sprite pet 350ml", "category": "Bebidas", "price_cents": 300}])
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    pair_step(repo, h.xid)
    r = rows(conn, h.xid)
    # An older pair a founder took: the rule alone would never list it.
    other = conn.execute("select id from public.public_menu_item where public_store_id = %s and external_item_id = 'b'",
                         (h.stores[0],)).fetchone()["id"]
    conn.execute("insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted, by) values (%s, %s, 0.5, true, %s)",
                 (r["Sprite pet 500 ml"]["id"], other, h.founder))
    first = conn.execute("select id from public.xray_pair where xray_item_id = %s and by is null", (r["Sprite pet 2 litros"]["id"],)).fetchone()["id"]
    conn.execute("select public.xray_item_review(%s, %s::uuid[], %s)", (r["Sprite pet 2 litros"]["id"], [], h.founder))
    pair_step(repo, h.xid)
    pairs = conn.execute(
        "select i.public_menu_item_id, p.id, p.accepted, p.by from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id"
        " where i.xray_id = %s", (h.xid,)
    ).fetchall()
    assert any(p["accepted"] and p["by"] for p in pairs), "the blocked pair a founder accepted stays"
    assert any(p["id"] == first and not p["accepted"] and p["by"] for p in pairs), "the identical pair a founder rejected stays out"


def test_B5_pairing_does_not_run_while_captures_are_pending_and_states_are_counted(conn, repo):
    h = Hood(conn, 2)
    h.queue_captures()
    with pytest.raises(LoadPending):
        pair_step(repo, h.xid)
    assert set(h.states().values()) == {"missing"}, "C03 shows what is missing"
    h.finish_all(failed_store=h.stores[0])
    assert h.states()[h.stores[0]] == "failed", "C03 shows what failed"
    assert h.states()[h.stores[1]] == "done"
    assert h.blocker() is None, "a failed capture does not hold pairing"
    pair_step(repo, h.xid)


def finish(h: Hood, n: int, *, keep: str | None = None) -> None:
    """Answers `n` queued captures, none of them the store `keep`."""
    done = 0
    while done < n:
        job = h.claim()
        assert job is not None
        if h.job_store(job["job_id"]) == keep:
            h.conn.execute("update public.job set status = 'queued', claimed_at = null where id = %s", (job["job_id"],))
            h.conn.execute("delete from public.extract_run where job_id = %s", (job["job_id"],))
            h.conn.execute("update public.job set created_at = now() + interval '1 day' where id = %s", (job["job_id"],))
            continue
        h.conn.execute("select public.finish_job(%s, 'done', '{}')", (job["job_id"],))
        h.conn.execute("update public.extract_run set status = 'done' where job_id = %s", (job["job_id"],))
        done += 1


def test_B01_B5_pairing_opens_at_90_percent_of_the_slots_rounding_up(conn):
    h = Hood(conn, 10)  # 11 slots with the target: 9.9 rounds up to 10
    assert h.queue_captures() == 11
    assert conn.execute("select * from public.xray_pair_quorum(%s)", (h.xid,)).fetchone() == {"finished": 0, "total": 11, "required": 10}
    finish(h, 9)
    assert h.blocker() == "captures"
    finish(h, 1)
    assert h.blocker() != "captures"
    assert conn.execute("select * from public.xray_pair_quorum(%s)", (h.xid,)).fetchone()["finished"] == 10


def test_B01_B5_a_failed_capture_counts_as_finished_and_past_the_cap_does_not_count(conn):
    h = Hood(conn, 2)
    h.queue_captures()
    h.finish_all(failed_store=h.stores[0])
    assert h.blocker() is None
    assert conn.execute("select * from public.xray_pair_quorum(%s)", (h.xid,)).fetchone() == {"finished": 3, "total": 3, "required": 3}


def test_B01_B5_a_target_without_a_finished_capture_or_a_menu_never_pairs(conn, repo):
    h = Hood(conn, 2)
    h.queue_captures()
    h.finish_all(failed_store=h.target)
    assert h.states()[h.target] == "failed"
    assert h.blocker() == "target", "everything finished, but the target failed"
    with pytest.raises(LoadPending):
        pair_step(repo, h.xid)
    with pytest.raises(errors.CheckViolation, match="xray_load_pending"):
        h.confirm()

    bare = Hood(conn, 1)
    conn.execute("update public.public_menu_item set removed_at = now() where public_store_id = %s", (bare.target,))
    assert bare.blocker() == "target", "a done capture is not enough without a menu"


def test_B01_B5_an_active_neighborhood_job_still_blocks_above_the_threshold(conn):
    h = Hood(conn, 2)
    h.queue_captures()
    h.finish_all()
    conn.execute(
        "insert into public.job (type, payload, dedupe_key) values ('xray_neighborhood', jsonb_build_object('xray_id', %s::text), %s)",
        (h.xid, f"xray_neighborhood:{h.xid}"),
    )
    assert h.blocker() == "neighborhood"


def test_B01_B5_a_store_still_running_is_left_out_marked_and_a_late_capture_changes_nothing(conn, repo):
    h = Hood(conn, 10, rules={"min_pairs": 1})
    late = h.stores[-1]
    for i, s in enumerate(h.stores):
        h.item(s, "x", "Cheeseburger peixe", 2000 + i)
        conn.execute("update public.public_menu_item set category = 'Lanches' where public_store_id = %s", (s,))
    h.item(h.target, "x", "Cheeseburger peixe", 1500)
    conn.execute("update public.public_menu_item set category = 'Lanches' where public_store_id = %s", (h.target,))
    h.queue_captures()
    finish(h, 10, keep=late)
    assert h.states()[late] == "missing"
    assert h.blocker() is None
    h.confirm()
    pair_step(repo, h.xid)
    q = (
        "select m.public_store_id from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id"
        " join public.public_menu_item m on m.id = p.public_menu_item_id where i.xray_id = %s"
    )
    first = sorted(str(r["public_store_id"]) for r in conn.execute(q, (h.xid,)).fetchall())
    assert late not in first and len(first) == 9
    marked = "select public_store_id from public.xray_store where xray_id = %s and left_out_of_pairing"
    assert [str(r["public_store_id"]) for r in conn.execute(marked, (h.xid,)).fetchall()] == [late]

    h.finish_all()
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    assert h.states()[late] == "done"
    assert sorted(str(r["public_store_id"]) for r in conn.execute(q, (h.xid,)).fetchall()) == first, "only a person re-runs it"
    assert conn.execute(marked, (h.xid,)).fetchall() != []

    pair_step(repo, h.xid)
    assert late in [str(r["public_store_id"]) for r in conn.execute(q, (h.xid,)).fetchall()]
    assert conn.execute(marked, (h.xid,)).fetchall() == []


def report(xid: str, *args: str, url: str | None = None) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "MARGO_LOCAL_DB_URL": url or local_db_url()}
    return subprocess.run([sys.executable, str(SCRIPT), xid, *args], capture_output=True, text=True, env=env, cwd=ROOT)


def counts(conn, xid: str) -> tuple:
    return conn.execute(
        "select (select count(*) from public.xray_item where xray_id = %(x)s) as i,"
        " (select count(*) from public.xray_pair p join public.xray_item i on i.id = p.xray_item_id where i.xray_id = %(x)s) as p,"
        " (select count(*) from public.audit_log) as a",
        {"x": xid},
    ).fetchone()


def scored(h: Hood, repo, conn) -> None:
    sold(
        h,
        {
            "a": ("Sprite pet 2 litros", 900, "Bebidas"),
            "b": ("Soda kiwi lata", 400, "Bebidas"),
            "c": ("Gigante da casa", 3000, "Lanches"),
            "d": ("Bacon", 500, "Adicionais"),
        },
        2,
    )
    pair_step(repo, h.xid)


def test_A1_A4_B1_B3_the_report_is_all_zeros_counts_only_and_says_the_same_both_ways(conn, repo):
    h = Hood(conn, 2)
    scored(h, repo, conn)
    before = counts(conn, h.xid)
    stored, dry = report(h.xid), report(h.xid, "--dry-run")
    assert stored.returncode == dry.returncode == 0, stored.stderr + dry.stderr
    assert counts(conn, h.xid) == before, "nothing written"
    for out in (stored.stdout, dry.stdout):
        for code in ("A1", "A2", "A3", "A4"):
            assert any(line.startswith(code) and ": 0 pela regra, 0 por fundador" in line for line in out.splitlines()), out
        assert "B1 bebidas em revisar com item idêntico em alguma loja: 0" in out
        assert "sem motivo válido: 0" in out
        assert "abaixo de 5 lojas, sem revisão de fundador: 0" in out
        assert "estágio 2:" in out and "B7 exclusivos com item idêntico em alguma loja: 0" in out
        for name in ("Sprite pet", "Soda kiwi", "Gigante da casa", "Bacon", h.tag):
            assert name not in out, "counts only"
    assert stored.stdout.splitlines()[3:] == dry.stdout.splitlines()[3:]


def test_A1_the_report_catches_a_bad_accepted_pair_of_the_old_rule(conn, repo):
    h = Hood(conn, 1)
    h.capture(h.ext(0), [{"external_item_id": "a", "name": "Sprite pet 2 litros", "category": "Bebidas", "price_cents": 900}])
    h.capture(h.ext(1), [{"external_item_id": "b", "name": "Sprite pet 350ml", "category": "Bebidas", "price_cents": 300},
                         {"external_item_id": "a", "name": "Sprite 2l", "category": "Bebidas", "price_cents": 900}])
    conn.execute("update public.job set status = 'done', finished_at = now() where type = 'xray_neighborhood'")
    pair_step(repo, h.xid)
    item = rows(conn, h.xid)["Sprite pet 2 litros"]["id"]
    other = conn.execute("select id from public.public_menu_item where public_store_id = %s and external_item_id = 'b'",
                         (h.stores[0],)).fetchone()["id"]
    conn.execute("insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted) values (%s, %s, 0.8, true)", (item, other))
    assert "A1 bebida com outro tamanho: 1 pela regra" in report(h.xid).stdout
    assert "A1 bebida com outro tamanho: 0 pela regra" in report(h.xid, "--dry-run").stdout


def test_the_report_refuses_an_ambiguous_id(conn):
    out = report("")
    assert out.returncode != 0
    assert "more than one X-ray" in out.stderr + out.stdout


def test_the_report_session_refuses_any_write_and_any_remote_database():
    sys.path.insert(0, str(ROOT / "scripts"))
    import m1_pairing_report as r

    c = r.connect(local_db_url())
    try:
        with pytest.raises(errors.ReadOnlySqlTransaction), c.transaction():
            c.execute("update public.xray set status = status")
    finally:
        c.close()
    out = report("00000000", url="postgresql://u:p@db.exemplo.test:5432/postgres")
    assert out.returncode != 0
    assert "only a local database" in out.stderr + out.stdout
