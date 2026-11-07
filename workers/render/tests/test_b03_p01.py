"""B03: the P01 PDF renders A4 with the 3 items and the do-not-lower list (text extraction).

The report data are the drawn numbers of P01 and C05 (G-SYN). With MARGO_DB_TESTS=1 the same checks run on
the PDF rendered from the seeded rows of the local stack.
"""

from __future__ import annotations

import io
import os
import re
from datetime import date
from decimal import Decimal

import pytest
from margo_render.handlers import pdf_pages
from margo_render.P01_raio_x import (
    ReportItem,
    XrayReport,
    full_price_line_m1_05,
    money,
    pct,
    render_p01,
    report_items_m1_09,
)
from pypdf import PdfReader
from pypdf.generic import ContentStream


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


def promo(name, own, parity, gap, reading, loss, parity_full, gap_full, room=False):
    return ReportItem(
        name, own, parity, Decimal(str(gap)), reading, loss, False, parity_full, Decimal(str(gap_full)), room
    )


def test_B03_M1_05_page_two_shows_the_full_parity_only_when_it_differs():
    items = (
        promo("Alfa", 1000, 1300, -0.2308, "pode_subir", 300, 1500, -0.3333),
        promo("Delta", 1000, 1000, 0, "na_media", 0, 1000, 0),
        ReportItem("Antigo", 1000, 1000, Decimal(0), "na_media", 0),
    )
    _, (_, two) = pages(render_p01(report(items=items)))
    assert "Alfa R$ 10,00 R$ 13,00 −23% pode subir hoje sem promoção: R$ 15,00, −33%" in two
    assert two.count("sem promoção") == 1, "equal parity or a null one: nothing"


def test_B03_M1_07_page_two_carries_the_note_of_a_na_media_item_with_room_at_full_price():
    items = (promo("Bravo", 1000, 1050, -0.0476, "na_media", 50, 1300, -0.2308, room=True),)
    _, (_, two) = pages(render_p01(report(items=items)))
    assert (
        "Bravo R$ 10,00 R$ 10,50 −5% na faixa sem promoção: R$ 13,00, −23% · "
        "pode subir quando os vizinhos não estão em promoção"
    ) in two
    assert "—" not in two


def test_B03_M1_07_do_not_lower_list_never_says_a_cheaper_item_is_above_the_neighborhood():
    """M1-07: an item in the list only because of its full gap shows that gap, named as such."""
    items = (
        promo("Charlie", 1000, 1300, -0.2308, "nao_mexer", 300, 1300, 0.1538),
        promo("X-Bacon", 3690, 3150, 0.1714, "nao_mexer", -540, 3150, 0.1714),
        promo("Item 1", 500, 650, -0.2308, "pode_subir", 150, 650, -0.2308),
    )
    _, (one, _) = pages(render_p01(report(items=items)))
    assert "X-Bacon (+17%) e Charlie (+15% sem promoção) estão acima da vizinhança" in one
    assert "Charlie (−23%)" not in one


def test_M1_09_top_three_stay_on_the_loss_of_the_current_parity():
    items = [
        promo("Pouca perda, muito cheio", 1000, 1200, -0.1667, "pode_subir", 200, 9000, -0.8889),
        promo("A", 1000, 1500, -0.3333, "pode_subir", 500, 1500, -0.3333),
        promo("B", 1000, 1400, -0.2857, "pode_subir", 400, 1400, -0.2857),
        promo("C", 1000, 1300, -0.2308, "pode_subir", 300, 1300, -0.2308),
    ]
    up, _ = report_items_m1_09(items)
    assert [i.name for i in up] == ["A", "B", "C"]


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
                " where a.code = 'G-01' and x.id = '9aae2f75-4168-fde3-4570-d7bd0f4669d0'"
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
    assert len(r.pages) == 2 and pdf_pages(pdf) == 2
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


# B03: the list flows over as many pages as it needs -------------------------------------------------------

FOOTER = "Fonte: cardápios públicos no iFood. Paridade = mediana dos itens comparáveis em 3 km. Sem dado de custo."
BOTTOM_MARGIN = 48.0
PAGE_TOP = 841.89


def menu(n: int, notes: bool = False) -> tuple[ReportItem, ...]:
    """`n` analyzed rows named Prato 001, ...: three to raise and two to hold on page 1, the rest in the band."""

    def row(k: int) -> ReportItem:
        name = f"Prato {k:03d}"
        reading = "pode_subir" if k <= 3 else "nao_mexer" if k <= 5 else "na_media"
        own, parity = (1000, 1300) if k <= 3 else (1500, 1300) if k <= 5 else (1000, 1050)
        gap = Decimal(own - parity) / Decimal(parity)
        if not notes:
            return ReportItem(name, own, parity, gap, reading, parity - own)
        return ReportItem(name, own, parity, gap, reading, parity - own, False, 1400, Decimal("-0.2857"))

    return tuple(row(k) for k in range(1, n + 1))


def drawn_ys(page) -> list[float]:
    """The y of every text baseline and every line end on a page, from its content stream."""
    ys: list[float] = []

    def visit(text, _cm, tm, _font, _size):
        if text.strip():
            ys.append(float(tm[5]))

    page.extract_text(visitor_text=visit)
    ops = ContentStream(page.get_contents(), page.pdf).operations
    ys += [float(args[1]) for args, op in ops if op in (b"m", b"l")]
    return ys


def assert_flows(pdf: bytes, n: int) -> tuple[PdfReader, list[str]]:
    r, text = pages(pdf)
    for k in range(1, n + 1):
        name = f"Prato {k:03d}"
        assert sum(t.count(name) for t in text[1:]) == 1, f"{name} once in the list"
    for pg in r.pages:
        ys = drawn_ys(pg)
        assert min(ys) >= BOTTOM_MARGIN, "nothing below the bottom margin"
        assert max(ys) <= PAGE_TOP
    return r, text


@pytest.mark.parametrize(
    "n,notes,expected_pages",
    [(24, False, 2), (27, False, 2), (60, True, None), (200, False, None)],
    ids=["24_rows", "27_rows", "60_rows_with_secondary_lines", "200_rows"],
)
def test_B03_list_flows_with_every_item_once_and_nothing_below_the_margin(n, notes, expected_pages):
    r, text = assert_flows(render_p01(report(items=menu(n, notes))), n)
    if expected_pages:
        assert len(r.pages) == expected_pages
    else:
        assert len(r.pages) > 2
    assert sum(t.count("O raio-X completo") for t in text) == 1
    assert sum(t.count("itens somam 80% da perda por preço") for t in text) == 1
    assert "itens somam 80% da perda por preço" in text[-1]


def test_B03_every_list_page_repeats_header_table_head_and_footer():
    _, text = assert_flows(render_p01(report(items=menu(60, True))), 60)
    assert len(text) >= 4
    for t in text[1:]:
        assert "MargoAI" in t
        assert "Raio-X de preço · 28/out/2026 · dados fictícios" in t
        assert "SINTÉTICO" in t
        assert FOOTER in t
    for t in text[1:]:
        if "Prato" in t:
            assert "ITEM HOJE VIZINHANÇA DIFERENÇA LEITURA" in t


def test_B03_a_real_account_has_no_synthetic_label_on_any_page():
    _, text = pages(render_p01(report(items=menu(60, True), synthetic=False, seed=False)))
    assert len(text) > 2
    assert all("SINTÉTICO" not in t and "dados fictícios" not in t for t in text)
    assert all(FOOTER in t for t in text)


def test_B03_a_row_and_its_secondary_line_stay_on_the_same_page():
    _, text = assert_flows(render_p01(report(items=menu(60, True))), 60)
    for k in range(1, 61):
        assert re.search(rf"Prato {k:03d} R\$ [^·]*? sem promoção: R\$ 14,00, −29%", " ".join(text[1:]))
    for t in text[1:]:
        assert t.count("Prato") == t.count("sem promoção:"), "no row split from its line"


def test_B03_rows_keep_their_order_across_pages():
    _, text = pages(render_p01(report(items=menu(200))))
    names = re.findall(r"Prato \d{3}", " ".join(text[1:]))
    assert len(names) == 200
    assert names[:3] == ["Prato 001", "Prato 002", "Prato 003"]
    assert names[-2:] == ["Prato 004", "Prato 005"], "the items above parity close the list"


def test_B03_pareto_sentence_never_lands_on_the_footer_when_the_page_is_exactly_full():
    """Whatever the count, the closing block keeps its distance from the footer or moves to its own page."""
    for n in range(26, 34):
        r, text = assert_flows(render_p01(report(items=menu(n))), n)
        assert "itens somam 80% da perda por preço" in text[-1]
        assert FOOTER in text[-1]
        last_body = [y for y in drawn_ys(r.pages[-1]) if y > BOTTOM_MARGIN + 0.5]
        assert min(last_body) >= BOTTOM_MARGIN + 12, f"{n} rows: clear of the footer"


def test_B03_a_long_skipped_list_flows_too():
    skipped = tuple(ReportItem(f"Fora{k:04d}", 1000, None, None, None, None, True) for k in range(1, 1201))
    items = menu(10) + skipped
    r, text = pages(render_p01(report(items=items)))
    assert len(r.pages) > 2
    joined = " ".join(text[1:])
    for k in range(1, 1201):
        assert joined.count(f"Fora{k:04d}") == 1
    for pg in r.pages:
        assert min(drawn_ys(pg)) >= BOTTOM_MARGIN
    assert all("SINTÉTICO" in t and FOOTER in t for t in text)


def test_B03_pdf_page_count_is_what_the_file_has():
    assert pdf_pages(render_p01(report())) == 2
    pdf = render_p01(report(items=menu(60, True)))
    assert pdf_pages(pdf) == len(PdfReader(io.BytesIO(pdf)).pages) > 2


def test_B03_no_em_dash_on_any_page_of_a_long_list():
    _, text = pages(render_p01(report(items=menu(60, True))))
    assert all("—" not in t for t in text)


# C05 secondary line on page 2: the parity OR the gap differs from the current one ----------------------------


def test_B03_M1_05_page_two_explains_an_own_store_promotion():
    """Same parity, different gap: only the target is on promotion, so the row must say why it reads as it does."""
    items = (
        promo("Eco", 1000, 1300, -0.2308, "nao_mexer", 300, 1300, 0.1538),
        promo("Foxtrot", 1000, 1000, 0, "na_media", 0, 1000, 0),
    )
    _, text = pages(render_p01(report(items=items)))
    two = text[1]
    assert "Eco R$ 10,00 R$ 13,00 −23% precisa do custo sem promoção: R$ 13,00, +15%" in two
    assert two.count("sem promoção:") == 1, "same parity and same gap: nothing"


def test_B03_M1_05_a_run_from_before_dual_parity_still_shows_nothing():
    items = (ReportItem("Antigo", 1000, 1300, Decimal("-0.2308"), "pode_subir", 300),)
    _, text = pages(render_p01(report(items=items)))
    assert "sem promoção:" not in text[1]
    half = (ReportItem("Meio", 1000, 1300, Decimal("-0.2308"), "pode_subir", 300, False, None, Decimal("0.1")),)
    assert full_price_line_m1_05(half[0]) is None
