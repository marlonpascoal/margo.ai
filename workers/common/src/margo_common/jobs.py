"""Job queue contract shared by every store and runner (02 §4).

A store is how a runner reaches the `job` table: `PostgresJobStore` over a direct connection for local
runs, `RestJobStore` through the Supabase REST API with the service role in production (02 §2), and
`MemoryJobStore` for unit tests. All three follow the SQL functions of migration 20261031000006_jobs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from margo_contracts.models import Alert, Job
from pydantic import JsonValue

STUCK_AFTER_MINUTES = 30
"""02 §4.5: a job running longer than this is stuck."""

LogValue = str | int | bool | None
"""Log entries carry ids, counts and reasons only, never restaurant names or values (02 §7)."""


@dataclass(frozen=True)
class NewJob:
    type: str
    payload: JsonValue = field(default_factory=dict)
    account_id: UUID | None = None
    dedupe_key: str | None = None


@dataclass(frozen=True)
class StuckOutcome:
    job_id: UUID
    outcome: Literal["requeued", "failed"]
    alert_id: UUID | None


class JobStore(Protocol):
    def insert(self, job: NewJob) -> UUID:
        """Insert a queued job. With a dedupe_key already active (queued or running), return that job's id."""
        ...

    def claim(self, job_id: UUID) -> Job | None:
        """`public.claim_job`: the row when this caller won, None otherwise (A07)."""
        ...

    def claim_next(self, job_type: str) -> Job | None:
        """`public.claim_next_job`: claim the oldest queued job of a type."""
        ...

    def finish(self, job_id: UUID, status: Literal["done", "failed"], entry: dict[str, LogValue]) -> bool:
        """`public.finish_job`: close a running job with a log entry."""
        ...

    def requeue_stuck(self, now: datetime) -> list[StuckOutcome]:
        """`public.requeue_stuck_jobs` (A08)."""
        ...

    def get(self, job_id: UUID) -> Job | None: ...

    def get_alert(self, alert_id: UUID) -> Alert | None: ...
