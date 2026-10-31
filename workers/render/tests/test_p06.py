"""P06: the closing PDF of G-SYN September without cost (05 §C, 08 Wave 1). Read back as text."""

from __future__ import annotations

import io
import os
from datetime import date
from decimal import Decimal

import pytest
from margo_render.p06 import ChannelRow, CostItem, CostSection, P06Data, render_pdf, render_xlsx
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


# Module 3 as drawn in design/P06-FechamentoPDF.dc.html (CST-01, CST-02, CTB-01, DLV-01).
COST = CostSection(
    invoice_count=16,
    top_count=20,
    prior_count=4,
    items=[
        CostItem("X-Bacon artesanal, 99Food", 3690, 1627),
        CostItem("X-Bacon artesanal, iFood", 3690, 1505),
        CostItem("Combo casal com cupom de 20%, iFood", 6392, 1582, attention=True),
        CostItem("Refrigerante lata, iFood", 500, 87, attention=True),
    ],
    decision_title="Uma decisão para outubro",
    decision_text="Com o cupom de 20%, o Combo casal deixa R$ 15,82 por pedido, quase a metade dos R$ 27,73 sem cupom. Vale renovar a campanha?",
    error_pct=Decimal("0.0927"),
)
DRAWN_M3 = (
    "Custo dos insumos 16 de 20 itens com preço de nota. Os outros 4 por estimativa da região.",
    "O que sobra por pedido, nos itens que mais vendem",
    "X-Bacon artesanal, 99Food 36,90 16,27",
    "X-Bacon artesanal, iFood 36,90 15,05",
    "Combo casal com cupom de 20%, iFood 63,92 15,82",
    "Refrigerante lata, iFood 5,00 0,87",
    "Uma decisão para outubro",
    "Com o cupom de 20%, o Combo casal deixa R$ 15,82 por pedido, quase a metade dos R$ 27,73 sem cupom. Vale renovar a campanha?",
    "Custo ± 9%.",
)


def test_D03_P06_with_contribution_shows_the_m3_section_and_one_decision() -> None:
    t = text(render_pdf(P06Data(**{**GSYN.__dict__, "cost": COST})))
    for s in DRAWN_M3:
        assert s in t, s
    assert "Fontes: arquivo do iFood, extrato da 99Food, notas de compra. Custo ± 9%." in t
    assert "Você vendeu R$ 111.000 no delivery e recebeu R$ 83.300" in t, "totals still equal C08"
    assert "falta custo" not in t
    assert "—" not in t, "no em dash in product text"
    wb = load_workbook(io.BytesIO(render_xlsx(P06Data(**{**GSYN.__dict__, "cost": COST}))))
    assert wb.sheetnames == ["Fechamento", "Sobra por pedido", "Diferenças"]
    assert [c.value for c in wb["Sobra por pedido"][2]] == ["X-Bacon artesanal, 99Food", 36.9, 16.27]


def test_P06_without_contribution_keeps_falta_custo() -> None:
    t = text(render_pdf(GSYN))
    assert "falta custo" in t and "Uma decisão" not in t and "99Food, notas de compra" not in t


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
def test_D03_P06_from_the_seeded_close_with_and_without_contribution() -> None:
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
        assert "R$ 1.184" in t
        for s in DRAWN_M3:
            assert s in t, s
        assert "falta custo" not in t
        # Without contribution the same close keeps "falta custo".
        conn.execute("delete from public.contribution where close_period_id = %s", (cp,))
        conn.execute("delete from public.close_decision where close_period_id = %s", (cp,))
        render_and_store(conn, files, str(cp))
        t = text(files.get(pdf_path))
        assert "falta custo" in t and "Uma decisão" not in t
        conn.rollback()


# C18: the BPO variant ------------------------------------------------------------------------------------

SVG_LOGO = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">'
    b'<rect width="120" height="40" fill="#1351B4"/></svg>'
)


def _colors_used(pdf: bytes) -> set[str]:
    """Stroke and fill RGB operators in the page content, as 'r g b'."""
    import re
    import zlib

    reader = PdfReader(io.BytesIO(pdf))
    raw = reader.pages[0].get_contents().get_data()  # type: ignore[union-attr]
    try:
        raw = zlib.decompress(raw)
    except zlib.error:
        pass
    return {m.group(1) for m in re.finditer(rb"([\d.]+ [\d.]+ [\d.]+) (?:RG|rg)", raw)}  # type: ignore[misc]


def test_C18_P06_with_brand_uses_only_the_bpo_name_and_color_and_footer_follows_toggle() -> None:
    from margo_render.bpo import with_brand
    from margo_render.p06 import Brand

    off = with_brand(GSYN, Brand(name="BPO 01", color="#1351B4", show_powered_by=False))
    t = text(render_pdf(off))
    assert "BPO 01" in t
    assert "MargoAI" not in t, "branded PDF shows only the BPO's brand"
    assert "Você vendeu R$ 111.000 no delivery e recebeu R$ 83.300" in t, "same numbers as C08"
    assert "SINTÉTICO" in t
    on = with_brand(GSYN, Brand(name="BPO 01", color="#1351B4", show_powered_by=True))
    t_on = text(render_pdf(on))
    assert "com tecnologia MargoAI" in t_on
    assert t_on.count("MargoAI") == 1, "only the footer names MargoAI"


def test_C18_P06_brand_color_and_logo_replace_margoai() -> None:
    from margo_render.bpo import with_brand
    from margo_render.p06 import Brand

    plain = render_pdf(GSYN)
    branded = render_pdf(
        with_brand(GSYN, Brand(name="BPO 01", color="#1351B4", logo=SVG_LOGO, show_powered_by=False))
    )
    blue = b"0.0745 0.3176 0.7059"
    assert blue in _colors_used(branded)
    assert blue not in _colors_used(plain)
    t = text(branded)
    assert "BPO 01" not in t, "with a logo the name is not repeated"
    assert "MargoAI" not in t
    assert "MargoAI" in text(plain), "without brand P06 is MargoAI's"


@pytest.mark.skipif(not DB_TESTS, reason="MARGO_DB_TESTS=1 runs it against the local stack")
def test_C18_render_close_bpo_refuses_an_account_that_is_not_a_client() -> None:
    import psycopg
    from margo_common.files import MemoryFileStore
    from margo_render.bpo import bpo_pdf_path, render_bpo_and_store
    from margo_render.close_job import LOCAL_DB_URL
    from psycopg.rows import dict_row

    with psycopg.connect(LOCAL_DB_URL, row_factory=dict_row) as conn:
        cp = conn.execute(
            "select cp.id from public.close_period cp join public.account a on a.id = cp.account_id"
            " where a.code = 'G-02' and cp.month = '2026-09-01' and cp.kitchen_id is null"
        ).fetchone()["id"]
        bpo01 = conn.execute("select id from public.bpo_partner where name = 'BPO 01'").fetchone()["id"]
        bpo02 = conn.execute("select id from public.bpo_partner where name = 'BPO 02'").fetchone()["id"]
        files = MemoryFileStore()
        path = render_bpo_and_store(conn, files, str(cp), str(bpo01))
        assert path == bpo_pdf_path(str(bpo01), "G-02", "2026-09")
        t = text(files.files[path])
        assert "BPO 01" in t and "MargoAI" not in t
        with pytest.raises(PermissionError):
            render_bpo_and_store(conn, files, str(cp), str(bpo02))
