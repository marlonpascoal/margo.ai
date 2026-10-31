"""P01 Raio-X em PDF (design/P01-RaioXPDF.dc.html, 05 §C): A4, 2 pages, from the stored X-ray rows.

Page 1 is the drawing: "três preços que você pode subir hoje" (M1-09: the top 3 `pode_subir` items by loss)
and the "Não mexa sem saber o custo" list (every `nao_mexer` item). Page 2 is the full table of C05 with the
Pareto sentence, the items skipped in C04 and the source footnote. Synthetic accounts carry SINTÉTICO (D46).

Library: reportlab (pure Python wheels, nothing to install on the system). Its bundled Bitstream Vera
font covers Portuguese and the minus sign; the design's Public Sans and IBM Plex Mono are not shipped as
TTF files in the repo, so the PDF uses Vera until they are. Colors come from tokens.py (02 §9).
No em dashes anywhere (D22).
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from fractions import Fraction
from typing import Literal

import reportlab
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

from .tokens import TOKENS

Reading = Literal["pode_subir", "na_media", "nao_mexer"]
READING_LABEL: dict[str, str] = {
    "pode_subir": "pode subir hoje",
    "na_media": "na faixa",
    "nao_mexer": "precisa do custo",
}
"""C05 "Leitura", as drawn."""
MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
COUNT_WORDS = {1: "um preço", 2: "dois preços", 3: "três preços"}
CONNECT_URL = "margoai.com/conectar"


@dataclass(frozen=True)
class ReportItem:
    name: str
    own_cents: int
    parity_cents: int | None
    gap: Fraction | Decimal | None
    reading: Reading | None
    loss_cents: int | None
    skipped: bool = False


@dataclass(frozen=True)
class XrayReport:
    store_name: str
    on: date
    """The collection date, shown as 28/out/2026."""
    radius_km: int
    stores_compared: int
    items: tuple[ReportItem, ...]
    pareto_count: int
    synthetic: bool
    seed: bool = True
    """Rendering the seed: the header says "dados fictícios" as drawn (05 intro)."""
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def analyzed(self) -> list[ReportItem]:
        return [i for i in self.items if not i.skipped and i.parity_cents is not None]


# M1-09 -------------------------------------------------------------------------------------------


def _gap(i: ReportItem) -> Fraction:
    return Fraction(i.gap) if i.gap is not None else Fraction(0)


def report_items_m1_09(items: list[ReportItem]) -> tuple[list[ReportItem], list[ReportItem]]:
    """M1-09: the top 3 `pode_subir` items by loss (shown most below the neighborhood first) and every
    `nao_mexer` item (most above first), for the "do not lower without cost" message."""
    up = sorted(
        (i for i in items if i.reading == "pode_subir"), key=lambda i: (-(i.loss_cents or 0), i.name)
    )[:3]
    hold = sorted((i for i in items if i.reading == "nao_mexer"), key=lambda i: (-_gap(i), i.name))
    return sorted(up, key=lambda i: (_gap(i), i.name)), hold


# Formats ----------------------------------------------------------------------------------------


def money(cents: int) -> str:
    """'R$ 14,90', 'R$ 1.234,56'."""
    neg = cents < 0
    whole, frac = divmod(abs(cents), 100)
    s = f"{whole:,}".replace(",", ".")
    return f"{'-' if neg else ''}R$ {s},{frac:02d}"


def pct(x: Fraction | Decimal, signed: bool = True) -> str:
    """'−23%' (U+2212 as drawn), '+17%', '31%'."""
    f = Fraction(x) * 100
    n = int(abs(f) + Fraction(1, 2)) * (1 if f >= 0 else -1)
    if not signed:
        return f"{n}%"
    return f"+{n}%" if n > 0 else (f"−{-n}%" if n < 0 else "0%")


def join_pt(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} e {parts[-1]}"


def day_label(d: date) -> str:
    return f"{d.day}/{MONTHS[d.month - 1]}/{d.year}"


# Drawing ----------------------------------------------------------------------------------------

_FONTS = False


def _fonts() -> None:
    global _FONTS
    if _FONTS:
        return
    base = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    pdfmetrics.registerFont(TTFont("Vera", os.path.join(base, "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("Vera-Bold", os.path.join(base, "VeraBd.ttf")))
    _FONTS = True


def c(token: str) -> HexColor:
    return HexColor(TOKENS[f"color-{token}"])


W, H = A4
M = 48.0  # margin, as the drawing's 64 px at 794 px wide


class _Page:
    def __init__(self, cv: Canvas) -> None:
        self.cv = cv
        self.y = H - M

    def text(
        self, x: float, s: str, size: float, *, bold: bool = False, color: str = "ink", right: bool = False
    ) -> None:
        self.cv.setFont("Vera-Bold" if bold else "Vera", size)
        self.cv.setFillColor(c(color))
        (self.cv.drawRightString if right else self.cv.drawString)(x, self.y, s)

    def wrap(
        self, s: str, size: float, width: float, *, bold: bool = False, color: str = "ink", lead: float = 1.45
    ) -> None:
        font = "Vera-Bold" if bold else "Vera"
        words, line = s.split(), ""
        lines = []
        for w in words:
            trial = f"{line} {w}".strip()
            if pdfmetrics.stringWidth(trial, font, size) > width and line:
                lines.append(line)
                line = w
            else:
                line = trial
        if line:
            lines.append(line)
        for ln in lines:
            self.text(M, ln, size, bold=bold, color=color)
            self.y -= size * lead

    def rule(self, color: str = "border", width: float = 0.75) -> None:
        self.cv.setStrokeColor(c(color))
        self.cv.setLineWidth(width)
        self.cv.line(M, self.y, W - M, self.y)


def _header(p: _Page, r: XrayReport) -> None:
    p.text(M, "MargoAI", 15, bold=True)
    right = f"Raio-X de preço · {day_label(r.on)}" + (" · dados fictícios" if r.seed else "")
    p.text(W - M, right, 8.5, color="ink-muted", right=True)
    if r.synthetic:
        p.cv.setStrokeColor(c("ink-faint"))
        p.cv.setDash(2, 2)
        sw = pdfmetrics.stringWidth("SINTÉTICO", "Vera-Bold", 8) + 10
        p.cv.rect(W - M - sw, p.y + 14, sw, 14, stroke=1, fill=0)
        p.cv.setDash()
        p.cv.setFont("Vera-Bold", 8)
        p.cv.setFillColor(c("ink-muted"))
        p.cv.drawRightString(W - M - 5, p.y + 18.5, "SINTÉTICO")
    p.y -= 9
    p.rule("ink", 1.5)
    p.y -= 30


def _footer(p: _Page, r: XrayReport) -> None:
    p.y = M
    p.text(
        M,
        f"Fonte: cardápios públicos no iFood. Paridade = mediana dos itens comparáveis em {r.radius_km} km. "
        "Sem dado de custo.",
        7.5,
        color="ink-muted",
    )


def _table(
    p: _Page, cols: list[tuple[str, float, bool]], rows: list[list[tuple[str, str]]], size: float = 11
) -> None:
    """cols: (title, right edge or left x, right-aligned). Each cell is (text, color token)."""
    for title, x, right in cols:
        p.text(x, title.upper(), 7.5, color="ink-muted", right=right)
    p.y -= 6
    p.rule("ink", 0.75)
    for row in rows:
        p.y -= size + 7
        for (txt, color), (_, x, right) in zip(row, cols, strict=True):
            p.text(x, txt, size, color=color, right=right)
        p.y -= 7
        p.rule()


def render_p01(r: XrayReport) -> bytes:
    """The P01 PDF as bytes."""
    _fonts()
    buf = io.BytesIO()
    cv = Canvas(buf, pagesize=A4, pageCompression=1)
    cv.setTitle(f"{r.store_name}: raio-X de preço")
    cv.setAuthor("MargoAI")
    analyzed = r.analyzed
    up, hold = report_items_m1_09(analyzed)
    below = sum(1 for i in analyzed if i.reading == "pode_subir")
    above = sum(1 for i in analyzed if i.reading == "nao_mexer")

    # Page 1, as drawn.
    p = _Page(cv)
    _header(p, r)
    title = (
        f"{r.store_name}: {COUNT_WORDS[len(up)]} que você pode subir hoje"
        if up
        else f"{r.store_name}: raio-X de preço"
    )
    p.wrap(title, 25, W - 2 * M, bold=True, lead=1.15)
    p.y -= 4
    p.wrap(
        f"Comparamos os {len(r.items)} itens do seu cardápio com os itens parecidos de {r.stores_compared} lojas num "
        f"raio de {r.radius_km} km, usando só o que está público no iFood.",
        11,
        W - 2 * M,
        color="ink-2",
    )
    p.y -= 12
    box_w = (W - 2 * M - 16) / 3
    top = p.y
    for k, (value, label, color) in enumerate(
        [
            (r.stores_compared, "lojas comparadas", "ink"),
            (below, "itens abaixo da vizinhança", "ok"),
            (above, "itens acima da vizinhança", "danger"),
        ]
    ):
        x = M + k * (box_w + 8)
        cv.setStrokeColor(c("border"))
        cv.setLineWidth(0.75)
        cv.rect(x, top - 56, box_w, 60, stroke=1, fill=0)
        cv.setFont("Vera", 22)
        cv.setFillColor(c(color))
        cv.drawString(x + 10, top - 26, str(value))
        cv.setFont("Vera", 8.5)
        cv.setFillColor(c("ink-muted"))
        cv.drawString(x + 10, top - 44, label)
    p.y = top - 88

    p.text(M, "Pode subir: abaixo do preço da vizinhança", 16, bold=True)
    p.y -= 22
    cols = [
        ("Item", M, False),
        ("Hoje", W - M - 190, True),
        ("Vizinhança", W - M - 90, True),
        ("Diferença", W - M, True),
    ]
    _table(
        p,
        cols,
        [
            [
                (i.name, "ink"),
                (money(i.own_cents), "ink"),
                (money(i.parity_cents or 0), "ink"),
                (pct(_gap(i)), "ok"),
            ]
            for i in up
        ],
    )
    p.y -= 18
    p.wrap(
        "Subir um item barato aumenta o que sobra por unidade, seja qual for o seu custo.",
        10,
        W - 2 * M,
        color="ink-2",
    )
    p.y -= 14

    if hold:
        p.text(M, "Não mexa sem saber o custo", 16, bold=True)
        p.y -= 20
        names = join_pt([f"{i.name} ({pct(_gap(i))})" for i in hold])
        verb = "está acima" if len(hold) == 1 else "estão acima"
        p.wrap(
            f"{names} {verb} da vizinhança. Baixar pode deixar o item no prejuízo. Só dá para saber com o seu "
            "custo e as taxas reais do seu iFood.",
            11,
            W - 2 * M,
        )

    # Call to action at the bottom, as drawn.
    box_h = 62
    cv.setFillColor(c("ok-bg"))
    cv.rect(M, M + 26, W - 2 * M, box_h, stroke=0, fill=1)
    p.y = M + 26 + box_h - 22
    p.text(M + 14, "Quer saber o que dá lucro de verdade?", 12.5, bold=True)
    p.y -= 20
    lead = "Autorize a leitura do seu iFood em 2 minutos. Não pedimos senha. "
    p.text(M + 14, lead, 10)
    p.cv.setFont("Vera-Bold", 10)
    p.cv.drawString(M + 14 + pdfmetrics.stringWidth(lead, "Vera", 10), p.y, CONNECT_URL)
    _footer(p, r)
    cv.showPage()

    # Page 2: the full X-ray (C05), the Pareto sentence and what was left out.
    p = _Page(cv)
    _header(p, r)
    p.text(M, "O raio-X completo", 16, bold=True)
    p.y -= 22
    order = {"pode_subir": 0, "na_media": 1, "nao_mexer": 2}
    rows = sorted(analyzed, key=lambda i: (order[i.reading or "na_media"], -abs(_gap(i)), i.name))
    tone = {"pode_subir": "ok", "na_media": "ink-muted", "nao_mexer": "danger"}
    cols = [
        ("Item", M, False),
        ("Hoje", W - M - 250, True),
        ("Vizinhança", W - M - 170, True),
        ("Diferença", W - M - 100, True),
        ("Leitura", W - M - 90, False),
    ]
    _table(
        p,
        cols,
        [
            [
                (i.name, "ink"),
                (money(i.own_cents), "ink"),
                (money(i.parity_cents or 0), "ink"),
                (pct(_gap(i)), tone[i.reading or "na_media"]),
                (READING_LABEL[i.reading or "na_media"], tone[i.reading or "na_media"]),
            ]
            for i in rows
        ],
        size=8.5,
    )
    p.y -= 20
    p.text(M, f"{r.pareto_count} de {len(analyzed)} itens somam 80% da perda por preço", 11, bold=True)
    p.y -= 16
    skipped = [i.name for i in r.items if i.skipped]
    if skipped:
        p.wrap(f"Fora da conta, sem pares confiáveis: {join_pt(skipped)}.", 9, W - 2 * M, color="ink-muted")
    _footer(p, r)
    cv.showPage()
    cv.save()
    return buf.getvalue()
