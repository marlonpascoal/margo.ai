"""Job handlers of worker-import (`uv run worker import_99food_file --local`).

The runner checks the job's flag first (JOB_FLAGS: m2.arquivo_ifood, m2.arquivo_99food, A05).
Payload: {"import_run_id": "<uuid>"}.
"""

from __future__ import annotations

from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel

from . import db, food99_file, ifood_file
from .process import process_run
from .storage import local_storage


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


import_ifood_file.payload_model = ImportPayload  # type: ignore[attr-defined]
import_99food_file.payload_model = ImportPayload  # type: ignore[attr-defined]
