"""Job handlers registered under `margo.jobs` (pyproject): `uv run worker <type> --local`.

The runner checks the job's flag first (JOB_FLAGS: m1.raio_x, A05). A handler error fails the job with the
exception's class name only (margo_common.runner); C03 turns that name into the reason it shows.
"""

from __future__ import annotations

import os
from uuid import UUID

from margo_common.flags import flag_env
from margo_common.runner import JobRun
from pydantic import BaseModel

from .repo import PostgresXrayRepo
from .steps import calc_step, collect_step, neighborhood_job_step, pair_step

DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


def local_db_url() -> str:
    return os.environ.get("MARGO_LOCAL_DB_URL", DEFAULT_LOCAL_DB_URL)


class XrayPayload(BaseModel):
    xray_id: UUID


class NeighborhoodPayload(XrayPayload):
    queue_captures: bool = False


def collect(run: JobRun[XrayPayload]) -> dict[str, int]:
    """C02 "Buscar vizinhança": queues the discovery of the target (docs/extract-api.md)."""
    repo = PostgresXrayRepo(local_db_url())
    try:
        return collect_step(repo, str(run.payload.xray_id), flag_env())
    finally:
        repo.close()


def xray_neighborhood(run: JobRun[NeighborhoodPayload]) -> dict[str, int]:
    """M1-01 and M1-02 from the applied copies, after a discovery and again after its captures."""
    repo = PostgresXrayRepo(local_db_url())
    try:
        return neighborhood_job_step(
            repo, str(run.payload.xray_id), flag_env(), queue_captures=run.payload.queue_captures
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
xray_neighborhood.payload_model = NeighborhoodPayload  # type: ignore[attr-defined]
xray_pair.payload_model = XrayPayload  # type: ignore[attr-defined]
xray_calc.payload_model = XrayPayload  # type: ignore[attr-defined]
