"""B03: the P01 PDF renders A4 with the 3 items and the do-not-lower list (text extraction).

The report data are the drawn numbers of P01 and C05 (G-SYN). With MARGO_DB_TESTS=1 the same checks run on
the PDF rendered from the seeded rows of the local stack.
"""

from __future__ import annotations

import io
import os
from datetime import date
from decimal import Decimal

import pytest
from margo_render.P01_raio_x import ReportItem, XrayReport, money, pct, render_p01, report_items_m1_09
from pypdf import PdfReader


def item(name, own, parity, reading, loss, skipped=False):
    gap = Decimal(own - parity) / Decimal(parity)
    return ReportItem(name, own, parity, gap, reading, loss, skipped)


DRAWN = (
    item("Refrigerante lata 350 ml", 500, 650, "pode_subir", 15450),
    item("Batata frita média", 1490, 1840, "pode_subir", 21700),
    item("Milkshake 400 ml", 1690, 1990, "pode_subir", 9900),
    item("Água 500 ml", 450, 520, "pode_subir", 5600),
    item("Smash duplo", 2990, 3050, "na_media", 1200),
    item("X-Bacon artesanal", 3690, 3150, "nao_mexer", -16200),
    item("Combo casal", 7990, 6990, "nao_mexer", -8000),
    ReportItem("Sundae", 1190, None, None, None, None, skipped=True),
)


def report(**kw) -> XrayReport:
    base = dict(
        store_name="Pantanos Burguer",
        on=date(2026, 10, 28),
        radius_km=3,
        stores_compared=84,
        items=DRAWN,
        pareto_count=6,
        synthetic=True,
        seed=True,
    )
    return XrayReport(**(base | kw))


def pages(pdf: bytes) -> tuple[PdfReader, list[str]]:
    r = PdfReader(io.BytesIO(pdf))
    return r, [" ".join(p.extract_text().split()) for p in r.pages]


def test_B03_p01_is_a4_with_two_pages():
    r, _ = pages(render_p01(report()))
    assert len(r.pages) == 2
    for p in r.pages:
        assert (round(float(p.mediabox.width), 1), round(float(p.mediabox.height), 1)) == (595.3, 841.9)


def test_B03_page_one_has_the_three_items_to_raise_as_drawn():
    _, (one, _) = pages(render_p01(report()))
    assert "Pantanos Burguer: três preços que você pode subir hoje" in one
    assert (
        "Comparamos os 8 itens do seu cardápio com os itens parecidos de 84 lojas num raio de 3 km, usando só o "
        "que está público no iFood."
    ) in one
    assert "Pode subir: abaixo do preço da vizinhança" in one
    assert "Refrigerante lata 350 ml R$ 5,00 R$ 6,50 −23%" in one
    assert "Batata frita média R$ 14,90 R$ 18,40 −19%" in one
    assert "Milkshake 400 ml R$ 16,90 R$ 19,90 −15%" in one
    assert "Água 500 ml" not in one, "only the top 3 by loss (M1-09)"
    assert one.index("Refrigerante lata") < one.index("Batata frita") < one.index("Milkshake"), (
        "most below first, as drawn"
    )
    assert "Subir um item barato aumenta o que sobra por unidade, seja qual for o seu custo." in one


def test_B03_page_one_has_the_do_not_lower_list():
    _, (one, _) = pages(render_p01(report()))
    assert "Não mexa sem saber o custo" in one
    assert (
        "X-Bacon artesanal (+17%) e Combo casal (+14%) estão acima da vizinhança. Baixar pode deixar o item no "
        "prejuízo. Só dá para saber com o seu custo e as taxas reais do seu iFood."
    ) in one
    assert "Quer saber o que dá lucro de verdade?" in one
    assert "Autorize a leitura do seu iFood em 2 minutos. Não pedimos senha. margoai.com/conectar" in one
    assert (
        "Fonte: cardápios públicos no iFood. Paridade = mediana dos itens comparáveis em 3 km. Sem dado de custo."
        in one
    )


def test_B03_header_dates_and_labels_synthetic_accounts():
    _, (one, two) = pages(render_p01(report()))
    assert "Raio-X de preço · 28/out/2026 · dados fictícios" in one
    assert "SINTÉTICO" in one and "SINTÉTICO" in two
    _, (real, _) = pages(render_p01(report(synthetic=False, seed=False)))
    assert "SINTÉTICO" not in real and "dados fictícios" not in real


def test_B03_page_two_has_the_full_table_pareto_and_skipped_items():
    _, (_, two) = pages(render_p01(report()))
    assert "O raio-X completo" in two
    assert "Smash duplo R$ 29,90 R$ 30,50 −2% na faixa" in two
    assert "X-Bacon artesanal R$ 36,90 R$ 31,50 +17% precisa do custo" in two
    assert "6 de 7 itens somam 80% da perda por preço" in two
    assert "Sundae" in two.split("80% da perda por preço")[1], "skipped item listed in the footnote (C04)"


def test_B03_no_em_dash_in_the_pdf():
    _, text = pages(render_p01(report()))
    assert all("—" not in t for t in text)


def test_M1_09_top_three_by_loss_and_every_item_above():
    up, hold = report_items_m1_09(list(DRAWN))
    assert [i.name for i in up] == ["Refrigerante lata 350 ml", "Batata frita média", "Milkshake 400 ml"]
    assert [i.name for i in hold] == ["X-Bacon artesanal", "Combo casal"]


def test_formats():
    assert (money(149000), money(500), money(5)) == ("R$ 1.490,00", "R$ 5,00", "R$ 0,05")
    assert (pct(Decimal("-0.2308")), pct(Decimal("0.1714")), pct(Decimal("0.31"), signed=False)) == (
        "−23%",
        "+17%",
        "31%",
    )


@pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")
def test_B03_p01_from_the_seeded_xray():
    import psycopg
    from margo_render.handlers import render_and_store
    from psycopg.rows import dict_row

    class Memory:
        def __init__(self):
            self.files = {}

        def put(self, path, body):
            self.files[path] = body

    db = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    with psycopg.connect(db, autocommit=True, row_factory=dict_row) as conn:
        xid = str(
            conn.execute(
                "select x.id from public.xray x join public.account a on a.id = x.account_id"
                " where a.code = 'G-01'"
            ).fetchone()["id"]
        )
        before = conn.execute("select pdf_path from public.xray where id = %s", (xid,)).fetchone()["pdf_path"]
        store = Memory()
        try:
            render_and_store(conn, store, xid)
        finally:
            conn.execute("update public.xray set pdf_path = %s where id = %s", (before, xid))
    ((path, pdf),) = store.files.items()
    assert path == f"raio-x/G-01/{xid}.pdf"
    r, (one, two) = pages(pdf)
    assert len(r.pages) == 2
    assert "Pantanos Burguer: três preços que você pode subir hoje" in one
    assert "84 lojas comparadas 7 itens abaixo da vizinhança 5 itens acima da vizinhança" in one
    for row in (
        "Refrigerante lata 350 ml R$ 5,00 R$ 6,50 −23%",
        "Batata frita média R$ 14,90 R$ 18,40 −19%",
        "Milkshake 400 ml R$ 16,90 R$ 19,90 −15%",
    ):
        assert row in one
    assert "X-Bacon artesanal (+17%), Combo casal (+14%)" in one
    assert "estão acima da vizinhança" in one
    assert "6 de 24 itens somam 80% da perda por preço" in two
    assert "SINTÉTICO" in one
