"""A07, A08 and the A05 job hook: the runner, the queue functions and the signed wake-up (02 §4).

Every test runs against the in-memory store. With MARGO_DB_TESTS=1 the same tests also run against the
local Supabase stack, through a direct connection and through the REST API, so the SQL functions of
supabase/migrations/20261031000006_jobs.sql are exercised end to end.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import threading
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from margo_common import signing
from margo_common.jobs import JobStore, NewJob
from margo_common.runner import JobProcessor, LocalRunner, WakeupReceiver
from margo_common.signing import WakeupRejected, sign_wakeup, verify_wakeup
from margo_common.stores import MemoryJobStore
from margo_contracts.models import AlertSeverity, JobStatus
from pydantic import BaseModel

REPO = Path(__file__).resolve().parents[3]
DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))


class FakeClock:
    def __init__(self) -> None:
        self.t = datetime.now(UTC)

    def __call__(self) -> datetime:
        return self.t

    def advance(self, **kw: float) -> None:
        self.t += timedelta(**kw)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def key() -> bytes:
    # Throwaway key per test run; never committed.
    return secrets.token_bytes(32)


@pytest.fixture
def job_type() -> str:
    return f"test_{uuid.uuid4().hex[:12]}"


def _postgres_store(job_type: str):
    from margo_common.stores import PostgresJobStore

    return PostgresJobStore(
        os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    )


def _rest_store(job_type: str):
    from margo_common.stores import RestJobStore

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        pytest.skip("REST store needs the local stack env (scripts/with-local-env.mjs)")
    return RestJobStore(url, key)


STORES = [
    "memory",
    pytest.param("postgres", marks=pytest.mark.skipif(not DB_TESTS, reason="needs the local stack")),
    pytest.param("rest", marks=pytest.mark.skipif(not DB_TESTS, reason="needs the local stack")),
]


@pytest.fixture(params=STORES)
def store(request: pytest.FixtureRequest, clock: FakeClock, job_type: str) -> Iterator[JobStore]:
    if request.param == "memory":
        yield MemoryJobStore(now=clock)
        return
    s = _postgres_store(job_type) if request.param == "postgres" else _rest_store(job_type)
    yield s
    _cleanup(job_type)


def _cleanup(job_type: str) -> None:
    import psycopg

    url = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            "delete from public.alert where id in (select (e ->> 'alert_id')::uuid from public.job j,"
            " jsonb_array_elements(j.log) e where j.type = %s and e ? 'alert_id')",
            (job_type,),
        )
        conn.execute("delete from public.job where type = %s", (job_type,))


class Calls:
    def __init__(self) -> None:
        self.ids: list[uuid.UUID] = []

    def __call__(self, run):  # noqa: ANN001
        self.ids.append(run.job.id)
        return {"rows": 1}


def _processor(store: JobStore, job_type: str, clock: FakeClock, handler=None, **kw) -> JobProcessor:  # noqa: ANN001
    p = JobProcessor(store, now=clock, **kw)
    p.register(job_type, handler or Calls())
    return p


def _events(store: JobStore, job_id: uuid.UUID) -> list[str]:
    job = store.get(job_id)
    assert job is not None
    return [e["event"] for e in job.log]  # type: ignore[index,union-attr]


# A07 ------------------------------------------------------------------------------------------


def test_A07_duplicate_webhook_delivery_runs_the_job_once(
    store: JobStore, job_type: str, clock: FakeClock, key: bytes
) -> None:
    calls = Calls()
    receiver = WakeupReceiver(_processor(store, job_type, clock, calls), key=key, now=clock)
    job_id = store.insert(NewJob(type=job_type, payload={"n": 1}, dedupe_key="2026-09"))
    body = sign_wakeup(job_id, key, now=clock())

    first = receiver.receive(body)
    clock.advance(seconds=5)
    second = receiver.receive(json.dumps(body).encode())

    assert first.outcome == "done"
    assert second.outcome == "not_claimed"
    assert calls.ids == [job_id]
    job = store.get(job_id)
    assert job is not None and job.status == JobStatus.DONE and job.attempts == 1


def test_A07_racing_deliveries_have_exactly_one_winner(
    store: JobStore, job_type: str, clock: FakeClock, key: bytes
) -> None:
    calls = Calls()
    lock = threading.Lock()

    def handler(run):  # noqa: ANN001
        with lock:
            return calls(run)

    receiver = WakeupReceiver(_processor(store, job_type, clock, handler), key=key, now=clock)
    job_id = store.insert(NewJob(type=job_type))
    body = sign_wakeup(job_id, key, now=clock())
    outcomes: list[str] = []
    threads = [
        threading.Thread(target=lambda: outcomes.append(receiver.receive(body).outcome)) for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert calls.ids == [job_id]
    assert sorted(outcomes) == ["done"] + ["not_claimed"] * 7


def test_A07_dedupe_key_enqueues_one_active_job(store: JobStore, job_type: str) -> None:
    a = store.insert(NewJob(type=job_type, dedupe_key="s1:2026-09-30"))
    b = store.insert(NewJob(type=job_type, dedupe_key="s1:2026-09-30"))
    c = store.insert(NewJob(type=job_type, dedupe_key="s1:2026-10-01"))
    assert a == b
    assert c != a


@pytest.mark.parametrize(
    "tamper",
    [
        "unsigned",
        "empty_sig",
        "wrong_key",
        "tampered_job_id",
        "tampered_ts",
        "tampered_sig",
        "stale",
        "future",
        "malformed",
    ],
)
def test_A07_unsigned_stale_or_tampered_calls_are_rejected(
    store: JobStore, job_type: str, clock: FakeClock, key: bytes, tamper: str
) -> None:
    calls = Calls()
    receiver = WakeupReceiver(_processor(store, job_type, clock, calls), key=key, now=clock)
    job_id = store.insert(NewJob(type=job_type))
    other_id = store.insert(NewJob(type=job_type))
    body: dict | bytes = sign_wakeup(job_id, key, now=clock())
    assert isinstance(body, dict)
    match tamper:
        case "unsigned":
            body = {"job_id": body["job_id"], "ts": body["ts"]}
        case "empty_sig":
            body = {**body, "sig": ""}
        case "wrong_key":
            body = sign_wakeup(job_id, secrets.token_bytes(32), now=clock())
        case "tampered_job_id":
            body = {**body, "job_id": str(other_id)}
        case "tampered_ts":
            body = {**body, "ts": body["ts"] - 1}
        case "tampered_sig":
            body = {**body, "sig": body["sig"][:-1] + ("0" if body["sig"][-1] != "0" else "1")}
        case "stale":
            clock.advance(minutes=5, seconds=1)
        case "future":
            body = sign_wakeup(job_id, key, now=clock() + timedelta(minutes=6))
        case "malformed":
            body = b"{not json"

    with pytest.raises(WakeupRejected):
        receiver.receive(body)
    assert calls.ids == []
    assert store.get(job_id).status == JobStatus.QUEUED  # type: ignore[union-attr]
    assert store.get(other_id).status == JobStatus.QUEUED  # type: ignore[union-attr]


def test_A07_a_call_just_inside_five_minutes_is_accepted(
    store: JobStore, job_type: str, clock: FakeClock, key: bytes
) -> None:
    receiver = WakeupReceiver(_processor(store, job_type, clock), key=key, now=clock)
    job_id = store.insert(NewJob(type=job_type))
    body = sign_wakeup(job_id, key, now=clock())
    clock.advance(minutes=4, seconds=59)
    assert receiver.receive(body).outcome == "done"


def test_A07_signature_is_hmac_sha256_of_job_id_and_ts(key: bytes) -> None:
    import hashlib
    import hmac

    job_id = uuid.uuid4()
    now = datetime(2026, 10, 31, 9, 0, tzinfo=UTC)
    body = sign_wakeup(job_id, key, now=now)
    ts = int(now.timestamp())
    assert body == {
        "job_id": str(job_id),
        "ts": ts,
        "sig": hmac.new(key, f"{job_id}|{ts}".encode(), hashlib.sha256).hexdigest(),
    }
    assert verify_wakeup(body, key, now=now) == job_id


def test_A07_missing_signing_key_rejects_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(signing.KEY_ENV, raising=False)
    with pytest.raises(WakeupRejected):
        signing.key_from_env()
    monkeypatch.setenv(signing.KEY_ENV, "")
    with pytest.raises(WakeupRejected):
        signing.key_from_env()


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_A07_python_verifier_accepts_the_typescript_signer(key: bytes) -> None:
    script = (
        "import { signWakeup } from './apps/web/lib/jobs/sign.ts';"
        "const [id, k, ms] = process.argv.slice(1);"
        "console.log(JSON.stringify(signWakeup(id, Buffer.from(k, 'hex'), new Date(Number(ms)))));"
    )
    job_id = uuid.uuid4()
    now = datetime.now(UTC)
    out = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--no-warnings",
            "--input-type=module",
            "-e",
            script,
            str(job_id),
            key.hex(),
            str(int(now.timestamp() * 1000)),
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert verify_wakeup(json.loads(out), key, now=now) == job_id


# A08 ------------------------------------------------------------------------------------------


def test_A08_stuck_job_requeues_once_then_fails_with_an_urgente_alert(
    store: JobStore, job_type: str, clock: FakeClock
) -> None:
    processor = _processor(store, job_type, clock)
    job_id = store.insert(NewJob(type=job_type))

    assert store.claim(job_id) is not None  # a worker claims it and dies
    clock.advance(minutes=29)
    assert processor.sweep() == []
    clock.advance(minutes=2)
    [first] = processor.sweep()
    assert (first.job_id, first.outcome, first.alert_id) == (job_id, "requeued", None)
    job = store.get(job_id)
    assert job is not None and job.status == JobStatus.QUEUED and job.claimed_at is None

    assert store.claim(job_id) is not None  # claimed again (store clock), dies again
    clock.advance(minutes=31)
    [second] = processor.sweep()
    assert (second.job_id, second.outcome) == (job_id, "failed")
    assert second.alert_id is not None
    job = store.get(job_id)
    assert job is not None and job.status == JobStatus.FAILED and job.attempts == 2
    assert _events(store, job_id)[-1] == "failed"
    assert job.log[-1]["reason"] == "stuck"  # type: ignore[index,call-overload]
    alert = store.get_alert(second.alert_id)
    assert alert is not None and alert.severity == AlertSeverity.URGENTE
    assert alert.resolved_at is None
    assert processor.sweep() == []


def test_A08_local_runner_sweeps_then_reruns_the_requeued_job(
    store: JobStore, job_type: str, clock: FakeClock
) -> None:
    calls = Calls()
    runner = LocalRunner(store, job_type, now=clock)
    runner.on_job(job_type, calls)
    job_id = runner.enqueue(NewJob(type=job_type))
    assert store.claim(job_id) is not None
    clock.advance(minutes=31)
    assert runner.run_once() == "done"
    assert calls.ids == [job_id]
    assert _events(store, job_id) == ["claimed", "stuck_requeued", "claimed", "done"]


# A05 hook -------------------------------------------------------------------------------------


def test_A05_flag_off_job_refuses_to_run(
    store: JobStore, job_type: str, clock: FakeClock, key: bytes
) -> None:
    calls = Calls()
    seen: list[str] = []

    def flag_check(job) -> bool:  # noqa: ANN001
        seen.append(job.type)
        return False

    receiver = WakeupReceiver(
        _processor(store, job_type, clock, calls, flag_check=flag_check), key=key, now=clock
    )
    job_id = store.insert(NewJob(type=job_type))
    assert receiver.receive(sign_wakeup(job_id, key, now=clock())).outcome == "failed"
    assert calls.ids == []
    assert seen == [job_type]
    job = store.get(job_id)
    assert job is not None and job.status == JobStatus.FAILED
    assert job.log[-1]["reason"] == "flag_off"  # type: ignore[index,call-overload]


def test_A05_default_flag_check_allows_every_job(store: JobStore, job_type: str, clock: FakeClock) -> None:
    calls = Calls()
    runner = LocalRunner(store, job_type, now=clock)
    runner.on_job(job_type, calls)
    runner.enqueue(NewJob(type=job_type))
    assert runner.run_once() == "done"
    assert len(calls.ids) == 1


# Runner behavior ------------------------------------------------------------------------------


def test_handler_error_fails_the_job_and_logs_ids_only(
    store: JobStore, job_type: str, clock: FakeClock, capsys: pytest.CaptureFixture[str]
) -> None:
    def handler(run):  # noqa: ANN001
        raise ValueError("Pantanos Burguer R$ 186,00")

    runner = LocalRunner(store, job_type, now=clock)
    runner.on_job(job_type, handler)
    job_id = runner.enqueue(NewJob(type=job_type, payload={"store": "Pantanos Burguer"}))
    assert runner.run_once() == "failed"
    job = store.get(job_id)
    assert job is not None and job.status == JobStatus.FAILED
    assert job.log[-1]["error"] == "ValueError"  # type: ignore[index,call-overload]
    printed = capsys.readouterr()
    # Look for the message's own tokens: a bare "186" also turns up by chance in timestamps,
    # durations and job ids, while "186,00" (Brazilian decimal comma) and "R$" cannot.
    for text in (json.dumps(job.log, ensure_ascii=False), printed.out, printed.err):
        for token in ("Pantanos", "Burguer", "R$", "186,00"):
            assert token not in text, token
    assert str(job_id) in printed.err


def test_done_job_logs_handler_result(store: JobStore, job_type: str, clock: FakeClock) -> None:
    runner = LocalRunner(store, job_type, now=clock)
    runner.on_job(job_type, lambda run: {"rows": 42})
    job_id = runner.enqueue(NewJob(type=job_type))
    assert runner.run_once() == "done"
    assert runner.run_once() == "idle"
    job = store.get(job_id)
    assert job is not None and job.finished_at is not None
    assert job.log[-1]["event"] == "done" and job.log[-1]["rows"] == 42  # type: ignore[index,call-overload]


class Period(BaseModel):
    store_id: uuid.UUID
    month: str


def test_typed_payload_is_validated_before_the_handler(
    store: JobStore, job_type: str, clock: FakeClock
) -> None:
    got: list[Period] = []
    runner = LocalRunner(store, job_type, now=clock)
    runner.on_job(job_type, lambda run: got.append(run.payload), payload_model=Period)
    sid = uuid.uuid4()
    runner.enqueue(NewJob(type=job_type, payload={"store_id": str(sid), "month": "2026-09"}))
    bad = runner.enqueue(NewJob(type=job_type, payload={"month": 9}))
    assert runner.run_once() == "done"
    assert got == [Period(store_id=sid, month="2026-09")]
    assert runner.run_once() == "failed"
    assert store.get(bad).log[-1]["reason"] == "bad_payload"  # type: ignore[index,union-attr,call-overload]


def test_job_without_handler_fails(store: JobStore, job_type: str, clock: FakeClock, key: bytes) -> None:
    receiver = WakeupReceiver(JobProcessor(store, now=clock), key=key, now=clock)
    job_id = store.insert(NewJob(type=job_type))
    assert receiver.receive(sign_wakeup(job_id, key, now=clock())).outcome == "failed"
    assert store.get(job_id).log[-1]["reason"] == "no_handler"  # type: ignore[index,union-attr,call-overload]


def test_local_runner_only_takes_its_own_type(store: JobStore, job_type: str, clock: FakeClock) -> None:
    calls = Calls()
    runner = LocalRunner(store, job_type, now=clock)
    runner.on_job(job_type, calls)
    other = store.insert(NewJob(type=job_type + "_other"))
    assert runner.run_once() == "idle"
    assert store.get(other).status == JobStatus.QUEUED  # type: ignore[union-attr]
    if not isinstance(store, MemoryJobStore):
        _cleanup(job_type + "_other")


def test_log_lines_redact_secret_fields(capsys: pytest.CaptureFixture[str]) -> None:
    from margo_common.log import log_event

    log_event("wake", job_id="j1", signing_key="abc", Authorization="Bearer x", attempts=2)
    line = json.loads(capsys.readouterr().err)
    assert line["signing_key"] == "[redacted]" and line["Authorization"] == "[redacted]"
    assert line["job_id"] == "j1" and line["attempts"] == 2
