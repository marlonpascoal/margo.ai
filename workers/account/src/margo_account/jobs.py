"""Job handlers of worker-account (`uv run worker account_export --local`).

Payload {"account_id": "<uuid>", "requested_by": "<person uuid>"}. No feature flag: export and deletion
are rights of every account (D48), so neither type is in JOB_FLAGS. The deletion job is queued with
job.account_id null, since its own row would otherwise go with the account.
"""

from __future__ import annotations

import os

from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel

from .delete import delete_account
from .export import export_account
from .files import local_account_files

LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


class AccountJobPayload(BaseModel):
    account_id: str
    requested_by: str | None = None


def _connect():  # type: ignore[no-untyped-def]
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(LOCAL_DB_URL, autocommit=True, row_factory=dict_row)


def account_export(job: JobRun[AccountJobPayload]) -> dict[str, LogValue]:
    with _connect() as conn:
        path, counts = export_account(conn, local_account_files(), job.payload.account_id, str(job.job.id))
    return {"path": path, **counts}


def account_delete(job: JobRun[AccountJobPayload]) -> dict[str, LogValue]:
    with _connect() as conn:
        receipt = delete_account(
            conn,
            local_account_files(),
            job.payload.account_id,
            requested_by=job.payload.requested_by,
            job_id=str(job.job.id),
        )
    return {"rows": receipt["rows"], "files": receipt["files"], "people_deleted": receipt["people_deleted"]}


account_export.payload_model = AccountJobPayload  # type: ignore[attr-defined]
account_delete.payload_model = AccountJobPayload  # type: ignore[attr-defined]
