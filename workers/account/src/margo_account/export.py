"""E06 export: a zip with one CSV per table of the account plus its files (05 W09 "Done when").

Layout of the zip:
  LEIA-ME.txt                  what is inside (Portuguese, the Dono reads it)
  dados/<table>.csv            one per table with rows, header first, secret columns left out
  arquivos/<bucket>/<object>   every stored file of the account (imports, closes, PDFs)
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from .data import SECRET_COLUMN, AccountData, collect, referenced_files
from .files import BUCKETS, AccountFiles

EXPORT_BUCKET = "exports"


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, dict | list):
        return json.dumps(v, ensure_ascii=False, default=str)
    if isinstance(v, UUID | Decimal):
        return str(v)
    return str(v)


def table_csv(columns: list[str], rows: list[dict[str, Any]]) -> str:
    cols = [c for c in columns if not SECRET_COLUMN.search(c)]
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        w.writerow([_cell(r.get(c)) for c in cols])
    return out.getvalue()


def account_files(data: AccountData, files: AccountFiles, *, include_exports: bool = False) -> list[str]:
    """Files named by rows plus everything under "<code>/" in the private buckets."""
    paths = set(referenced_files(data))
    for bucket in BUCKETS:
        if bucket == EXPORT_BUCKET and not include_exports:
            continue
        paths.update(files.list(bucket, f"{data.code}/"))
    return sorted(paths)


def readme(data: AccountData, tables: int, n_files: int, missing: int) -> str:
    lines = [
        f"Dados da conta {data.name} (código {data.code}) na MargoAI.",
        "",
        f"dados/: {tables} tabelas em CSV, uma por arquivo, com a primeira linha de títulos.",
        f"arquivos/: {n_files} arquivos enviados ou gerados (extratos, fechamentos, PDFs).",
        "Valores em centavos (colunas terminadas em _cents). Datas no horário de São Paulo.",
    ]
    if missing:
        lines.append(f"{missing} arquivos citados nos dados não estavam mais guardados.")
    if data.is_synthetic:
        lines += ["", "SINTÉTICO: dados fictícios de teste."]
    return "\n".join(lines) + "\n"


def build_zip(conn: Any, files: AccountFiles, account_id: str) -> tuple[bytes, AccountData, dict[str, int]]:
    data = collect(conn, account_id)
    buf = io.BytesIO()
    stored = 0
    missing = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for table in sorted(data.rows):
            z.writestr(f"dados/{table}.csv", table_csv(data.columns[table], data.rows[table]))
        for path in account_files(data, files):
            try:
                z.writestr(f"arquivos/{path}", files.get(path))
                stored += 1
            except FileNotFoundError:
                missing += 1
        z.writestr("LEIA-ME.txt", readme(data, len(data.rows), stored, missing))
    return buf.getvalue(), data, {"tables": len(data.rows), "files": stored, "missing_files": missing}


def export_account(
    conn: Any, files: AccountFiles, account_id: str, job_id: str
) -> tuple[str, dict[str, int]]:
    """Writes the zip to exports/<code>/<job id>.zip; the portal serves it to a Dono (W09)."""
    blob, data, counts = build_zip(conn, files, account_id)
    path = f"{EXPORT_BUCKET}/{data.code}/{job_id}.zip"
    files.put(path, blob, "application/zip")
    return path, counts
