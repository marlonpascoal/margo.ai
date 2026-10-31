"""P06: monthly closing PDF (A4) and xlsx, from close_period, close_line and contestation (05 §C).

Without module 3 the cost section says "falta custo" (08 Wave 1). Synthetic accounts carry SINTÉTICO and
"dados fictícios" (D46, 05). Copy lives in templates/P06-fechamento.json, as drawn in
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

    @property
    def gross_cents(self) -> int:
        return sum(c.gross_cents for c in self.channels)

    @property
    def payout_cents(self) -> int:
        return sum(c.payout_cents for c in self.channels)


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
    pdf.set_creator("MargoAI worker-render P06")
    ink, muted, border, danger = (
        _rgb("color-ink"),
        _rgb("color-ink-muted"),
        _rgb("color-border"),
        _rgb("color-danger"),
    )
    width = 210 - 2 * 64 * PX
    left = 64 * PX

    # Header: brand left, month, account and labels right.
    pdf.set_y(64 * PX)
    pdf.set_text_color(*ink)
    pdf.set_font("Helvetica", "B", 20 * 0.75)
    pdf.cell(width / 3, 8, _t(str(COPY["brand"])))
    pdf.set_font("Courier", "", 12 * 0.75)
    pdf.set_text_color(*muted)
    head = str(COPY["header"]).format(mes=MONTHS[d.month.month - 1], ano=d.month.year, conta=d.account)
    labels = " · ".join([str(COPY["synthetic"]), str(COPY["fictitious"])]) if d.synthetic else ""
    pdf.set_xy(left + width / 3, 64 * PX)
    pdf.multi_cell(2 * width / 3, 4, _t(head + ("\n" + labels if labels else "")), align="R")
    y = max(pdf.get_y(), 64 * PX + 8) + 1
    pdf.set_draw_color(*ink)
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
    boxes = [
        (str(COPY["wrong_title"]), brl(d.wrong_cents), wrong_text),
        (str(COPY["cost_title"]), str(COPY["cost_missing"]), str(COPY["cost_missing_text"])),
    ]
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

    # Items section: needs cost (module 3).
    pdf.set_xy(left, y + box_h + 8)
    pdf.set_font("Helvetica", "B", 22 * 0.75)
    pdf.set_text_color(*ink)
    pdf.multi_cell(width, 8, _t(str(COPY["items_title"])))
    pdf.set_x(left)
    pdf.set_font("Courier", "", 15 * 0.75)
    pdf.set_text_color(*muted)
    pdf.cell(width, 8, _t(str(COPY["cost_missing"])), border="TB")

    # Footer: sources.
    pdf.set_xy(left, 297 - 48 * PX - 6)
    pdf.set_font("Courier", "", 11 * 0.75)
    pdf.set_text_color(*muted)
    pdf.cell(width, 5, _t(str(COPY["sources"]).format(fontes=", ".join(d.sources) or "-")))
    return bytes(pdf.output())


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
    ws2 = wb.create_sheet("Diferenças")
    ws2.append(["Regra", "O que aconteceu", "Canal", "Loja", "Pedidos", "Valor", "Confiança"])
    for rule, text, channel, store, n, cents, conf in d.differences:
        ws2.append([rule, text, channel, store, n, cents / 100, conf])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
