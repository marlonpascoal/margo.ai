"""`render_xray` in print mode: P23 "Baixar PDF" (Marlon, 07/nov: the PDF is the result screen printed).

The worker mints a one-time token (only its sha256 is stored, valid 5 minutes, used once by the page), opens
/imprimir/raio-x/<xray>?t=<token> of the web app with Playwright (scripts/print_pdf.mjs), stores the A4 PDF in the
private `pdf` bucket and records it in xray_print under the result version the page reports, so the web app serves it
again for the same version. The console's P01 (C05/C06, xray.pdf_path) is the other mode, unchanged.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path
from typing import Protocol

from .handlers import PdfStore, pdf_pages

TOKEN_MINUTES = 5
ROOT = Path(__file__).resolve().parents[4]


class Printer(Protocol):
    def print(self, url: str) -> tuple[bytes, str]:
        """The PDF of the page at url and the page's result version."""
        ...


class PlaywrightPrinter:
    """Node Playwright (apps/web's @playwright/test) through scripts/print_pdf.mjs."""

    def __init__(self, script: Path = ROOT / "scripts" / "print_pdf.mjs") -> None:
        self.script = script

    def print(self, url: str) -> tuple[bytes, str]:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "raio-x.pdf"
            done = subprocess.run(  # noqa: S603 (our script, our URL)
                ["node", str(self.script), url, str(out)], capture_output=True, text=True, timeout=120
            )
            if done.returncode != 0:
                # The URL holds the token: never logged; stderr of the script names only the status.
                raise RuntimeError(f"print failed ({done.returncode}): {done.stderr.strip()[-300:]}")
            version = json.loads(done.stdout.strip().splitlines()[-1])["version"]
            return out.read_bytes(), version


def mint_token(conn, xray_id: str) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "insert into public.xray_print_token (xray_id, token_hash, expires_at)"
        " values (%s, %s, now() + make_interval(mins => %s))",
        (xray_id, hashlib.sha256(token.encode()).hexdigest(), TOKEN_MINUTES),
    )
    return token


def print_and_store(conn, store: PdfStore, printer: Printer, xray_id: str, app_url: str) -> dict[str, object]:
    row = conn.execute(
        "select coalesce(a.code, 'lead') as code from public.xray x left join public.account a on a.id = x.account_id"
        " where x.id = %s",
        (xray_id,),
    ).fetchone()
    if row is None:
        raise LookupError("unknown X-ray")
    token = mint_token(conn, xray_id)
    pdf, version = printer.print(f"{app_url.rstrip('/')}/imprimir/raio-x/{xray_id}?t={token}")
    if not version:
        raise ValueError("the print page reported no result version")
    path = f"raio-x/{row['code']}/{xray_id}-{version}.pdf"
    store.put(path, pdf)
    pages = pdf_pages(pdf)
    conn.execute(
        "insert into public.xray_print (xray_id, version, path, bytes, pages) values (%s, %s, %s, %s, %s)"
        " on conflict (xray_id, version) do update set path = excluded.path, bytes = excluded.bytes,"
        " pages = excluded.pages, updated_at = now()",
        (xray_id, version, path, len(pdf), pages),
    )
    return {"bytes": len(pdf), "pages": pages, "version": version}


def app_url() -> str:
    """The web app the worker prints from: MARGO_APP_URL (platform, or the e2e server locally)."""
    url = os.environ.get("MARGO_APP_URL")
    if not url:
        raise RuntimeError("MARGO_APP_URL is not set: the print worker needs the web app's address")
    return url
