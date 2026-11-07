"""B01 (MARGO_DB_TESTS=1): the portal result loader (public.monitor_result) shows exactly what P01 prints for the same run,
from the same rule outputs: date, radius, stores compared, item counts, KPIs, the M1-09 top 3 and "não mexa" lists in
P01 order, the M1-08 Pareto count, the items left out and the method note. Runs on every X-ray of the G-SYN seed."""

from __future__ import annotations

import os

import pytest
from margo_render.handlers import load_report
from margo_render.P01_raio_x import report_items_m1_09

pytestmark = pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")


@pytest.fixture
def conn():
    import psycopg
    from psycopg.rows import dict_row

    url = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as c:
        yield c


def test_B01_portal_result_and_p01_cannot_disagree(conn):
    ids = [r["id"] for r in conn.execute("select id from public.xray where exists (select 1 from public.xray_item i where i.xray_id = xray.id)")]
    assert ids, "the G-SYN seed has calculated X-rays"
    for xid in ids:
        report, _ = load_report(conn, str(xid))
        res = conn.execute("select public.monitor_result(%s) as r", (xid,)).fetchone()["r"]
        up, hold = report_items_m1_09(report.analyzed)
        assert res["on"] == (report.on.isoformat() if report.on else None)
        assert res["radius_km"] == report.radius_km
        assert res["stores_compared"] == report.stores_compared
        assert res["items_total"] == len(report.items)
        assert res["items_analyzed"] == len(report.analyzed)
        assert res["below"] == sum(1 for i in report.analyzed if i.reading == "pode_subir")
        assert res["above"] == sum(1 for i in report.analyzed if i.reading == "nao_mexer")
        assert [i["name"] for i in res["top_raise"]] == [i.name for i in up]
        assert [i["name"] for i in res["dont_lower"]] == [i.name for i in hold]
        assert [(i["own_cents"], i["parity_cents"]) for i in res["top_raise"]] == [(i.own_cents, i.parity_cents) for i in up]
        assert res["pareto_count"] == report.pareto_count
        assert res["left_out_items"] == sorted(i.name for i in report.items if i.skipped)
        assert res["method_note"] == (
            f"Fonte: cardápios públicos no iFood. Paridade = mediana dos itens comparáveis em {report.radius_km} km. "
            "Sem dado de custo."
        )
        assert res["synthetic"] == report.synthetic
