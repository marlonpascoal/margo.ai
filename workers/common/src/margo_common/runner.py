"""The Runner interface and its local implementation (02 §4, D42).

Job code registers a handler per job type and never learns which host runs it. The host-specific part is
how a job reaches the worker: `LocalRunner` polls the queue; a Maritime runner receives signed wake-ups
through `WakeupReceiver`. Both hand the job to the same `JobProcessor`: claim (one winner), flag gate,
handler, then done or failed with a log of ids only.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol
from uuid import UUID

from margo_contracts.models import Job
from pydantic import BaseModel, ValidationError

from .flags import FlagEnv, Rpc, flag_enabled
from .jobs import JobStore, LogValue, NewJob, StuckOutcome
from .log import log_event
from .signing import verify_wakeup


@dataclass(frozen=True)
class JobRun[P]:
    """What a handler receives: the claimed row and its payload, validated when a model was given."""

    job: Job
    payload: P


HandlerResult = Mapping[str, LogValue] | None
Handler = Callable[[JobRun[Any]], HandlerResult]
FlagCheck = Callable[[Job], bool]
Clock = Callable[[], datetime]
Outcome = Literal["done", "failed", "not_claimed", "idle"]

JOB_FLAGS: dict[str, str] = {
    "collect": "m1.raio_x",  # 05 C02: "Buscar vizinhança" creates a collect job (worker-collector)
    "xray_neighborhood": "m1.raio_x",  # after a discovery and its captures: M1-01, M1-02
    "extract_discover": "m1.extracao",  # docs/extract-api.md: claimed by an extractor over /api/extract/claim
    "extract_capture": "m1.extracao",  # docs/extract-api.md: same; queued after the neighborhood and by cron
    "xray_pair": "m1.raio_x",  # 05 C03: "Confirmar N lojas" starts pairing (worker-collector)
    "xray_calc": "m1.raio_x",  # 05 C04: "Calcular raio-X" (worker-collector)
    "render_xray": "m1.raio_x",  # 05 C05: "Preparar entrega" renders P01 (worker-render)
    "import_ifood_api": "m2.ifood_api",  # 06: iFood official API import (worker-import)
    "import_ifood_file": "m2.arquivo_ifood",  # 06: Portal do Parceiro export file (worker-import)
    "import_99food_file": "m2.arquivo_99food",  # 06: 99Food statement file (worker-import)
    "import_invoice_zip": "m3.notas_xml",  # accountant's invoice XML zip (worker-import)
    "match_ai": "m3.depara_ia",  # AI ingredient matching (worker-match)
    "compute_contribution": "m3.custo",  # C12 edits and closes: cost and contribution (worker-cost)
    "render_close_bpo": "bpo.marca_propria",  # 05 C18: P06 with the BPO's brand (worker-render)
}
"""Job type to feature flag key (04 §6, A05). A type not listed here has no flag and always runs."""


def allow_all(job: Job) -> bool:
    """Flag check for tests and tools that bypass flags. Workers use `job_flag_check` (A05)."""
    return True


def job_flag_check(rpc: Rpc, env: FlagEnv, job_flags: Mapping[str, str] = JOB_FLAGS) -> FlagCheck:
    """A05: a job whose flag is off for its account refuses to run.

    Evaluates `public.flag_enabled` for JOB_FLAGS[job.type] and the job's account. A system job
    (account_id null) passes no account, so the SQL no-account rule applies: on when the flag is on in at
    least one plan. RPC errors propagate; the job stays running and the stuck sweep retries it (A08).
    """

    def check(job: Job) -> bool:
        key = job_flags.get(job.type)
        if key is None:
            return True
        account = str(job.account_id) if job.account_id is not None else None
        return flag_enabled(key, account, env, rpc=rpc)

    return check


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class _Registration:
    handler: Handler
    payload_model: type[BaseModel] | None


class Runner(Protocol):
    """02 §4: hides the host. Swapping Maritime for another host means a new Runner, not new job code."""

    def enqueue(self, job: NewJob) -> UUID: ...

    def on_job(
        self, job_type: str, handler: Handler, payload_model: type[BaseModel] | None = None
    ) -> None: ...


class JobProcessor:
    def __init__(self, store: JobStore, *, flag_check: FlagCheck = allow_all, now: Clock = utc_now) -> None:
        self.store = store
        self.flag_check = flag_check
        self.now = now
        self._handlers: dict[str, _Registration] = {}

    def register(self, job_type: str, handler: Handler, payload_model: type[BaseModel] | None = None) -> None:
        self._handlers[job_type] = _Registration(handler, payload_model)

    def _finish(self, job: Job, status: Literal["done", "failed"], entry: Mapping[str, LogValue]) -> Outcome:
        self.store.finish(job.id, status, dict(entry))
        log_event(f"job_{status}", job_id=str(job.id), type=job.type, attempts=job.attempts, **entry)
        return status

    def process(self, job: Job) -> Outcome:
        """Run a job this worker has already claimed."""
        reg = self._handlers.get(job.type)
        if reg is None:
            return self._finish(job, "failed", {"reason": "no_handler"})
        if not self.flag_check(job):
            return self._finish(job, "failed", {"reason": "flag_off"})
        payload: Any = job.payload
        if reg.payload_model is not None:
            try:
                payload = reg.payload_model.model_validate(job.payload)
            except ValidationError:
                return self._finish(job, "failed", {"reason": "bad_payload"})
        started = time.monotonic()
        try:
            result = reg.handler(JobRun(job=job, payload=payload)) or {}
        except Exception as e:  # noqa: BLE001 (any handler error fails the job)
            # The class name only: messages may carry restaurant names or values (02 §7).
            return self._finish(job, "failed", {"reason": "error", "error": type(e).__name__})
        ms = int((time.monotonic() - started) * 1000)
        return self._finish(job, "done", {**dict(result), "ms": ms})

    def deliver(self, job_id: UUID) -> Outcome:
        """A wake-up for one job: claim it or do nothing (A07, duplicate deliveries)."""
        job = self.store.claim(job_id)
        if job is None:
            log_event("job_not_claimed", job_id=str(job_id))
            return "not_claimed"
        return self.process(job)

    def poll(self, job_type: str) -> Outcome:
        job = self.store.claim_next(job_type)
        return self.process(job) if job else "idle"

    def sweep(self) -> list[StuckOutcome]:
        """02 §4.5, A08: requeue stuck jobs once, then fail them with an alert."""
        outcomes = self.store.requeue_stuck(self.now())
        for o in outcomes:
            log_event(
                f"job_stuck_{o.outcome}",
                job_id=str(o.job_id),
                alert_id=str(o.alert_id) if o.alert_id else None,
            )
        return outcomes


@dataclass(frozen=True)
class WakeupResult:
    job_id: UUID
    outcome: Outcome


class WakeupReceiver:
    """The worker side of the signed wake-up (02 §4.2). The host maps WakeupRejected to HTTP 401."""

    def __init__(self, processor: JobProcessor, *, key: bytes, now: Clock = utc_now) -> None:
        self.processor = processor
        self._key = key
        self.now = now

    def receive(self, body: Mapping[str, Any] | bytes | str) -> WakeupResult:
        job_id = verify_wakeup(body, self._key, self.now())
        return WakeupResult(job_id, self.processor.deliver(job_id))


class LocalRunner:
    """Plain Python process polling the local queue for one job type (02 §3, local env)."""

    def __init__(
        self,
        store: JobStore,
        job_type: str,
        *,
        flag_check: FlagCheck = allow_all,
        now: Clock = utc_now,
        interval_s: float = 2.0,
    ) -> None:
        self.job_type = job_type
        self.interval_s = interval_s
        self.processor = JobProcessor(store, flag_check=flag_check, now=now)

    def enqueue(self, job: NewJob) -> UUID:
        # Polling picks the job up; no wake-up needed locally.
        return self.processor.store.insert(job)

    def on_job(self, job_type: str, handler: Handler, payload_model: type[BaseModel] | None = None) -> None:
        self.processor.register(job_type, handler, payload_model)

    def run_once(self) -> Outcome:
        self.processor.sweep()
        return self.processor.poll(self.job_type)

    def run_forever(self, should_stop: Callable[[], bool] = lambda: False) -> None:
        log_event("runner_started", type=self.job_type, host="local")
        while not should_stop():
            if self.run_once() == "idle":
                time.sleep(self.interval_s)
