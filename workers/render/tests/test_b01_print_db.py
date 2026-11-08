"""B01 P23 "Baixar PDF" in worker-render (MARGO_DB_TESTS=1): print mode mints a one-time token, prints the page through a
printer (a fake here; Playwright in production and in the e2e), stores the PDF and caches it under the page's result
version. The token is good once and the P01 mode for the console is untouched. Runs on a calculated G-SYN X-ray."""

from __future__ import annotations

import hashlib
import io
import os
from urllib.parse import parse_qs, urlparse

import pytest
from margo_render.handlers import XrayPayload
from margo_render.print_xray import print_and_store
from pypdf import PdfWriter

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    url = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as c:
        yield c


class MemoryStore:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def put(self, path: str, body: bytes) -> None:
        self.files[path] = body


class FakePrinter:
    """Checks the token on the page's behalf, as /imprimir/raio-x/[xray] does, and returns a 2-page PDF."""

    def __init__(self, conn) -> None:
        self.conn = conn
        self.urls: list[str] = []

    def print(self, url: str) -> tuple[bytes, str]:
        self.urls.append(url)
        u = urlparse(url)
        xid = u.path.rsplit("/", 1)[1]
        h = hashlib.sha256(parse_qs(u.query)["t"][0].encode()).hexdigest()
        assert self.conn.execute("select public.xray_print_token_use(%s, %s) as ok", (xid, h)).fetchone()[
            "ok"
        ]
        version = self.conn.execute("select public.monitor_result(%s) ->> 'version' as v", (xid,)).fetchone()[
            "v"
        ]
        w = PdfWriter()
        w.add_blank_page(595, 842)
        w.add_blank_page(595, 842)
        buf = io.BytesIO()
        w.write(buf)
        return buf.getvalue(), version


def test_B01_P23_print_mode_payload_defaults_to_p01():
    assert XrayPayload.model_validate({"xray_id": "00000000-0000-4000-8000-000000000000"}).mode == "p01"
    p = XrayPayload.model_validate(
        {"xray_id": "00000000-0000-4000-8000-000000000000", "mode": "print", "version": "v"}
    )
    assert (p.mode, p.version) == ("print", "v")


def test_B01_P23_print_stores_the_pdf_under_the_result_version_with_a_one_time_token(conn):
    xid = conn.execute(
        "select x.id from public.xray x where x.status in ('ready', 'delivered') and exists"
        " (select 1 from public.xray_item i where i.xray_id = x.id) order by x.created_at limit 1"
    ).fetchone()["id"]
    xid = str(xid)
    store, printer = MemoryStore(), FakePrinter(conn)
    try:
        out = print_and_store(conn, store, printer, xid, "http://localhost:3999/")
        assert out["pages"] == 2
        assert printer.urls[0].startswith(f"http://localhost:3999/imprimir/raio-x/{xid}?t=")
        row = conn.execute("select * from public.xray_print where xray_id = %s", (xid,)).fetchone()
        assert row["version"] == out["version"] and row["pages"] == 2 and row["path"] in store.files
        assert row["path"].endswith(f"{xid}-{out['version']}.pdf")
        token = parse_qs(urlparse(printer.urls[0]).query)["t"][0]
        h = hashlib.sha256(token.encode()).hexdigest()
        assert not conn.execute("select public.xray_print_token_use(%s, %s) as ok", (xid, h)).fetchone()[
            "ok"
        ], "used once"
        stored = conn.execute(
            "select count(*) as n from public.xray_print_token where token_hash = %s", (h,)
        ).fetchone()
        assert stored["n"] == 1 and token not in str(
            conn.execute("select token_hash from public.xray_print_token").fetchall()
        )
        # Same version again: one row, updated in place.
        print_and_store(conn, store, printer, xid, "http://localhost:3999")
        assert (
            conn.execute("select count(*) as n from public.xray_print where xray_id = %s", (xid,)).fetchone()[
                "n"
            ]
            == 1
        )
    finally:
        conn.execute("delete from public.xray_print where xray_id = %s", (xid,))
        conn.execute("delete from public.xray_print_token where xray_id = %s", (xid,))
