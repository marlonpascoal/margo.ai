"""P06: the closing PDF of G-SYN September without cost (05 §C, 08 Wave 1). Read back as text."""

from __future__ import annotations

import io
import os
from datetime import date

import pytest
from margo_render.p06 import ChannelRow, P06Data, render_pdf, render_xlsx
from openpyxl import load_workbook
from pypdf import PdfReader

DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))

GSYN = P06Data(
    account="Grupo Exemplo",
    month=date(2026, 9, 1),
    synthetic=True,
    channels=[ChannelRow("iFood", 9_240_000, 6_882_900), ChannelRow("99Food", 1_860_000, 1_447_100)],
    wrong_cents=118_400,
    back_cents=23_800,
    open_cents=71_800,
    open_deadline=date(2026, 11, 20),
    sources=["arquivo do iFood", "extrato da 99Food"],
)


def text(pdf: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 1
    box = reader.pages[0].mediabox
    assert (round(float(box.width) / 72 * 25.4), round(float(box.height) / 72 * 25.4)) == (210, 297), "A4"
    return " ".join(reader.pages[0].extract_text().split())


def test_P06_totals_equal_C08_and_cost_is_missing() -> None:
    t = text(render_pdf(GSYN))
    for s in (
        "Fechamento de setembro/2026 · Grupo Exemplo",
        "Você vendeu R$ 111.000 no delivery e recebeu R$ 83.300",
        "iFood 92.400 23.571 68.829 74,5%",
        "99Food 18.600 4.129 14.471 77,8%",
        "Cobrado errado no mês",
        "R$ 1.184",
        "R$ 238 já voltou. R$ 718 contestados, resposta até 20/nov.",
        "Custo dos insumos",
        "falta custo",
        "Fontes: arquivo do iFood, extrato da 99Food.",
    ):
        assert s in t, s
    assert "—" not in t, "no em dash in product text"


def test_P06_synthetic_accounts_carry_sintetico() -> None:
    assert "SINTÉTICO · dados fictícios" in text(render_pdf(GSYN))
    real = P06Data(**{**GSYN.__dict__, "synthetic": False})
    t = text(render_pdf(real))
    assert "SINTÉTICO" not in t and "dados fictícios" not in t


def test_P06_xlsx_has_the_close_and_differences() -> None:
    d = P06Data(
        **{
            **GSYN.__dict__,
            "store_lines": [
                (
                    "iFood",
                    "Loja",
                    {
                        "gross": 100,
                        "commission": -12,
                        "payment": 0,
                        "delivery": 0,
                        "promotion": 0,
                        "anticipation": 0,
                        "payout": 88,
                    },
                )
            ],
            "differences": [("DIF-01", "x", "iFood", "Loja", 1, 1200, "certa")],
        }
    )
    wb = load_workbook(io.BytesIO(render_xlsx(d)))
    assert wb.sheetnames == ["Fechamento", "Diferenças"]
    assert wb["Fechamento"]["A1"].value == "SINTÉTICO · dados fictícios"


@pytest.mark.skipif(not DB_TESTS, reason="MARGO_DB_TESTS=1 runs it against the local stack")
def test_P06_from_the_seeded_close() -> None:
    import psycopg
    from margo_common.files import MemoryFileStore
    from margo_render.close_job import LOCAL_DB_URL, render_and_store
    from psycopg.rows import dict_row

    with psycopg.connect(LOCAL_DB_URL, row_factory=dict_row) as conn:
        cp = conn.execute(
            "select cp.id from public.close_period cp join public.account a on a.id = cp.account_id"
            " where a.code = 'G-02' and cp.month = '2026-09-01'"
        ).fetchone()["id"]
        files = MemoryFileStore()
        pdf_path, xlsx_path = render_and_store(conn, files, str(cp))
        assert pdf_path == "closes/G-02/2026-09/fechamento-G-02-2026-09.pdf"
        t = text(files.get(pdf_path))
        assert "Você vendeu R$ 111.000 no delivery e recebeu R$ 83.300" in t
        assert "R$ 238 já voltou. R$ 718 contestados, resposta até 20/nov." in t
        assert "R$ 1.184" in t and "falta custo" in t
        conn.rollback()
