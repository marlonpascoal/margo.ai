"""A05, job side: the runner's flag check reads JOB_FLAGS and evaluates public.flag_enabled (04 §6).

Unit tests use a fake RPC. With MARGO_DB_TESTS=1 the same check runs through the real RPC on the local
stack, against the G-SYN seed: G-04 is on the Raio-X plan (m2.* off), G-01 on Lucro (m2.* on).
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from margo_common.jobs import JobStore, NewJob
from margo_common.runner import JOB_FLAGS, JobProcessor, job_flag_check
from margo_common.stores import MemoryJobStore
from margo_contracts.models import JobStatus

DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))
LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")

# G-SYN seed ids (supabase/seed/g_syn.sql, pg_temp.sid).
G01_LUCRO = uuid.UUID("7876ec36-6300-3834-5468-98cc88f67dcb")
G04_RAIO_X = uuid.UUID("d29683f3-afca-ad7d-7117-f13ec21d8cc1")


class FakeRpc:
    def __init__(self, on: set[tuple[str, str | None]]) -> None:
        self.on = on
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, fn: str, params: Mapping[str, Any]) -> Any:
        self.calls.append((fn, dict(params)))
        return (params["p_key"], params["p_account"]) in self.on


class Calls:
    def __init__(self) -> None:
        self.ids: list[uuid.UUID] = []

    def __call__(self, run):  # noqa: ANN001
        self.ids.append(run.job.id)
        return {"rows": 1}


def test_A05_job_flags_map_the_job_types_the_spec_names() -> None:
    assert JOB_FLAGS == {
        "collect": "m1.raio_x",
        "xray_neighborhood": "m1.raio_x",
        "extract_discover": "m1.extracao",
        "extract_capture": "m1.extracao",
        "xray_pair": "m1.raio_x",
        "xray_calc": "m1.raio_x",
        "render_xray": "m1.raio_x",
        "import_ifood_api": "m2.ifood_api",
        "import_ifood_file": "m2.arquivo_ifood",
        "import_99food_file": "m2.arquivo_99food",
        "import_invoice_zip": "m3.notas_xml",
        "match_ai": "m3.depara_ia",
        "compute_contribution": "m3.custo",
        "render_close_bpo": "bpo.marca_propria",
    }


def test_A05_flag_check_evaluates_the_mapped_flag_for_the_job_account() -> None:
    store = MemoryJobStore()
    rpc = FakeRpc({("m2.arquivo_ifood", str(G01_LUCRO))})
    calls = Calls()
    p = JobProcessor(store, flag_check=job_flag_check(rpc, "sandbox"))
    p.register("import_ifood_file", calls)
    on = store.insert(NewJob(type="import_ifood_file", account_id=G01_LUCRO))
    off = store.insert(NewJob(type="import_ifood_file", account_id=G04_RAIO_X))
    assert p.deliver(on) == "done"
    assert p.deliver(off) == "failed"
    assert calls.ids == [on]
    assert store.get(off).log[-1]["reason"] == "flag_off"  # type: ignore[index,union-attr,call-overload]
    assert rpc.calls[0] == (
        "flag_enabled",
        {"p_key": "m2.arquivo_ifood", "p_account": str(G01_LUCRO), "p_env": "sandbox"},
    )


def test_A05_system_job_passes_no_account_to_the_flag_rule() -> None:
    store = MemoryJobStore()
    rpc = FakeRpc({("m1.raio_x", None)})
    p = JobProcessor(store, flag_check=job_flag_check(rpc, "production"))
    p.register("collect", Calls())
    assert p.deliver(store.insert(NewJob(type="collect"))) == "done"
    assert rpc.calls == [("flag_enabled", {"p_key": "m1.raio_x", "p_account": None, "p_env": "production"})]


def test_A05_job_type_without_a_flag_runs_without_an_rpc_call() -> None:
    store = MemoryJobStore()
    rpc = FakeRpc(set())
    p = JobProcessor(store, flag_check=job_flag_check(rpc, "sandbox"))
    p.register("ping", Calls())
    assert p.deliver(store.insert(NewJob(type="ping", account_id=G04_RAIO_X))) == "done"
    assert rpc.calls == []


# Real RPC on the local stack ------------------------------------------------------------------


def _rest_store() -> JobStore:
    from margo_common.stores import RestJobStore

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        pytest.skip("REST store needs the local stack env (scripts/with-local-env.mjs)")
    return RestJobStore(url, key)


@pytest.fixture(
    params=[
        pytest.param("postgres", marks=pytest.mark.skipif(not DB_TESTS, reason="needs the local stack")),
        pytest.param("rest", marks=pytest.mark.skipif(not DB_TESTS, reason="needs the local stack")),
    ]
)
def db_store(request: pytest.FixtureRequest) -> Iterator[Any]:
    from margo_common.stores import PostgresJobStore

    store = PostgresJobStore(LOCAL_DB_URL) if request.param == "postgres" else _rest_store()
    created: list[uuid.UUID] = []
    yield store, created
    import psycopg

    with psycopg.connect(LOCAL_DB_URL, autocommit=True) as conn:
        conn.execute("delete from public.job where id = any(%s)", (created,))


def test_A05_job_refuses_to_run_when_flag_off(db_store: Any) -> None:
    store, created = db_store
    calls = Calls()
    p = JobProcessor(store, flag_check=job_flag_check(store.rpc, "sandbox"))
    p.register("import_ifood_file", calls)
    # Unique dedupe keys so a leftover queued job of the same type never collides.
    off = store.insert(NewJob("import_ifood_file", {}, G04_RAIO_X, f"a05-{uuid.uuid4().hex}"))
    on = store.insert(NewJob("import_ifood_file", {}, G01_LUCRO, f"a05-{uuid.uuid4().hex}"))
    created += [off, on]

    assert p.deliver(off) == "failed"
    assert p.deliver(on) == "done"
    assert calls.ids == [on]
    job = store.get(off)
    assert job is not None and job.status == JobStatus.FAILED
    assert job.log[-1]["reason"] == "flag_off"  # type: ignore[index,call-overload]


def test_A05_system_job_uses_the_no_account_rule_through_the_real_rpc(db_store: Any) -> None:
    store, _ = db_store
    # m1.raio_x is on in at least one plan; m3.nfce_qr_auto is off in every plan (not launched).
    assert store.rpc("flag_enabled", {"p_key": "m1.raio_x", "p_account": None, "p_env": "sandbox"}) is True
    assert (
        store.rpc("flag_enabled", {"p_key": "m3.nfce_qr_auto", "p_account": None, "p_env": "sandbox"})
        is False
    )
