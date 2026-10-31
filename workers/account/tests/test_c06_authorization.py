"""C06, portal side: the authorization P03/W07 writes is per CNPJ, and a real file stays refused while any
CNPJ in it lacks one (04 §11, D21, D48). The row is written as apps/web/lib/portal/connect.ts writes it.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

import pytest

db = pytest.mark.skipif(
    not os.environ.get("MARGO_DB_TESTS"), reason="MARGO_DB_TESTS=1 runs it against the local stack"
)
IFOOD = Path(__file__).resolve().parents[3] / "fixtures" / "m2" / "ifood-conciliacao-set2026-SINTETICO.csv"


def sid(tag: str) -> str:
    h = hashlib.md5(f"g-syn:{tag}".encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def portal_sign(conn: Any, company: str) -> None:
    conn.execute(
        """insert into public.owner_authorization
             (account_id, company_id, scope, includes_ai, includes_international, signed_by, signed_at, terms_version)
           values (%s, %s, array['ifood', 'food99', 'extensao', 'notas'], true, true, %s, now(), 'rascunho-2026-10-30')""",
        (sid("G-02"), company, sid("p:g02-dono")),
    )


def run_file(conn: Any) -> tuple[str, str | None]:
    from margo_account.files import MemoryAccountFiles
    from margo_import.process import process_run

    run = conn.execute(
        """insert into public.import_run (account_id, trigger, channel, file_path, file_name)
           values (%s, 'upload', 'ifood', 'imports/t/ifood.csv', %s) returning id""",
        (sid("G-02"), IFOOD.name),
    ).fetchone()["id"]
    out = process_run(
        conn, MemoryAccountFiles({"imports/t/ifood.csv": IFOOD.read_bytes()}), str(run), "ifood"
    )
    return out.status, out.reason


@db
def test_C06_real_file_stays_refused_until_every_cnpj_in_it_is_authorized_in_the_portal(conn: Any) -> None:
    conn.execute("update public.account set is_synthetic = false where id = %s", (sid("G-02"),))
    conn.execute("delete from public.owner_authorization where account_id = %s", (sid("G-02"),))
    assert run_file(conn) == ("failed", "no_owner_authorization")

    # The file has stores of both CNPJs (Centro on CNPJ 1, Zona Sul and Shopping on CNPJ 2).
    portal_sign(conn, sid("G-02:cnpj1"))
    assert run_file(conn) == ("failed", "no_owner_authorization")

    portal_sign(conn, sid("G-02:cnpj2"))
    status, _ = run_file(conn)
    assert status == "ok"
