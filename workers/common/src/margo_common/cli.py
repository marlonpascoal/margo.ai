"""`uv run worker <type> --local`: run the LocalRunner for one job type against the local stack.

Handlers come from the `margo.jobs` entry point group: each worker package declares
`[project.entry-points."margo.jobs"] <type> = "module:handler"` (an optional `payload_model` attribute on the
handler validates the payload). `ping` is built in, for checking the queue end to end.
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
from importlib.metadata import entry_points

from .jobs import NewJob
from .log import log_event
from .runner import Handler, JobRun, LocalRunner, LogValue

LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


def ping(run: JobRun[object]) -> dict[str, LogValue]:
    """Built-in job type that does nothing; proves a job goes queued, running, done."""
    return {"ok": True}


def find_handler(job_type: str) -> Handler | None:
    if job_type == "ping":
        return ping
    for ep in entry_points(group="margo.jobs"):
        if ep.name == job_type:
            return ep.load()
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="worker", description="Run a job worker.")
    parser.add_argument("type", help="job type, e.g. ping")
    parser.add_argument(
        "--local", action="store_true", help="poll the local Supabase stack (MARGO_LOCAL_DB_URL)"
    )
    parser.add_argument("--once", action="store_true", help="process at most one job, then exit")
    parser.add_argument(
        "--enqueue", action="store_true", help="enqueue one job of this type first (local testing)"
    )
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between polls when idle")
    args = parser.parse_args(argv)

    if not args.local:
        parser.error("only --local is available; the Maritime runner comes with the first deployed worker")
    handler = find_handler(args.type)
    if handler is None:
        parser.error(f"no handler registered for job type {args.type!r}")

    from .stores import PostgresJobStore

    runner = LocalRunner(PostgresJobStore(LOCAL_DB_URL), args.type, interval_s=args.interval)
    runner.on_job(args.type, handler, getattr(handler, "payload_model", None))
    if args.enqueue:
        log_event("job_enqueued", job_id=str(runner.enqueue(NewJob(type=args.type))), type=args.type)
    if args.once:
        log_event("run_once", type=args.type, outcome=runner.run_once())
        return 0

    stop = {"now": False}

    def on_signal(*_: object) -> None:
        stop["now"] = True

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    runner.run_forever(lambda: stop["now"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
