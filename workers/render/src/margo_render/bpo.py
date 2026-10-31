"""`render_close_bpo` job: P06 with a BPO partner's brand (C18 "Gerar fechamento com a marca do BPO", 05 §C).

Payload {"close_period_id", "bpo_partner_id"}. The runner refuses the job when `bpo.marca_propria` is off for
the account (JOB_FLAGS, A05). The account must be a client of the partner (bpo_client). The branded PDF uses
only the partner's logo and color; "com tecnologia MargoAI" follows the partner's toggle (C18 "Done when").
The partner's shared folder is outside MargoAI (no live calls): the PDF goes to the private `closes` bucket
under closes/bpo/<partner id>/, where the console offers it for download.
"""

from __future__ import annotations

from typing import Any

from margo_common.files import FileStore, local_storage
from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel

from .close_job import LOCAL_DB_URL, load_p06
from .p06 import Brand, P06Data, render_pdf


class BpoRenderPayload(BaseModel):
    close_period_id: str
    bpo_partner_id: str


def load_brand(conn: Any, files: FileStore, partner_id: str, account_id: str) -> Brand | None:
    """The partner's brand for one of its clients; None when the account is not its client."""
    row = conn.execute(
        """select p.name, p.primary_color, p.logo_path, p.show_powered_by from public.bpo_partner p
           join public.bpo_client c on c.bpo_partner_id = p.id
           where p.id = %s and c.account_id = %s""",
        (partner_id, account_id),
    ).fetchone()
    if row is None:
        return None
    logo = None
    if row["logo_path"]:
        try:
            logo = files.get(row["logo_path"])
        except FileNotFoundError:
            logo = None
    return Brand(
        name=row["name"], color=row["primary_color"], logo=logo, show_powered_by=row["show_powered_by"]
    )


def with_brand(data: P06Data, brand: Brand) -> P06Data:
    """The one change the BPO variant makes to P06: its brand instead of MargoAI's."""
    return P06Data(**{**data.__dict__, "brand": brand})


def bpo_pdf_path(partner_id: str, code: str, ym: str) -> str:
    return f"closes/bpo/{partner_id}/{code}/{ym}/fechamento-{code}-{ym}.pdf"


def render_bpo_and_store(conn: Any, files: FileStore, close_period_id: str, partner_id: str) -> str:
    account = conn.execute(
        "select account_id from public.close_period where id = %s", (close_period_id,)
    ).fetchone()
    if account is None:
        raise LookupError("unknown close period")
    brand = load_brand(conn, files, partner_id, account["account_id"])
    if brand is None:
        raise PermissionError("account is not a client of this BPO partner")
    data, code, ym = load_p06(conn, close_period_id)
    path = bpo_pdf_path(partner_id, code, ym)
    files.put(path, render_pdf(with_brand(data, brand)), "application/pdf")
    return path


def render_close_bpo(job: JobRun[BpoRenderPayload]) -> dict[str, LogValue]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(LOCAL_DB_URL, autocommit=True, row_factory=dict_row) as conn:
        path = render_bpo_and_store(
            conn, local_storage(), job.payload.close_period_id, job.payload.bpo_partner_id
        )
    return {"close_period_id": job.payload.close_period_id, "pdf_path": path}


render_close_bpo.payload_model = BpoRenderPayload  # type: ignore[attr-defined]
