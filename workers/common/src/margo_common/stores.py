"""JobStore implementations (see jobs.py).

The SQL ones call the functions of migration 20261031000006_jobs.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from margo_contracts.models import Alert, AlertSeverity, Job, JobStatus

from .jobs import STUCK_AFTER_MINUTES, LogValue, NewJob, StuckOutcome

ACTIVE = (JobStatus.QUEUED, JobStatus.RUNNING)


class MemoryJobStore:
    """In-memory store with the same semantics as the SQL functions, for unit tests."""

    def __init__(self, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._now = now
        self._lock = threading.Lock()
        self._jobs: dict[UUID, dict[str, Any]] = {}
        self._alerts: dict[UUID, Alert] = {}

    def _entry(self, event: str, at: datetime | None = None, **extra: Any) -> dict[str, Any]:
        return {**extra, "at": (at or self._now()).isoformat(), "event": event}

    def insert(self, job: NewJob) -> UUID:
        with self._lock:
            if job.dedupe_key is not None:
                for row in self._jobs.values():
                    if (
                        row["type"] == job.type
                        and row["dedupe_key"] == job.dedupe_key
                        and row["status"] in ACTIVE
                    ):
                        return row["id"]
            now = self._now()
            row = {
                "id": uuid.uuid4(),
                "type": job.type,
                "payload": job.payload,
                "account_id": job.account_id,
                "dedupe_key": job.dedupe_key,
                "status": JobStatus.QUEUED,
                "attempts": 0,
                "claimed_at": None,
                "finished_at": None,
                "log": [],
                "created_at": now,
                "updated_at": now,
            }
            self._jobs[row["id"]] = row
            return row["id"]

    def _claim(self, row: dict[str, Any]) -> Job:
        now = self._now()
        row.update(status=JobStatus.RUNNING, claimed_at=now, attempts=row["attempts"] + 1, updated_at=now)
        row["log"] = [*row["log"], self._entry("claimed")]
        return Job.model_validate(row)

    def claim(self, job_id: UUID) -> Job | None:
        with self._lock:
            row = self._jobs.get(job_id)
            return self._claim(row) if row and row["status"] == JobStatus.QUEUED else None

    def claim_next(self, job_type: str) -> Job | None:
        with self._lock:
            queued = [
                r for r in self._jobs.values() if r["type"] == job_type and r["status"] == JobStatus.QUEUED
            ]
            return self._claim(min(queued, key=lambda r: r["created_at"])) if queued else None

    def finish(self, job_id: UUID, status: Literal["done", "failed"], entry: dict[str, LogValue]) -> bool:
        with self._lock:
            row = self._jobs.get(job_id)
            if not row or row["status"] != JobStatus.RUNNING:
                return False
            now = self._now()
            row.update(status=JobStatus(status), finished_at=now, updated_at=now)
            row["log"] = [*row["log"], self._entry(status, **entry)]
            return True

    def requeue_stuck(self, now: datetime) -> list[StuckOutcome]:
        out: list[StuckOutcome] = []
        with self._lock:
            limit = now - timedelta(minutes=STUCK_AFTER_MINUTES)
            stuck = [
                r for r in self._jobs.values() if r["status"] == JobStatus.RUNNING and r["claimed_at"] < limit
            ]
            for row in sorted(stuck, key=lambda r: r["claimed_at"]):
                if not any(e["event"] == "stuck_requeued" for e in row["log"]):
                    row.update(status=JobStatus.QUEUED, claimed_at=None)
                    row["log"] = [*row["log"], self._entry("stuck_requeued", at=now)]
                    out.append(StuckOutcome(row["id"], "requeued", None))
                    continue
                alert = Alert(
                    id=uuid.uuid4(),
                    severity=AlertSeverity.URGENTE,
                    title=f"Tarefa {row['type']} travou 2 vezes: mais de 30 minutos rodando",
                    account_id=row["account_id"],
                    link=None,
                    notified_via=[],
                    opened_at=now,
                    resolved_at=None,
                    resolved_by=None,
                    created_at=now,
                    updated_at=now,
                )
                self._alerts[alert.id] = alert
                row.update(status=JobStatus.FAILED, finished_at=now)
                row["log"] = [
                    *row["log"],
                    self._entry("failed", at=now, reason="stuck", alert_id=str(alert.id)),
                ]
                out.append(StuckOutcome(row["id"], "failed", alert.id))
        return out

    def get(self, job_id: UUID) -> Job | None:
        row = self._jobs.get(job_id)
        return Job.model_validate(row) if row else None

    def get_alert(self, alert_id: UUID) -> Alert | None:
        return self._alerts.get(alert_id)


def _outcome(row: dict[str, Any]) -> StuckOutcome:
    alert = row["alert_id"]
    return StuckOutcome(UUID(str(row["job_id"])), row["outcome"], UUID(str(alert)) if alert else None)


class PostgresJobStore:
    """Direct connection to the local stack (MARGO_LOCAL_DB_URL). Local runs and tests only."""

    def __init__(self, url: str) -> None:
        import psycopg
        from psycopg.rows import dict_row

        self._conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)

    def _one(self, sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        return self._conn.execute(sql, args).fetchone()

    def _job(self, sql: str, args: tuple[Any, ...]) -> Job | None:
        row = self._one(sql, args)
        return Job.model_validate(row) if row else None

    def insert(self, job: NewJob) -> UUID:
        args = (job.type, json.dumps(job.payload), job.account_id, job.dedupe_key)
        row = self._one(
            "insert into public.job (type, payload, account_id, dedupe_key) values (%s, %s::jsonb, %s, %s)"
            " on conflict (type, dedupe_key) where dedupe_key is not null and status in ('queued', 'running')"
            " do nothing returning id",
            args,
        )
        if row is None:
            row = self._one(
                "select id from public.job"
                " where type = %s and dedupe_key = %s and status in ('queued', 'running')",
                (job.type, job.dedupe_key),
            )
        assert row is not None
        return row["id"]

    def claim(self, job_id: UUID) -> Job | None:
        return self._job("select * from public.claim_job(%s)", (job_id,))

    def claim_next(self, job_type: str) -> Job | None:
        return self._job("select * from public.claim_next_job(%s)", (job_type,))

    def finish(self, job_id: UUID, status: Literal["done", "failed"], entry: dict[str, LogValue]) -> bool:
        row = self._one(
            "select public.finish_job(%s, %s, %s::jsonb) as ok", (job_id, status, json.dumps(entry))
        )
        return bool(row and row["ok"])

    def requeue_stuck(self, now: datetime) -> list[StuckOutcome]:
        rows = self._conn.execute("select * from public.requeue_stuck_jobs(%s)", (now,)).fetchall()
        return [_outcome(r) for r in rows]

    def rpc(self, fn: str, args: Mapping[str, Any]) -> Any:
        """Call a public SQL function with named arguments, like PostgREST's /rpc (flags.Rpc)."""
        from psycopg import sql

        params = sql.SQL(", ").join(
            sql.SQL("{} => {}").format(sql.Identifier(k), sql.Placeholder()) for k in args
        )
        query = sql.SQL("select {}.{}({}) as result").format(
            sql.Identifier("public"), sql.Identifier(fn), params
        )
        row = self._conn.execute(query, tuple(args.values())).fetchone()
        return row["result"] if row else None

    def get(self, job_id: UUID) -> Job | None:
        return self._job("select * from public.job where id = %s", (job_id,))

    def get_alert(self, alert_id: UUID) -> Alert | None:
        row = self._one("select * from public.alert where id = %s", (alert_id,))
        return Alert.model_validate(row) if row else None


Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]
"""(method, url, headers, body) -> (status, body). Injectable so tests never open a socket."""


def urllib_transport(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (URL comes from config)
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class RestStoreError(Exception):
    """A REST call failed. Carries the status and path only, never the body."""


class RestJobStore:
    """Supabase REST API with the service role (02 §2). Production workers use this one."""

    def __init__(
        self, supabase_url: str, service_role_key: str, transport: Transport = urllib_transport
    ) -> None:
        self._base = supabase_url.rstrip("/") + "/rest/v1"
        self._key = service_role_key
        self._send = transport

    def _call(self, method: str, path: str, body: Any = None, prefer: str | None = None) -> tuple[int, Any]:
        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else json.dumps(body, default=str).encode()
        status, raw = self._send(method, self._base + path, headers, data)
        if status >= 400 and status != 409:
            raise RestStoreError(f"{method} {path.split('?')[0]} returned {status}")
        return status, (json.loads(raw) if raw else None)

    def _rpc(self, fn: str, args: Mapping[str, Any]) -> Any:
        return self._call("POST", f"/rpc/{fn}", dict(args))[1]

    def rpc(self, fn: str, args: Mapping[str, Any]) -> Any:
        """PostgREST /rpc with the service role (flags.Rpc)."""
        return self._rpc(fn, args)

    def _first_job(self, rows: list[dict[str, Any]]) -> Job | None:
        return Job.model_validate(rows[0]) if rows else None

    def insert(self, job: NewJob) -> UUID:
        body = {
            "type": job.type,
            "payload": job.payload,
            "account_id": job.account_id,
            "dedupe_key": job.dedupe_key,
        }
        status, rows = self._call("POST", "/job?select=id", body, prefer="return=representation")
        if status != 409:
            return UUID(rows[0]["id"])
        q = urllib.parse.urlencode(
            {
                "select": "id",
                "type": f"eq.{job.type}",
                "dedupe_key": f"eq.{job.dedupe_key}",
                "status": "in.(queued,running)",
            }
        )
        _, rows = self._call("GET", f"/job?{q}")
        if not rows:
            raise RestStoreError("POST /job returned 409 without an active duplicate")
        return UUID(rows[0]["id"])

    def claim(self, job_id: UUID) -> Job | None:
        return self._first_job(self._rpc("claim_job", {"p_job_id": str(job_id)}))

    def claim_next(self, job_type: str) -> Job | None:
        return self._first_job(self._rpc("claim_next_job", {"p_type": job_type}))

    def finish(self, job_id: UUID, status: Literal["done", "failed"], entry: dict[str, LogValue]) -> bool:
        return bool(self._rpc("finish_job", {"p_job_id": str(job_id), "p_status": status, "p_entry": entry}))

    def requeue_stuck(self, now: datetime) -> list[StuckOutcome]:
        return [_outcome(r) for r in self._rpc("requeue_stuck_jobs", {"p_now": now.isoformat()})]

    def _get(self, table: str, id_: UUID) -> dict[str, Any] | None:
        _, rows = self._call("GET", f"/{table}?select=*&id=eq.{id_}")
        return rows[0] if rows else None

    def get(self, job_id: UUID) -> Job | None:
        row = self._get("job", job_id)
        return Job.model_validate(row) if row else None

    def get_alert(self, alert_id: UUID) -> Alert | None:
        row = self._get("alert", alert_id)
        return Alert.model_validate(row) if row else None
