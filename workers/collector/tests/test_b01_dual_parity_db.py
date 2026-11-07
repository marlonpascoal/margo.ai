"""B01, dual parity on the local stack (MARGO_DB_TESTS=1): synthetic rows through the worker's steps and the SQL
snapshot. The G-SYN seed has no promotion and stays as drawn; these rows are built here and tagged per run."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from margo_collector.handlers import local_db_url
from margo_collector.repo import PostgresXrayRepo
from margo_collector.steps import calc_step, pair_step
from psycopg.types.json import Jsonb

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")

COLLECTED = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
NEIGHBORS = 5
FIELDS = "own_cents, parity_cents, gap_pct, loss_cents, reading, parity_full_cents, gap_full_pct, full_price_room"


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


class Scene:
    """A target store and five neighbors, in another place than the seed. A menu line is
    (item name, own price, own original, neighbors' price, neighbors' original)."""

    def __init__(self, conn: Any, menu: list[tuple[str, int, int | None, int, int | None]]) -> None:
        self.conn = conn
        self.menu = menu
        self.tag = uuid.uuid4().hex[:8]
        founder = conn.execute("select id from public.person where email = 'marlon@margoai.com'").fetchone()["id"]
        self.target_ext = self.ext(0)
        self.xid = str(
            conn.execute(
                "select public.xray_create(%s, %s, 3, %s, '{}'::jsonb, %s) as id",
                (self.target_ext, f"https://www.ifood.com.br/delivery/x/y/{self.target_ext}", ["Lanches"], founder),
            ).fetchone()["id"]
        )
        self.target = self.store_id(self.target_ext)
        conn.execute("update public.xray set collected_at = %s where id = %s", (COLLECTED, self.xid))
        for name, price, original, _, _ in menu:
            self.item(self.target, name, price, original)
        for n in range(1, NEIGHBORS + 1):
            ext = self.ext(n)
            conn.execute(
                "insert into public.public_store (channel, external_id, name) values ('ifood', %s, %s)",
                (ext, f"Vizinha {self.tag} {n}"),
            )
            sid = self.store_id(ext)
            conn.execute(
                "insert into public.xray_store (xray_id, public_store_id, distance_m, included) values (%s, %s, %s, true)",
                (self.xid, sid, 100 * n),
            )
            for name, _, _, price, original in menu:
                self.item(sid, name, price, original)

    def ext(self, n: int) -> str:
        return f"{self.tag}-0000-4000-8000-{n:012d}"

    def store_id(self, ext: str) -> str:
        return str(self.conn.execute("select id from public.public_store where external_id = %s", (ext,)).fetchone()["id"])

    def item(self, store: str, name: str, price: int, original: int | None) -> None:
        self.conn.execute(
            "insert into public.public_menu_item (public_store_id, external_item_id, name, price_cents,"
            " original_price_cents, unit, collected_at) values (%s, %s, %s, %s, %s, 'un', %s)",
            (store, name, name, price, original, COLLECTED),
        )

    def rows(self) -> dict[str, dict[str, Any]]:
        return {
            r["name"]: r
            for r in self.conn.execute(
                f"select name, {FIELDS} from public.xray_item_view where xray_id = %s", (self.xid,)
            ).fetchall()
        }

    def capture_everything_at_new_prices(self, conn: Any) -> None:
        """A weekly capture of every store through the extraction functions: prices move, promotions start."""
        for n in range(NEIGHBORS + 1):
            conn.execute(
                "insert into public.job (type, payload) values ('extract_capture', %s)",
                (Jsonb({"url": "u", "channel": "ifood", "external_id": self.ext(n)}),),
            )
            job = conn.execute("select * from public.extract_claim_next('teste', 'sandbox')").fetchone()
            items = [
                {"external_item_id": m[0], "name": m[0], "price_cents": 111, "original_price_cents": 99900, "unit": "un"}
                for m in self.menu
            ]
            copy = {"external_id": self.ext(n), "content": {"kind": "capture", "store": {"external_id": self.ext(n)}, "items": items}}
            conn.execute(
                "select public.extract_record_result(%s, 'scraper', %s, %s)",
                (job["job_id"], COLLECTED + timedelta(days=7), Jsonb([copy])),
            )


@pytest.fixture
def clean_jobs(conn):
    conn.execute("delete from public.job where type in ('extract_discover', 'extract_capture', 'xray_neighborhood')")
    yield
    conn.execute("delete from public.job where type in ('extract_discover', 'extract_capture', 'xray_neighborhood')")


MENU = [
    ("Alfa sintetico", 1000, None, 1300, 1500),  # case 1: both low
    ("Bravo sintetico", 1000, None, 1050, 1300),  # case 2: note
    ("Charlie sintetico", 1000, 1500, 1300, None),  # case 3 and 5: own promotion, full gap high
    ("Delta sintetico", 1000, None, 1000, None),  # case 4: no promotion
]


def test_B01_M1_07_worker_rows_and_the_view_carry_both_parities(conn, repo):
    s = Scene(conn, MENU)
    assert pair_step(repo, s.xid)["items"] == 4
    calc_step(repo, s.xid)
    rows = s.rows()

    a = rows["Alfa sintetico"]
    assert (a["parity_cents"], a["parity_full_cents"], a["reading"], a["full_price_room"]) == (1300, 1500, "pode_subir", False)
    assert (float(a["gap_pct"]), float(a["gap_full_pct"])) == (-0.2308, -0.3333)
    assert a["loss_cents"] == 300, "M1-08 on the current parity"

    b = rows["Bravo sintetico"]
    assert (b["parity_cents"], b["parity_full_cents"], b["reading"], b["full_price_room"]) == (1050, 1300, "na_media", True)
    assert b["loss_cents"] == 50, "M1-08 on the current parity"

    c = rows["Charlie sintetico"]
    assert (c["parity_cents"], c["parity_full_cents"], c["reading"], c["full_price_room"]) == (1300, 1300, "nao_mexer", False)
    assert (float(c["gap_pct"]), float(c["gap_full_pct"])) == (-0.2308, 0.1538)
    assert c["own_cents"] == 1000, "the main number is the current price"

    d = rows["Delta sintetico"]
    assert (d["parity_cents"], d["parity_full_cents"], d["reading"], d["full_price_room"]) == (1000, 1000, "na_media", False)
    assert d["gap_pct"] == d["gap_full_pct"] == 0


def test_B01_M1_05_the_snapshot_keeps_the_full_price_and_null_means_current(conn, repo):
    s = Scene(conn, MENU)
    pair_step(repo, s.xid)
    calc_step(repo, s.xid)
    kept = {
        r["name"]: (r["price_cents"], r["full_price_cents"])
        for r in conn.execute(
            "select name, price_cents, full_price_cents from public.public_menu_item_snapshot"
            " where xray_id = %s and public_store_id = %s",
            (s.xid, s.target),
        ).fetchall()
    }
    assert kept["Charlie sintetico"] == (1000, 1500)
    assert kept["Alfa sintetico"] == (1000, None)


def test_B01_M1_05_pairing_again_clears_the_full_price_results_too(conn, repo):
    s = Scene(conn, MENU)
    pair_step(repo, s.xid)
    calc_step(repo, s.xid)
    pair_step(repo, s.xid)
    b = s.rows()["Bravo sintetico"]
    assert (b["parity_cents"], b["parity_full_cents"], b["gap_full_pct"], b["full_price_room"]) == (None, None, None, False)


def test_B01_M1_05_case_7_a_run_from_before_this_change_has_no_secondary_info_and_the_same_numbers(conn, repo):
    """Rows as an old run left them: snapshot without a full price, no full parity. The catalog has promotions now."""
    s = Scene(conn, MENU)
    pair_step(repo, s.xid)
    conn.execute(
        "insert into public.public_menu_item_snapshot (xray_id, public_store_id, public_menu_item_id, name, price_cents,"
        " unit, unit_qty, collected_at)"
        " select %s, m.public_store_id, m.id, m.name, m.comparison_price_cents, m.unit, m.unit_qty, %s"
        " from public.public_menu_item m where m.public_store_id = %s or m.public_store_id in"
        " (select public_store_id from public.xray_store where xray_id = %s)",
        (s.xid, COLLECTED, s.target, s.xid),
    )
    conn.execute(
        "update public.xray_item set parity_cents = 1050, gap_pct = -0.0476, loss_cents = 50, reading = 'na_media'"
        " where xray_id = %s",
        (s.xid,),
    )
    old = s.rows()["Bravo sintetico"]
    assert (old["parity_full_cents"], old["gap_full_pct"], old["full_price_room"]) == (None, None, False)

    # Recomputed anyway, a null full price in the snapshot means current, never the catalog's original of today.
    calc_step(repo, s.xid)
    for row in s.rows().values():
        assert row["parity_full_cents"] == row["parity_cents"]
        assert row["gap_full_pct"] == row["gap_pct"]
        assert row["full_price_room"] is False
    assert s.rows()["Charlie sintetico"]["reading"] == "pode_subir", "the run knew no promotion: as it read then"


def test_B01_M1_05_case_8_a_weekly_capture_does_not_change_a_delivered_xray(conn, repo, clean_jobs):
    s = Scene(conn, MENU)
    pair_step(repo, s.xid)
    calc_step(repo, s.xid)
    conn.execute("update public.xray set status = 'delivered', delivered_at = now() where id = %s", (s.xid,))
    before = s.rows()
    assert before["Bravo sintetico"]["parity_full_cents"] == 1300

    s.capture_everything_at_new_prices(conn)
    assert (
        conn.execute(
            "select comparison_price_cents as c, original_price_cents as o from public.public_menu_item"
            " where public_store_id = %s and name = 'Bravo sintetico'",
            (s.target,),
        ).fetchone()
        == {"c": 111, "o": 99900}
    ), "the capture reached the catalog"
    assert s.rows() == before, "the screens read the stored rows"

    calc_step(repo, s.xid)
    assert s.rows() == before, "a recalculation reads the run's snapshot, not the catalog"
    assert conn.execute("select status from public.xray where id = %s", (s.xid,)).fetchone()["status"] == "delivered"
