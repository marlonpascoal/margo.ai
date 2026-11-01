"""`compute_contribution` job (worker-cost): CST-01 to CST-04, CTB-01, CTB-02, DLV-01 into the database.

Payload {"close_period_id": "<uuid>"} recomputes one close; {"account_id": "<uuid>"} (a C12 edit) recomputes
the recipe costs and the account's latest close. "as_of" (yyyy-mm-dd) fixes the price date; default today in
São Paulo. The runner checks m3.custo for the job's account first (JOB_FLAGS, A05).
"""

from __future__ import annotations

import os
from datetime import date

from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel, model_validator

from .db import compute_and_store, recost_account

LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


class ContributionPayload(BaseModel):
    close_period_id: str | None = None
    account_id: str | None = None
    as_of: date | None = None

    @model_validator(mode="after")
    def one_target(self) -> ContributionPayload:
        if (self.close_period_id is None) == (self.account_id is None):
            raise ValueError("give close_period_id or account_id")
        return self


def compute_contribution(job: JobRun[ContributionPayload]) -> dict[str, LogValue]:
    import psycopg
    from psycopg.rows import dict_row

    p = job.payload
    with psycopg.connect(LOCAL_DB_URL, row_factory=dict_row) as conn, conn.transaction():
        if p.close_period_id:
            result = compute_and_store(conn, p.close_period_id, p.as_of)
            return {"close_period_id": p.close_period_id, "rows": len(result.rows)}
        close = recost_account(conn, p.account_id or "", p.as_of)
        return {"account_id": p.account_id or "", "close_period_id": close or ""}


compute_contribution.payload_model = ContributionPayload  # type: ignore[attr-defined]
