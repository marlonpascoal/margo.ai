"""`render_close` job: P06 PDF and xlsx of one close_period, into the `closes` bucket (C09, 05 §C).

The module 3 section reads the contribution worker-cost stored for the close; rendering never recomputes it.

Payload {"close_period_id": "<uuid>"}. The web action ("Gerar fechamento mensal") sets the status and
queues the notice; this job only renders and records the paths.
"""

from __future__ import annotations

import os
from collections import defaultdict
from typing import Any

from margo_common.files import FileStore, local_storage
from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel

from .p06 import ChannelRow, P06Data, render_pdf, render_xlsx
from .p06_cost import load_cost_section

CHANNEL = {"ifood": "iFood", "food99": "99Food", "keeta": "Keeta", "rappi": "Rappi"}
SOURCE = {
    ("ifood", "api"): "API do iFood",
    ("ifood", "upload"): "arquivo do iFood",
    ("ifood", "extension"): "extensão do Chrome",
    ("food99", "upload"): "extrato da 99Food",
    ("food99", "bpo_folder"): "extrato da 99Food",
}
LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


class CloseRenderPayload(BaseModel):
    close_period_id: str


def load_p06(conn: Any, close_period_id: str) -> tuple[P06Data, str, str]:
    """P06 data, the account code and yyyy-mm of a close period."""
    cp = conn.execute(
        """select cp.month, a.name, a.code, a.is_synthetic, a.id as account_id from public.close_period cp
           join public.account a on a.id = cp.account_id where cp.id = %s""",
        (close_period_id,),
    ).fetchone()
    lines = conn.execute(
        """select cs.channel::text as channel, cs.name, cl.gross_cents, cl.commission_cents, cl.payment_cents,
                  cl.delivery_cents, cl.promotion_cents, cl.anticipation_cents, cl.payout_cents
           from public.close_line cl join public.channel_store cs on cs.id = cl.channel_store_id
           where cl.close_period_id = %s order by cs.channel, cs.name""",
        (close_period_id,),
    ).fetchall()
    per: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in lines:
        per[r["channel"]][0] += r["gross_cents"]
        per[r["channel"]][1] += r["payout_cents"]
    diffs = conn.execute(
        """select d.rule_id, d.description, cs.channel::text as channel, cs.name, d.orders_count,
                  d.amount_cents,
                  d.confidence::text as confidence, c.status::text as status, c.deadline_on, c.closed_at
           from public.difference d join public.channel_store cs on cs.id = d.channel_store_id
           left join public.contestation c on c.difference_id = d.id
           where d.close_period_id = %s and d.shown order by d.amount_cents desc""",
        (close_period_id,),
    ).fetchall()
    live = [d for d in diffs if d["closed_at"] is None]
    sources = conn.execute(
        """select distinct ir.channel::text as channel, coalesce(src.kind::text, 'upload') as kind
           from public.ledger_entry le join public.import_run ir on ir.id = le.import_run_id
           left join public.import_source src on src.id = ir.source_id
           where le.account_id = %s and date_trunc('month', le.entry_date) = %s""",
        (cp["account_id"], cp["month"]),
    ).fetchall()
    labels = sorted(
        {SOURCE.get((s["channel"], s["kind"]), CHANNEL.get(s["channel"], s["channel"])) for s in sources}
    )
    open_rows = [d for d in live if d["status"] in ("contestada", "a_contestar")]
    deadlines = [d["deadline_on"] for d in live if d["status"] == "a_contestar" and d["deadline_on"]]
    data = P06Data(
        account=cp["name"],
        month=cp["month"],
        synthetic=cp["is_synthetic"],
        channels=[
            ChannelRow(CHANNEL.get(ch, ch), g, p)
            for ch, (g, p) in sorted(per.items(), key=lambda kv: -kv[1][0])
        ],
        wrong_cents=sum(d["amount_cents"] for d in live),
        back_cents=sum(d["amount_cents"] for d in live if d["status"] == "creditada"),
        open_cents=sum(d["amount_cents"] for d in open_rows),
        open_deadline=max(deadlines) if deadlines else None,
        sources=labels,
        store_lines=[
            (
                CHANNEL.get(r["channel"], r["channel"]),
                r["name"],
                {
                    k: r[f"{k}_cents"]
                    for k in (
                        "gross",
                        "commission",
                        "payment",
                        "delivery",
                        "promotion",
                        "anticipation",
                        "payout",
                    )
                },
            )
            for r in lines
        ],
        differences=[
            (
                d["rule_id"],
                d["description"],
                CHANNEL.get(d["channel"], d["channel"]),
                d["name"],
                d["orders_count"],
                d["amount_cents"],
                d["confidence"],
            )
            for d in diffs
        ],
        cost=load_cost_section(conn, close_period_id),
    )
    return data, cp["code"], cp["month"].isoformat()[:7]


def render_and_store(conn: Any, files: FileStore, close_period_id: str) -> tuple[str, str]:
    data, code, ym = load_p06(conn, close_period_id)
    base = f"closes/{code}/{ym}/fechamento-{code}-{ym}"
    files.put(f"{base}.pdf", render_pdf(data), "application/pdf")
    files.put(
        f"{base}.xlsx", render_xlsx(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    conn.execute(
        "update public.close_period set pdf_path = %s, xlsx_path = %s where id = %s",
        (f"{base}.pdf", f"{base}.xlsx", close_period_id),
    )
    return f"{base}.pdf", f"{base}.xlsx"


def render_close(job: JobRun[CloseRenderPayload]) -> dict[str, LogValue]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(LOCAL_DB_URL, autocommit=True, row_factory=dict_row) as conn:
        render_and_store(conn, local_storage(), job.payload.close_period_id)
    return {"close_period_id": job.payload.close_period_id}


render_close.payload_model = CloseRenderPayload  # type: ignore[attr-defined]
