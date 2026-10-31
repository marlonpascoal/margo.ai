"""P06: monthly closing PDF (A4) and xlsx from close_period, close_line, contribution, contestation (05 §C).

With module 3 (contribution of the close, worker-cost) the cost box counts the top insumos priced from notes
(CST-01) and by regional estimate (CST-02), the items section lists what is left per order (CTB-01) and
the month's decision (DLV-01); without it both say "falta custo" (08 Wave 1). Synthetic accounts carry
SINTÉTICO and "dados fictícios" (D46, 05). Copy lives in templates/P06-fechamento.json, as drawn in
design/P06-FechamentoPDF.dc.html; colors come from tokens.py.

PDF library: fpdf2 (pure Python, installs with uv), core fonts Helvetica and Courier (Latin-1 covers
Portuguese). Totals are the C08 totals (05 §C "Done when").
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from fpdf import FPDF
from openpyxl import Workbook

from .tokens import token

COPY: dict[str, object] = json.loads(
    (Path(__file__).parent / "templates" / "P06-fechamento.json").read_text()
)
MONTHS = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
]
MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
PX = 210 / 794  # the drawing is 794 px wide for A4


@dataclass(frozen=True)
class ChannelRow:
    name: str
    gross_cents: int
    payout_cents: int

    @property
    def took_cents(self) -> int:
        return self.gross_cents - self.payout_cents


@dataclass(frozen=True)
class Brand:
    """C18: a BPO partner's brand on its clients' P06 (flag bpo.marca_propria). See bpo.py."""

    name: str
    #: The partner's primary color, "#RRGGBB" as saved in C18 (data, not a design token).
    color: str | None = None
    logo: bytes | None = None
    show_powered_by: bool = True


@dataclass(frozen=True)
class CostItem:
    """One row of "O que sobra por pedido": label ("X-Bacon artesanal, 99Food"), price and left (CTB-01)."""

    label: str
    price_cents: int
    left_cents: int
    #: The decision row or the lowest one: drawn in the danger color.
    attention: bool = False


@dataclass(frozen=True)
class CostSection:
    """Module 3 part of P06, from the close's contribution (CST-01 to CST-04, CTB-01, DLV-01)."""

    invoice_count: int
    top_count: int
    prior_count: int
    items: list[CostItem]
    decision_title: str | None
    decision_text: str | None
    #: CST-04: the widest error bar of the rows ("Custo ± 9%").
    error_pct: Decimal


@dataclass(frozen=True)
class P06Data:
    account: str
    month: date
    synthetic: bool
    channels: list[ChannelRow]
    wrong_cents: int
    back_cents: int
    open_cents: int
    open_deadline: date | None
    sources: list[str] = field(default_factory=list)
    store_lines: list[tuple[str, str, dict[str, int]]] = field(default_factory=list)
    differences: list[tuple[str, str, str, int, int, str, str]] = field(default_factory=list)
    #: None: MargoAI's own P06. Set: the BPO variant, with only the partner's logo and color.
    brand: Brand | None = None
    #: None: no contribution yet, the cost parts say "falta custo".
    cost: CostSection | None = None

    @property
    def gross_cents(self) -> int:
        return sum(c.gross_cents for c in self.channels)

    @property
    def payout_cents(self) -> int:
        return sum(c.payout_cents for c in self.channels)


def money2(cents: int) -> str:
    """36,90: reais with centavos, as the items table is drawn (Latin-1 hyphen for a negative)."""
    r = abs(cents)
    return f"{'-' if cents < 0 else ''}{f'{r // 100:,}'.replace(',', '.')},{r % 100:02d}"


def reais(cents: int) -> str:
    """92.400: whole reais, half up, thousands with a dot (as drawn)."""
    r = int((Decimal(cents) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return f"{r:,}".replace(",", ".")


def brl(cents: int) -> str:
    return f"R$ {reais(cents)}"


def pct(num: int, den: int) -> str:
    if den == 0:
        return "0,0%"
    return f"{(Decimal(num) * 100 / Decimal(den)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}%".replace(
        ".", ","
    )


def _rgb(name: str) -> tuple[int, int, int]:
    h = token(name).lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _brand_header(
    pdf: FPDF, d: P06Data, x: float, y: float, w: float, ink: tuple[int, int, int]
) -> tuple[int, int, int]:
    """Header brand and accent color: MargoAI's wordmark in ink, or the BPO's logo (or name) and color."""
    if d.brand is None:
        pdf.set_text_color(*ink)
        pdf.set_font("Helvetica", "B", 20 * 0.75)
        pdf.cell(w, 8, _t(str(COPY["brand"])))
        return ink
    accent = _hex_rgb(d.brand.color) if d.brand.color else ink
    if d.brand.logo:
        pdf.image(io.BytesIO(d.brand.logo), x=x, y=y, h=8, keep_aspect_ratio=True)
    else:
        pdf.set_text_color(*accent)
        pdf.set_font("Helvetica", "B", 20 * 0.75)
        pdf.cell(w, 8, _t(d.brand.name))
    return accent


def _t(s: str) -> str:
    """Core fonts are Latin-1; product text never has an em dash (CLAUDE.md)."""
    assert "—" not in s
    return s


def render_pdf(d: P06Data) -> bytes:
    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(False)
    pdf.set_margins(64 * PX, 64 * PX, 64 * PX)
    pdf.add_page()
    pdf.set_title(f"Fechamento {MON[d.month.month - 1]}/{d.month.year} {d.account}")
    pdf.set_creator(d.brand.name if d.brand else "MargoAI worker-render P06")
    ink, muted, border, danger = (
        _rgb("color-ink"),
        _rgb("color-ink-muted"),
        _rgb("color-border"),
        _rgb("color-danger"),
    )
    width = 210 - 2 * 64 * PX
    left = 64 * PX

    # Header: brand left (MargoAI, or the BPO's logo and color), month, account and labels right.
    pdf.set_y(64 * PX)
    accent = _brand_header(pdf, d, left, 64 * PX, width / 3, ink)
    pdf.set_font("Courier", "", 12 * 0.75)
    pdf.set_text_color(*muted)
    head = str(COPY["header"]).format(mes=MONTHS[d.month.month - 1], ano=d.month.year, conta=d.account)
    labels = " · ".join([str(COPY["synthetic"]), str(COPY["fictitious"])]) if d.synthetic else ""
    pdf.set_xy(left + width / 3, 64 * PX)
    pdf.multi_cell(2 * width / 3, 4, _t(head + ("\n" + labels if labels else "")), align="R")
    y = max(pdf.get_y(), 64 * PX + 8) + 1
    pdf.set_draw_color(*accent)
    pdf.set_line_width(0.5)
    pdf.line(left, y, left + width, y)

    # Headline.
    pdf.set_xy(left, y + 6)
    pdf.set_text_color(*ink)
    pdf.set_font("Helvetica", "B", 36 * 0.75)
    pdf.multi_cell(
        width, 11, _t(str(COPY["headline"]).format(vendido=brl(d.gross_cents), recebido=brl(d.payout_cents)))
    )

    # Channel table.
    y = pdf.get_y() + 6
    cols = [str(c) for c in COPY["columns"]]  # type: ignore[union-attr]
    widths = [width * w for w in (0.32, 0.17, 0.17, 0.17, 0.17)]
    pdf.set_xy(left, y)
    pdf.set_font("Helvetica", "", 12 * 0.75)
    pdf.set_text_color(*muted)
    for i, (c, w) in enumerate(zip(cols, widths, strict=True)):
        pdf.cell(w, 7, _t(c.upper()), border="B", align="L" if i == 0 else "R")
    pdf.ln()
    pdf.set_draw_color(*border)
    pdf.set_line_width(0.2)
    for row in d.channels:
        cells = [
            row.name,
            reais(row.gross_cents),
            reais(row.took_cents),
            reais(row.payout_cents),
            pct(row.payout_cents, row.gross_cents),
        ]
        pdf.set_x(left)
        for i, (c, w) in enumerate(zip(cells, widths, strict=True)):
            pdf.set_font("Helvetica" if i == 0 else "Courier", "", 15 * 0.75)
            pdf.set_text_color(*(danger if i == 2 else ink))
            pdf.cell(w, 8, _t(c), border="B", align="L" if i == 0 else "R")
        pdf.ln()

    # Two boxes: what was charged wrong; the cost of ingredients (module 3).
    y = pdf.get_y() + 6
    box_w, box_h = (width - 12 * PX) / 2, 34
    wrong_text = (
        str(COPY["wrong_text"]).format(
            voltou=brl(d.back_cents),
            abertos=brl(d.open_cents),
            prazo=f"{d.open_deadline.day}/{MON[d.open_deadline.month - 1]}" if d.open_deadline else "",
        )
        if d.wrong_cents
        else str(COPY["wrong_text_none"])
    )
    if d.wrong_cents and not d.open_deadline:
        wrong_text = wrong_text.split(". ")[0] + "."
    if d.cost is None:
        cost_box = (str(COPY["cost_title"]), str(COPY["cost_missing"]), str(COPY["cost_missing_text"]))
    else:
        c = d.cost
        cost_text = str(COPY["cost_text"])
        if c.prior_count:
            cost_text += " " + str(COPY["cost_text_prior"]).format(n=c.prior_count)
        cost_box = (str(COPY["cost_title"]), f"{c.invoice_count} de {c.top_count}", cost_text)
    boxes = [(str(COPY["wrong_title"]), brl(d.wrong_cents), wrong_text), cost_box]
    for i, (title, big, text) in enumerate(boxes):
        x = left + i * (box_w + 12 * PX)
        pdf.set_draw_color(*border)
        pdf.rect(x, y, box_w, box_h)
        pdf.set_xy(x + 4, y + 4)
        pdf.set_font("Helvetica", "", 13 * 0.75)
        pdf.set_text_color(*muted)
        pdf.cell(box_w - 8, 5, _t(title))
        pdf.set_xy(x + 4, y + 10)
        pdf.set_font("Courier", "", 28 * 0.75)
        pdf.set_text_color(*ink)
        pdf.cell(box_w - 8, 9, _t(big))
        pdf.set_xy(x + 4, y + 20)
        pdf.set_font("Helvetica", "", 14 * 0.75)
        pdf.multi_cell(box_w - 8, 4.6, _t(text), align="L")

    # Items section: what is left per order (module 3), or "falta custo".
    pdf.set_xy(left, y + box_h + 8)
    pdf.set_font("Helvetica", "B", 22 * 0.75)
    pdf.set_text_color(*ink)
    pdf.multi_cell(width, 8, _t(str(COPY["items_title"])))
    if d.cost is None:
        pdf.set_x(left)
        pdf.set_font("Courier", "", 15 * 0.75)
        pdf.set_text_color(*muted)
        pdf.cell(width, 8, _t(str(COPY["cost_missing"])), border="TB")
    else:
        _items_table(pdf, d.cost, left, width, ink, muted, border, danger)
        if d.cost.decision_title and d.cost.decision_text:
            _decision_box(pdf, d.cost, left, width, ink)

    # Footer: sources.
    pdf.set_xy(left, 297 - 48 * PX - 6)
    pdf.set_font("Courier", "", 11 * 0.75)
    pdf.set_text_color(*muted)
    sources = list(d.sources) + ([str(COPY["sources_invoices"])] if d.cost else [])
    footer = str(COPY["sources"]).format(fontes=", ".join(sources) or "-")
    if d.cost:
        err = int((d.cost.error_pct * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        footer += " " + str(COPY["cost_error"]).format(pct=err)
    pdf.cell(width, 5, _t(footer))
    if d.brand and d.brand.show_powered_by:
        pdf.set_xy(left, 297 - 48 * PX - 6)
        pdf.cell(width, 5, _t(str(COPY["powered_by"])), align="R")
    return bytes(pdf.output())


RGB = tuple[int, int, int]


def _items_table(
    pdf: FPDF, c: CostSection, left: float, width: float, ink: RGB, muted: RGB, border: RGB, danger: RGB
) -> None:
    """CTB-01 per order for the items that sell most (rows from margo_cost.compute.p06_rows)."""
    widths = [width * 0.64, width * 0.18, width * 0.18]
    pdf.set_x(left)
    pdf.set_font("Helvetica", "", 12 * 0.75)
    pdf.set_text_color(*muted)
    pdf.set_draw_color(*ink)
    pdf.set_line_width(0.2)
    heads = [str(x) for x in COPY["items_columns"]]  # type: ignore[union-attr]
    for i, (h, w) in enumerate(zip(heads, widths, strict=True)):
        pdf.cell(w, 7, _t(h.upper()), border="B", align="L" if i == 0 else "R")
    pdf.ln()
    pdf.set_draw_color(*border)
    ok = _rgb("color-ok")
    for it in c.items:
        pdf.set_x(left)
        pdf.set_font("Helvetica", "", 15 * 0.75)
        pdf.set_text_color(*ink)
        pdf.cell(widths[0], 7.5, _t(it.label), border="B")
        pdf.set_font("Courier", "", 15 * 0.75)
        pdf.cell(widths[1], 7.5, _t(money2(it.price_cents)), border="B", align="R")
        pdf.set_text_color(*(danger if it.attention else ok))
        pdf.cell(widths[2], 7.5, _t(money2(it.left_cents)), border="B", align="R")
        pdf.ln()


def _decision_box(pdf: FPDF, c: CostSection, left: float, width: float, ink: tuple[int, int, int]) -> None:
    """DLV-01: "Uma decisão para <mês>" on the danger background, as drawn."""
    y = pdf.get_y() + 5
    pdf.set_font("Helvetica", "", 15 * 0.75)
    lines = pdf.multi_cell(width - 10, 5, _t(c.decision_text or ""), dry_run=True, output="LINES")
    h = 6 + 6 + 5 * len(lines) + 4
    pdf.set_fill_color(*_rgb("color-danger-bg"))
    pdf.rect(left, y, width, h, style="F")
    pdf.set_xy(left + 5, y + 4)
    pdf.set_text_color(*ink)
    pdf.set_font("Helvetica", "B", 17 * 0.75)
    pdf.cell(width - 10, 6, _t(c.decision_title or ""))
    pdf.set_xy(left + 5, y + 11)
    pdf.set_font("Helvetica", "", 15 * 0.75)
    pdf.multi_cell(width - 10, 5, _t(c.decision_text or ""))


def render_xlsx(d: P06Data) -> bytes:
    """The same close per store, and the differences, for whoever prefers a spreadsheet."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Fechamento"
    if d.synthetic:
        ws.append([f"{COPY['synthetic']} · {COPY['fictitious']}"])
    ws.append([f"Fechamento de {MONTHS[d.month.month - 1]}/{d.month.year}", d.account])
    ws.append(
        [
            "Canal",
            "Loja",
            "Venda bruta",
            "Comissão",
            "Pagamento",
            "Entrega",
            "Promoção",
            "Antecipação",
            "Repasse",
        ]
    )
    for channel, store, v in d.store_lines:
        ws.append(
            [
                channel,
                store,
                *(
                    v[k] / 100
                    for k in (
                        "gross",
                        "commission",
                        "payment",
                        "delivery",
                        "promotion",
                        "anticipation",
                        "payout",
                    )
                ),
            ]
        )
    if d.cost is not None:
        ws3 = wb.create_sheet("Sobra por pedido")
        ws3.append([str(c) for c in COPY["items_columns"]])  # type: ignore[union-attr]
        for it in d.cost.items:
            ws3.append([it.label, it.price_cents / 100, it.left_cents / 100])
    ws2 = wb.create_sheet("Diferenças")
    ws2.append(["Regra", "O que aconteceu", "Canal", "Loja", "Pedidos", "Valor", "Confiança"])
    for rule, text, channel, store, n, cents, conf in d.differences:
        ws2.append([rule, text, channel, store, n, cents / 100, conf])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
