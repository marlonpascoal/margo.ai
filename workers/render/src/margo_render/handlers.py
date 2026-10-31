"""`render_xray` job (C05 "Preparar entrega"): P01 from the stored X-ray, saved to the private `pdf` bucket,
path written to xray.pdf_path. Run locally with `node scripts/with-local-env.mjs uv run worker render_xray
--local` (the storage upload needs the local stack's URL and service key, which that script provides)."""

from __future__ import annotations

import os
import urllib.request
from typing import Protocol
from uuid import UUID

from margo_common.runner import JobRun
from pydantic import BaseModel

from .P01_raio_x import ReportItem, XrayReport, render_p01

SAO_PAULO = "America/Sao_Paulo"


class XrayPayload(BaseModel):
    xray_id: UUID


class PdfStore(Protocol):
    def put(self, path: str, body: bytes) -> None: ...


class SupabaseStorage:
    """Supabase Storage REST with the service role (02 §6: the key comes from the environment)."""

    def __init__(self, url: str, key: str, bucket: str = "pdf") -> None:
        self.base = url.rstrip("/") + f"/storage/v1/object/{bucket}/"
        self.key = key

    def put(self, path: str, body: bytes) -> None:
        req = urllib.request.Request(
            self.base + path,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.key}",
                "apikey": self.key,
                "Content-Type": "application/pdf",
                "x-upsert": "true",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (our Supabase URL)
            if resp.status >= 300:
                raise RuntimeError(f"storage upload returned {resp.status}")


def load_report(conn, xray_id: str) -> tuple[XrayReport, str]:
    """The report data for one X-ray, and the account's code or 'lead' for the file path."""
    x = conn.execute(
        "select x.id, x.radius_km, (x.collected_at at time zone %s)::date as on_day, s.name as store_name,"
        " coalesce(a.is_synthetic, false) as synthetic, a.code,"
        " (select count(*) from public.xray_store xs where xs.xray_id = x.id and xs.included) as stores"
        " from public.xray x join public.public_store s on s.id = x.target_store_id"
        " left join public.account a on a.id = x.account_id where x.id = %s",
        (SAO_PAULO, xray_id),
    ).fetchone()
    if x is None:
        raise LookupError("unknown X-ray")
    rows = conn.execute(
        "select m.name, m.price_cents, i.parity_cents, i.gap_pct, i.reading, i.loss_cents, i.skipped, i.pareto_rank,"
        " i.pareto_cum_share from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id"
        " where i.xray_id = %s order by m.name",
        (xray_id,),
    ).fetchall()
    items = tuple(
        ReportItem(
            r["name"],
            r["price_cents"],
            r["parity_cents"],
            r["gap_pct"],
            r["reading"],
            r["loss_cents"],
            r["skipped"],
        )
        for r in rows
    )
    ranked = sorted((r for r in rows if r["pareto_rank"]), key=lambda r: r["pareto_rank"])
    pareto = next((r["pareto_rank"] for r in ranked if r["pareto_cum_share"] >= 0.8), 0)
    report = XrayReport(
        store_name=x["store_name"] or "Loja",
        on=x["on_day"],
        radius_km=x["radius_km"],
        stores_compared=x["stores"],
        items=items,
        pareto_count=pareto,
        synthetic=x["synthetic"],
        seed=x["synthetic"],
    )
    return report, x["code"] or "lead"


def render_and_store(conn, store: PdfStore, xray_id: str) -> dict[str, int]:
    report, code = load_report(conn, xray_id)
    if not report.analyzed:
        raise ValueError("the X-ray has not been calculated")
    pdf = render_p01(report)
    path = f"raio-x/{code}/{xray_id}.pdf"
    store.put(path, pdf)
    conn.execute("update public.xray set pdf_path = %s where id = %s", (path, xray_id))
    return {"bytes": len(pdf)}


def render_xray(run: JobRun[XrayPayload]) -> dict[str, int]:
    import psycopg
    from psycopg.rows import dict_row

    db = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    url = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    store = SupabaseStorage(url, os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    with psycopg.connect(db, autocommit=True, row_factory=dict_row) as conn:
        return render_and_store(conn, store, str(run.payload.xray_id))


render_xray.payload_model = XrayPayload  # type: ignore[attr-defined]
