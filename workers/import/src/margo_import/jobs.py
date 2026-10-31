"""Job handlers of worker-import (`uv run worker import_99food_file --local`).

The runner checks the job's flag first (JOB_FLAGS: m2.arquivo_ifood, m2.arquivo_99food, A05).
Payload: {"import_run_id": "<uuid>"}; import_invoice_zip (m3.notas_xml): {"invoice_import_id": "<uuid>"}.
"""

from __future__ import annotations

from margo_common.files import local_storage
from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel

from . import db, food99_file, ifood_file
from .invoice_run import process_invoice_zip
from .process import process_run


class ImportPayload(BaseModel):
    import_run_id: str


def _run(job: JobRun[ImportPayload], channel: str) -> dict[str, LogValue]:
    conn = db.connect()
    try:
        out = process_run(conn, local_storage(), job.payload.import_run_id, channel)
    finally:
        conn.close()
    return {"import_run_id": job.payload.import_run_id, "status": out.status, "reason": out.reason}


def import_ifood_file(job: JobRun[ImportPayload]) -> dict[str, LogValue]:
    return _run(job, ifood_file.CHANNEL)


def import_99food_file(job: JobRun[ImportPayload]) -> dict[str, LogValue]:
    return _run(job, food99_file.CHANNEL)


class InvoiceZipPayload(BaseModel):
    invoice_import_id: str


def import_invoice_zip(job: JobRun[InvoiceZipPayload]) -> dict[str, LogValue]:
    """C10 drop zone (flag m3.notas_xml): one accountant XML zip (06 §5, D11)."""
    conn = db.connect()
    try:
        out = process_invoice_zip(conn, local_storage(), job.payload.invoice_import_id)
    finally:
        conn.close()
    return {"invoice_import_id": job.payload.invoice_import_id, "status": out.status, "reason": out.reason}


import_ifood_file.payload_model = ImportPayload  # type: ignore[attr-defined]
import_99food_file.payload_model = ImportPayload  # type: ignore[attr-defined]
import_invoice_zip.payload_model = InvoiceZipPayload  # type: ignore[attr-defined]
