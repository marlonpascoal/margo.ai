"""E06 (07-acceptance): data export zip and deletion job (rows and files gone, receipt in audit log).

On G-SYN Grupo Exemplo (G-02), inside a rolled-back transaction, with Storage replaced by memory.
"""

from __future__ import annotations

import csv
import hashlib
import io
import os
import zipfile
from typing import Any

import pytest
from margo_account.files import MemoryAccountFiles

db = pytest.mark.skipif(
    not os.environ.get("MARGO_DB_TESTS"), reason="MARGO_DB_TESTS=1 runs it against the local stack"
)


def sid(tag: str) -> str:
    h = hashlib.md5(f"g-syn:{tag}".encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


G02 = sid("G-02")
G01 = sid("G-01")
INTERNAL = {"job", "alert", "feature_override", "feature_flag_log"}


def tenant_tables(conn: Any) -> list[str]:
    rows = conn.execute(
        """select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public' and c.column_name = 'account_id' and t.table_type = 'BASE TABLE'"""
    ).fetchall()
    return sorted(r["table_name"] for r in rows)


def count(conn: Any, table: str, account: str) -> int:
    return conn.execute(
        f'select count(*) as n from public."{table}" where account_id = %s', (account,)
    ).fetchone()["n"]


def storage(conn: Any) -> MemoryAccountFiles:
    """The seeded import files, a rendered close of G-02, an old export, and a file of another account."""
    conn.execute(
        "update public.close_period set pdf_path = 'closes/G-02/2026-09/fechamento-G-02-2026-09.pdf' where account_id = %s",
        (G02,),
    )
    paths = conn.execute(
        """select file_path from public.import_run where file_path is not null
           union select xml_path from public.invoice where xml_path is not null
           union select file_path from public.invoice_import"""
    ).fetchall()
    files = {r["file_path"]: b"conteudo " + r["file_path"].encode() for r in paths}
    files["closes/G-02/2026-09/fechamento-G-02-2026-09.pdf"] = b"%PDF-1.4 sintetico"
    files["exports/G-02/antigo.zip"] = b"PK"
    files["closes/G-01/2026-09/fechamento-G-01-2026-09.pdf"] = b"%PDF-1.4 outro"
    return MemoryAccountFiles(files)


def read_zip(blob: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        return {n: z.read(n) for n in z.namelist()}


def rows_of(z: dict[str, bytes], table: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(z[f"dados/{table}.csv"].decode())))


@db
def test_E06_export_zip_has_a_csv_per_table_of_the_account_and_its_files(conn: Any) -> None:
    from margo_account.export import build_zip

    files = storage(conn)
    blob, _, counts = build_zip(conn, files, G02)
    z = read_zip(blob)

    for table in tenant_tables(conn):
        n = count(conn, table, G02)
        if table in INTERNAL or n == 0:
            assert f"dados/{table}.csv" not in z, table
        else:
            assert len(rows_of(z, table)) == n, table
            assert {r["account_id"] for r in rows_of(z, table)} == {G02}, f"{table} holds only G-02 rows"
    # Children without account_id come through their parents.
    for child in ("membership_kitchen", "channel_store_url_history"):
        assert rows_of(z, child), child
    assert sorted(r["name"] for r in rows_of(z, "person")) == [
        "Dono do grupo",
        "Gerente do Centro",
        "Pessoa do financeiro",
    ]
    assert [r["code"] for r in rows_of(z, "account")] == ["G-02"]

    # Token hashes never leave (A06); internal tables are not exported.
    assert "token_hash" not in rows_of(z, "invite")[0]
    assert not any(n in z for n in ("dados/job.csv", "dados/alert.csv", "dados/staff.csv"))

    stored = sorted(n.removeprefix("arquivos/") for n in z if n.startswith("arquivos/"))
    assert stored == sorted(p for p in files.files if p.startswith(("imports/G-02/", "closes/G-02/", "invoices/G-02/")))
    assert counts == {
        "tables": len([n for n in z if n.startswith("dados/")]),
        "files": len(stored),
        "missing_files": 0,
    }
    assert "SINTÉTICO" in z["LEIA-ME.txt"].decode()


@db
def test_E06_export_job_writes_the_zip_to_the_exports_bucket(conn: Any) -> None:
    from margo_account.export import export_account

    files = storage(conn)
    path, _ = export_account(conn, files, G02, "job-1")
    assert path == "exports/G-02/job-1.zip"
    assert "dados/account.csv" in read_zip(files.get(path))


@db
def test_E06_deletion_removes_rows_and_files_and_keeps_a_receipt(conn: Any) -> None:
    from margo_account.delete import delete_account

    files = storage(conn)
    before = {t: count(conn, t, G02) for t in tenant_tables(conn)}
    g01_before = {t: count(conn, t, G01) for t in tenant_tables(conn)}
    items_before = conn.execute("select count(*) as n from public.membership_kitchen").fetchone()["n"]
    staff = conn.execute(
        "select count(*) as n from public.person p join public.staff s on s.person_id = p.id"
    ).fetchone()["n"]

    own_files = sum(1 for p in files.files if p.split("/")[1:2] == ["G-02"])
    receipt = delete_account(conn, files, G02, requested_by=sid("p:g02-dono"), job_id="job-9")

    for t in tenant_tables(conn):
        assert count(conn, t, G02) == (1 if t == "audit_log" else 0), t
        assert count(conn, t, G01) == g01_before[t], f"{t} of another account untouched"
    assert conn.execute("select count(*) as n from public.account where id = %s", (G02,)).fetchone()["n"] == 0
    assert conn.execute("select count(*) as n from public.membership_kitchen").fetchone()["n"] < items_before
    assert (
        conn.execute(
            "select count(*) as n from public.person where id = any(%s::uuid[])",
            ([sid("p:g02-dono"), sid("p:g02-fin"), sid("p:g02-ger")],),
        ).fetchone()["n"]
        == 0
    )
    assert (
        conn.execute(
            "select count(*) as n from public.person p join public.staff s on s.person_id = p.id"
        ).fetchone()["n"]
        == staff
    )

    assert sorted(files.files) == ["closes/G-01/2026-09/fechamento-G-01-2026-09.pdf"] + sorted(
        p for p in files.files if p.startswith(("imports/", "invoices/")) and p.split("/")[1] != "G-02"
    )
    [r] = conn.execute(
        "select actor_kind::text as kind, action, entity_id::text as e, after from public.audit_log where account_id = %s",
        (G02,),
    ).fetchall()
    assert (r["kind"], r["action"], r["e"]) == ("system", "account.deleted", G02)
    assert r["after"] == receipt
    assert receipt["rows"] == sum(before.values())
    assert receipt["people_deleted"] == 3 and receipt["files"] == own_files
    assert receipt["requested_by"] == sid("p:g02-dono") and receipt["job_id"] == "job-9"
    assert "Grupo Exemplo" not in str(receipt), "the receipt carries ids and counts only (02 §7)"


@db
def test_E06_deletion_keeps_a_person_who_belongs_to_another_account(conn: Any) -> None:
    from margo_account.delete import delete_account

    conn.execute(
        "insert into public.membership (account_id, person_id, role) values (%s, %s, 'financeiro')",
        (G01, sid("p:g02-fin")),
    )
    receipt = delete_account(conn, MemoryAccountFiles(), G02, requested_by=None, job_id=None)
    assert receipt["people_deleted"] == 2
    assert (
        conn.execute("select name from public.person where id = %s", (sid("p:g02-fin"),)).fetchone()["name"]
        == "Pessoa do financeiro"
    )


def test_E06_job_types_are_registered_without_a_flag() -> None:
    from margo_common.cli import find_handler
    from margo_common.runner import JOB_FLAGS

    assert find_handler("account_export") is not None and find_handler("account_delete") is not None
    assert "account_export" not in JOB_FLAGS and "account_delete" not in JOB_FLAGS


@db
def test_E06_export_leaves_out_the_street_address_and_the_extraction_tables(conn: Any) -> None:
    """D47c: public_store_private and the extraction copies never reach an account's export."""
    from margo_account.export import build_zip

    store = conn.execute(
        "select target_store_id as id from public.xray where account_id = %s limit 1", (G01,)
    ).fetchone()["id"]
    conn.execute(
        "insert into public.public_store_private (public_store_id, address, collected_at) values (%s, %s, now())"
        " on conflict (public_store_id) do update set address = excluded.address",
        (store, "Rua Sintética E06, 1"),
    )
    try:
        blob, _, _ = build_zip(conn, storage(conn), G01)
    finally:
        conn.execute("delete from public.public_store_private where public_store_id = %s", (store,))
    z = read_zip(blob)
    assert not [n for n in z if "public_store_private" in n or "extract_" in n]
    assert not [n for n, body in z.items() if "Rua Sintética E06".encode() in body]
