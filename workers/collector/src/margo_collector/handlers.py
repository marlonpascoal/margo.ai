"""Job handlers registered under `margo.jobs` (pyproject): `uv run worker <type> --local`.

The runner checks the job's flag first (JOB_FLAGS: m1.raio_x, A05). A handler error fails the job with the
exception's class name only (margo_common.runner); C03 turns that name into the reason it shows
(AwaitingRecordings, CaptchaBlock, ForbiddenBlock, RateLimitBlock, LoginWall, CollectorBusy).
"""

from __future__ import annotations

import os
from uuid import UUID

from margo_common.runner import JobRun
from pydantic import BaseModel

from .fetcher import (
    DEFAULT_CONTACT,
    PoliteFetcher,
    RefusingTransport,
    SystemClock,
    UrllibTransport,
    live_transport_allowed,
)
from .ifood_public import UnrecordedPages
from .repo import PostgresAdvisoryLock, PostgresPageCache, PostgresXrayRepo
from .steps import calc_step, collect_step, pair_step

DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


def local_db_url() -> str:
    return os.environ.get("MARGO_LOCAL_DB_URL", DEFAULT_LOCAL_DB_URL)


class XrayPayload(BaseModel):
    xray_id: UUID


def collect(run: JobRun[XrayPayload]) -> dict[str, int]:
    """C02 "Buscar vizinhança" (D47). Without recorded pages this stops before any request."""
    url = local_db_url()
    repo = PostgresXrayRepo(url)
    clock = SystemClock()
    transport = UrllibTransport() if live_transport_allowed() else RefusingTransport()
    contact = os.environ.get("MARGO_COLLECTOR_CONTACT", DEFAULT_CONTACT)
    fetcher = PoliteFetcher(transport, clock, PostgresPageCache(url), contact=contact)
    try:
        return collect_step(
            repo,
            str(run.payload.xray_id),
            fetcher=fetcher,
            pages=UnrecordedPages(),
            lock=PostgresAdvisoryLock(url),
            clock=clock,
        )
    finally:
        repo.close()


def xray_pair(run: JobRun[XrayPayload]) -> dict[str, int]:
    """C03 "Confirmar N lojas": M1-03 and M1-04."""
    repo = PostgresXrayRepo(local_db_url())
    try:
        return pair_step(repo, str(run.payload.xray_id))
    finally:
        repo.close()


def xray_calc(run: JobRun[XrayPayload]) -> dict[str, int]:
    """C04 "Calcular raio-X": M1-05 to M1-08."""
    repo = PostgresXrayRepo(local_db_url())
    try:
        return calc_step(repo, str(run.payload.xray_id))
    finally:
        repo.close()


collect.payload_model = XrayPayload  # type: ignore[attr-defined]
xray_pair.payload_model = XrayPayload  # type: ignore[attr-defined]
xray_calc.payload_model = XrayPayload  # type: ignore[attr-defined]
