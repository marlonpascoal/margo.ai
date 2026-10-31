#!/usr/bin/env python3
"""Writes supabase/seed/g_syn_m3.sql: G-SYN module 3, cost and contribution of Grupo Exemplo (G-02). SINTÉTICO.

The canonical rows (ingredient catalog, purchase invoices with their lines and matches, regional priors,
dishes, recipes, campaign dishes, the dishes of each September order) are written here by hand to reproduce
the M3 numbers drawn in C10, C11, C12, C13, P06 and W01. The derived rows (ingredient prices of confirmed
lines, recipe and line costs, contribution, insumos per store, the month's decision) come from
worker-cost's own functions (margo_cost.compute), and the script stops if a drawn number does not come out.

    uv run python scripts/gen_g_syn_m3.py           write the file
    uv run python scripts/gen_g_syn_m3.py --check   exit 1 if the file is not what the script writes

Choices where the drawings disagree (questions for Marlon):
  - C10 lists cheddar and pão brioche as "falta nota" while C12 prices them from notes of 30/set and 05/out
    and C11 shows newer cheddar and pão lines as AI suggestions. The seed follows C11 and C12: the older lines
    are confirmed (by rule), the newer ones wait for a founder. The four top-20 insumos without a note (CST-02)
    are bacon, embalagem kraft, copo 400 ml and balde de papel; C10's "16 de 20" and P06's "16 de 20" hold.
  - C12 draws "Embalagem kraft" as a line of the ficha with an estimativa regional: packaging that belongs to
    the dish is a recipe line (catalog category embalagens); packaging_cost stays for a channel's own extra.
  - C13 and P06 are Pantanos Burguer in the drawings; the close they belong to is Grupo Exemplo's (G-02), as
    in the M2 seed. C13 rows follow the C12 order (top-20 list), so Smash duplo and Milkshake sit between the
    drawn rows.
  - The iFood coupon (M2 campaign "Cupom 20% cofinanciado", per store) is linked to Combo casal only
    (campaign_item); the 99Food store promotion is store wide and not split per dish.
  - Dishes of each order (order_item_fact) are listed at menu price; their sum stays within the order's
    items value (the rest is modifiers), except an order below the cheapest dish, which gets that dish.
  - "duplicadas: 9" of C10 is a count of the zip import (intake lane); the 312 invoices are the distinct ones.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import sys
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from margo_cost.compute import (
    CampaignIn,
    CloseInputs,
    MenuItem,
    RecipeIn,
    RecipeLineIn,
    SoldLine,
    StoreIn,
    compute_close,
    ingredient_coverage,
)
from margo_cost.rules import CostParams, PricePoint

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "supabase" / "seed" / "g_syn_m3.sql"
M2_SEED = ROOT / "supabase" / "seed" / "g_syn_m2.sql"
AS_OF = date(2026, 10, 30)  # "hoje" in the drawings
PARAMS = CostParams(
    window_days=90,
    yield_error={"medido": Decimal("0.02"), "declarado": Decimal("0.05"), "estimado": Decimal("0.10")},
    prior_error=Decimal("0.30"),
)
D = Decimal


def sid(tag: str) -> str:
    """Same ids as pg_temp.sid() in g_syn.sql: md5('g-syn:' || tag)::uuid."""
    return str(uuid.UUID(hashlib.md5(f"g-syn:{tag}".encode()).hexdigest()))


ACCOUNT = sid("G-02")
COMPANIES = [sid("G-02:cnpj1"), sid("G-02:cnpj2")]
MARLON, MANUEL = sid("p:marlon"), sid("p:manuel")
CLOSE = sid("G-02:close:2026-09")


def q(v: object) -> str:
    """SQL literal."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | Decimal):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


# Catalog (global, D14) ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Ing:
    key: str
    name: str
    category: str
    base_unit: str
    gtin: tuple[str, ...] = ()


INGREDIENTS = [
    Ing("blend", "Carne bovina moída (blend)", "carnes", "g"),
    Ing("cheddar", "Queijo cheddar fatiado", "laticínios", "g"),
    Ing("bacon", "Bacon em cubos", "carnes", "g"),
    Ing("pao", "Pão brioche", "padaria", "un"),
    Ing("maionese", "Maionese (base de molho)", "molhos", "g"),
    Ing("kraft", "Embalagem kraft", "embalagens", "un"),
    Ing("batata", "Batata congelada palito", "congelados", "g"),
    Ing("refri", "Refrigerante lata 350 ml", "bebidas", "un", ("7890000003501",)),
    Ing("oleo", "Óleo de soja", "óleos", "ml"),
    Ing("sal", "Sal refinado", "temperos", "g"),
    Ing("cebola", "Cebola", "hortifrúti", "g"),
    Ing("sorvete", "Sorvete de creme", "sobremesas", "g"),
    Ing("leite", "Leite integral", "laticínios", "ml"),
    Ing("calda", "Calda de chocolate", "sobremesas", "g"),
    Ing("copo", "Copo 400 ml com tampa", "embalagens", "un"),
    Ing("coxa", "Coxa e sobrecoxa de frango", "aves", "g"),
    Ing("farinha", "Farinha de trigo", "farináceos", "g"),
    Ing("file", "Filé de peito de frango", "aves", "g"),
    Ing("barbecue", "Molho barbecue", "molhos", "g"),
    Ing("balde", "Balde de papel", "embalagens", "un"),
    # Bought and matched, not in a ready recipe.
    Ing("alface", "Alface americana", "hortifrúti", "g"),
    Ing("tomate", "Tomate", "hortifrúti", "g"),
    Ing("ketchup", "Ketchup", "molhos", "g"),
    Ing("acucar", "Açúcar refinado", "temperos", "g"),
]
ING = {i.key: i for i in INGREDIENTS}

# CST-02 regional priors (centavos per base unit), observed 01/out.
PRIORS = {"bacon": D("4.60"), "kraft": D("90"), "copo": D("65"), "balde": D("150"), "cheddar": D("5.50"),
          "blend": D("4.10")}
PRIOR_ON = date(2026, 10, 1)

# Suppliers (synthetic CNPJs with wrong check digits, so never a real company) ---------------------------


def _dv(digits: str, weights: list[int]) -> int:
    r = sum(int(d) * w for d, w in zip(digits, weights, strict=True)) % 11
    return 0 if r < 2 else 11 - r


def fake_cnpj(n: int) -> str:
    """14 digits whose check digits are wrong on purpose (secret_scan flags valid ones)."""
    base = f"9{n:07d}0001"
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    d1 = _dv(base, w1)
    d2 = _dv(base + str(d1), [6] + w1)
    return base + str((d1 + 1) % 10) + str(d2)


NFE_SUPPLIERS = {
    "frigo": "Frigorífico Exemplo",
    "lat": "Laticínios Exemplo",
    "pad": "Padaria Exemplo",
    "cong": "Congelados Exemplo",
    "aves": "Avícola Exemplo",
    "moinho": "Moinho Exemplo",
    "molhos": "Molhos Exemplo",
    "horti": "Hortifrúti Exemplo",
    "atac": "Atacado Exemplo",
    "beb": "Bebidas Exemplo",
    "sorv": "Sorvetes Exemplo",
    "novo": "Atacado Exemplo Sul",  # new supplier from August: its lines wait for AI confirmation (C11)
    "limp": "Limpeza Exemplo",
    "gas": "Gás Exemplo",
}
for i in range(1, 18):
    NFE_SUPPLIERS[f"f{i:02d}"] = f"Fornecedor Exemplo {i:02d}"
NFCE_SUPPLIERS = {f"m{i:02d}": f"Mercado Exemplo {i:02d}" for i in range(1, 11)}
SUPPLIER_CNPJ = {k: fake_cnpj(i + 1) for i, k in enumerate([*NFE_SUPPLIERS, *NFCE_SUPPLIERS])}
SUPPLIER_NAME = {**NFE_SUPPLIERS, **NFCE_SUPPLIERS}


def access_key(cnpj: str, model: int, issued: date, number: int) -> str:
    """06 §5 layout: cUF, AAMM, CNPJ, modelo, série, número, tpEmis, código, DV (mod 11)."""
    body = f"35{issued:%y%m}{cnpj}{model:02d}001{number:09d}1{(number * 7919) % 10**8:08d}"
    assert len(body) == 43
    s, w = 0, 2
    for ch in reversed(body):
        s += int(ch) * w
        w = 2 if w == 9 else w + 1
    r = s % 11
    return body + str(0 if r < 2 else 11 - r)


# Invoice lines -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Product:
    """How a supplier writes an ingredient on its invoices."""

    desc: str
    unit: str
    factor: Decimal  # base units per invoice unit
    ncm: str | None
    gtin: str | None
    method: str  # gtin | rule
    rule_note: str | None


PRODUCTS: dict[str, tuple[str, Product]] = {
    # ingredient: (supplier, product)
    "blend": ("frigo", Product("CARNE BOV MOIDA PATINHO/ACEM 80/20 KG", "KG", D(1000), "02013000", None, "rule", "texto + NCM 0201")),
    "bacon": ("frigo", Product("BACON CUBOS KG", "KG", D(1000), "02101900", None, "rule", "texto + NCM 0210")),
    "cheddar": ("lat", Product("QUEIJO CHEDDAR FATIADO KG", "KG", D(1000), "04069000", None, "rule", "texto + NCM 0406")),
    "leite": ("lat", Product("LEITE INTEGRAL UHT 1L", "UN", D(1000), "04012010", None, "rule", "texto + unidade")),
    "pao": ("pad", Product("PAO BRIOCHE HAMBURGUER UN", "UN", D(1), "19059090", None, "rule", "texto + unidade")),
    "batata": ("cong", Product("BAT PRE FRITA CONG 2,5KG PALITO 9MM", "PC", D(2500), "20041000", None, "rule", "texto + unidade")),
    "sorvete": ("sorv", Product("SORVETE MASSA CREME 5KG", "UN", D(5000), "21050010", None, "rule", "texto + unidade")),
    "calda": ("sorv", Product("COBERTURA CHOCOLATE 1,3KG", "UN", D(1300), "18069000", None, "rule", "texto + unidade")),
    "coxa": ("aves", Product("COXA E SOBRECOXA CONG KG", "KG", D(1000), "02071400", None, "rule", "texto + NCM 0207")),
    "file": ("aves", Product("FILE PEITO FRANGO CONG KG", "KG", D(1000), "02071400", None, "rule", "texto + NCM 0207")),
    "farinha": ("moinho", Product("FARINHA TRIGO TIPO 1 5KG", "UN", D(5000), "11010010", None, "rule", "texto + unidade")),
    "maionese": ("molhos", Product("MAIONESE BALDE 3KG", "UN", D(3000), "21039011", None, "rule", "texto + unidade")),
    "barbecue": ("molhos", Product("MOLHO BARBECUE 1,01KG", "UN", D(1010), "21039029", None, "rule", "texto + unidade")),
    "ketchup": ("molhos", Product("KETCHUP GALAO 3,2KG", "UN", D(3200), "21032010", None, "rule", "texto + unidade")),
    "cebola": ("horti", Product("CEBOLA KG", "KG", D(1000), "07031019", None, "rule", "texto + unidade")),
    "alface": ("horti", Product("ALFACE AMERICANA UN 300G", "UN", D(300), "07051100", None, "rule", "texto + unidade")),
    "tomate": ("horti", Product("TOMATE KG", "KG", D(1000), "07020000", None, "rule", "texto + unidade")),
    "oleo": ("atac", Product("OLEO SOJA 900ML", "UN", D(900), "15079011", None, "rule", "texto + unidade")),
    "sal": ("atac", Product("SAL REFINADO 1KG", "UN", D(1000), "25010020", None, "rule", "texto + unidade")),
    "acucar": ("atac", Product("ACUCAR REFINADO 1KG", "UN", D(1000), "17019900", None, "rule", "texto + unidade")),
    "refri": ("beb", Product("REFRIG COCA COLA LT 350ML", "UN", D(1), "22021000", "7890000003501", "gtin", None)),
}

# The price CST-01 must find on 30/out (unit price in centavos, invoice date), as drawn where drawn.
ANCHORS: dict[str, tuple[int, date, Decimal]] = {
    "blend": (3890, date(2026, 10, 12), D(40)),  # C10, C11, C12: R$ 38,90/kg, nota de 12/out
    "batata": (3550, date(2026, 10, 8), D(12)),  # C10, C11: R$ 14,20/kg, nota de 08/out
    "oleo": (756, date(2026, 9, 21), D(20)),  # C10: R$ 8,40/l, nota de 21/set
    "cheddar": (5210, date(2026, 9, 30), D(6)),  # C12: R$ 1,46 for 28 g, nota de 30/set
    "pao": (115, date(2026, 10, 5), D(300)),  # C12: R$ 1,15, nota de 05/out
    "maionese": (3390, date(2026, 9, 18), D(4)),  # C12: R$ 0,23 for 20 g, nota de 18/set
    "sal": (400, date(2026, 10, 1), D(10)),
    "cebola": (590, date(2026, 10, 20), D(15)),
    "sorvete": (7450, date(2026, 10, 15), D(4)),
    "leite": (549, date(2026, 10, 22), D(36)),
    "calda": (2990, date(2026, 10, 10), D(3)),
    "coxa": (1290, date(2026, 10, 19), D(60)),
    "farinha": (2450, date(2026, 10, 2), D(6)),
    "file": (1890, date(2026, 10, 19), D(25)),
    "barbecue": (1590, date(2026, 9, 28), D(6)),
    "ketchup": (2890, date(2026, 10, 6), D(3)),
    "alface": (450, date(2026, 10, 20), D(20)),
    "tomate": (790, date(2026, 10, 20), D(12)),
    "acucar": (520, date(2026, 9, 25), D(10)),
    # Last bacon note in June: outside the 90 days, so CST-02 (C12 "estimativa regional").
    "bacon": (4200, date(2026, 6, 15), D(8)),
}
REFRI_NFCE = (285, date(2026, 10, 3), D(24))  # C10, C11: R$ 2,85/un, cupom de 03/out (NFC-e)

# AI suggestions waiting for a founder (C11), from the new supplier: (desc, unit, factor, ingredient, price, conf).
SUGGESTED = [
    ("QJO PROC CHED FAT 2,27KG 160FT", "PC", D(2270), "cheddar", 11827, D("0.91")),  # R$ 52,10/kg
    ("MAION TEMP CASA 3KG BALDE", "UN", D(3000), "maionese", 3390, D("0.88")),  # R$ 11,30/kg
    ("PAO HAMB BRIOCHE GERG C/12", "PCT", D(12), "pao", 1380, D("0.84")),  # R$ 1,15/un
    ("CARNE MOIDA ESPECIAL RESFR KG", "KG", D(1000), "blend", 3790, D("0.76")),
    ("BATATA PALITO CONG 2KG", "PC", D(2000), "batata", 2690, D("0.81")),
    ("OLEO DE SOJA PET 900ML", "UN", D(900), "oleo", 729, D("0.93")),
    ("FAR TRIGO ESP 5KG", "UN", D(5000), "farinha", 2390, D("0.86")),
    ("SOBRECOXA FGO CONG KG", "KG", D(1000), "coxa", 1250, D("0.79")),
]
# Lines with no catalog match (C11 "sem par"); some carry an AI suggestion a founder rejected.
UNMATCHED = [
    ("limp", "DETERGENTE NEUTRO 5L", "UN", 1890, None),
    ("limp", "DESENGORDURANTE 5L", "UN", 3290, None),
    ("limp", "SACO LIXO 100L C/100", "PCT", 5490, None),
    ("limp", "PAPEL TOALHA INTERFOLHA C/1000", "PCT", 2190, "kraft"),
    ("limp", "ALCOOL 70 5L", "UN", 3990, None),
    ("limp", "LUVA NITRILICA CX100", "CX", 3490, None),
    ("gas", "GAS GLP P45", "UN", 42900, None),
    ("f01", "UNIFORME AVENTAL", "UN", 4990, None),
    ("f02", "MANUTENCAO CHAPA", "SV", 35000, None),
    ("f03", "GUARDANAPO PAPEL C/50", "PCT", 390, "kraft"),
    ("f04", "PALITO DENTE C/2000", "CX", 690, None),
    ("f05", "FILME PVC 28CM", "RL", 2990, None),
]
UNMATCHED_SUPPLIERS = ["limp", "gas", *(f"f{i:02d}" for i in range(1, 18))]


@dataclass
class Line:
    desc: str
    unit: str
    qty: Decimal
    unit_price: int
    ncm: str | None = None
    gtin: str | None = None
    ingredient: str | None = None
    factor: Decimal | None = None
    method: str | None = None
    rule_note: str | None = None
    status: str | None = None  # confirmed | suggested | rejected
    confidence: Decimal | None = None

    @property
    def total(self) -> int:
        return int((self.qty * self.unit_price).quantize(D(1)))


@dataclass
class Invoice:
    supplier: str
    model: int
    issued: date
    lines: list[Line]
    source: str = "xml_zip"

    @property
    def total(self) -> int:
        return sum(ln.total for ln in self.lines)


MONTHS = [date(2025, 11, 1) + timedelta(days=31 * i) for i in range(12)]
MONTHS = [date(m.year, m.month, 1) for m in MONTHS]


def confirmed_line(ing: str, unit_price: int, qty: Decimal) -> Line:
    _, p = PRODUCTS[ing]
    return Line(p.desc, p.unit, qty, unit_price, p.ncm, p.gtin, ing, p.factor, p.method, p.rule_note, "confirmed")


def build_invoices() -> list[Invoice]:
    rng = random.Random(20261030)
    invoices: list[Invoice] = []
    # Anchors first: the price CST-01 finds for each ingredient.
    for ing, (price, day, qty) in ANCHORS.items():
        sup, _ = PRODUCTS[ing]
        invoices.append(Invoice(sup, 55, day, [confirmed_line(ing, price, qty)]))
    invoices.append(Invoice("m01", 65, REFRI_NFCE[1], [confirmed_line("refri", REFRI_NFCE[0], REFRI_NFCE[2])]))

    by_supplier: dict[str, list[str]] = defaultdict(list)
    for ing, (sup, _) in PRODUCTS.items():
        by_supplier[sup].append(ing)

    def older_line(ing: str, day: date) -> Line | None:
        """A confirmed purchase before the anchor date, at a slightly lower price."""
        anchor_price, anchor_day, anchor_qty = (
            ANCHORS[ing] if ing in ANCHORS else (REFRI_NFCE[0], REFRI_NFCE[1], REFRI_NFCE[2])
        )
        if day >= anchor_day:
            return None
        months_before = (anchor_day - day).days / 30
        price = int(anchor_price * (1 - D("0.006") * D(str(round(months_before, 2)))) + rng.randint(-3, 3))
        return confirmed_line(ing, max(price, 1), anchor_qty)

    def rand_day(month: date) -> date:
        nxt = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
        return month + timedelta(days=rng.randrange((nxt - month).days))

    # Routine NF-e purchases: 268 in all, NFC-e 44 in all (C10).
    nfe_target, nfce_target = 268, 44
    food_suppliers = ["frigo", "lat", "pad", "cong", "aves", "moinho", "molhos", "horti", "atac", "beb", "sorv"]
    month_cycle = 0
    while sum(1 for i in invoices if i.model == 55) < nfe_target - 40:
        month = MONTHS[month_cycle % 12]
        month_cycle += 1
        sup = food_suppliers[month_cycle % len(food_suppliers)]
        day = rand_day(month)
        lines = [ln for ing in by_supplier[sup] if (ln := older_line(ing, day)) is not None]
        if not lines:
            continue
        invoices.append(Invoice(sup, 55, day, lines))
    # The new supplier (August to October): every line waits for AI confirmation.
    for n in range(14):
        day = date(2026, 8, 3) + timedelta(days=6 * n)
        if day > date(2026, 10, 28):
            day = date(2026, 10, 28) - timedelta(days=n)
        picks = [SUGGESTED[n % len(SUGGESTED)], SUGGESTED[(n + 3) % len(SUGGESTED)]]
        if n >= 12:
            picks = SUGGESTED[:3]  # the three C11 rows, on the latest notes
        lines = [Line(d_, u, D(rng.randint(2, 6)), pr, None, None, ing, f, "ai", None, "suggested", c)
                 for d_, u, f, ing, pr, c in picks]
        invoices.append(Invoice("novo", 55, day, lines))
    # Non-food suppliers (no match, C11 "sem par"), up to 268 NF-e.
    k = 0
    while sum(1 for i in invoices if i.model == 55) < nfe_target:
        _, desc, unit, price, rejected = UNMATCHED[k % len(UNMATCHED)]
        sup = UNMATCHED_SUPPLIERS[k % len(UNMATCHED_SUPPLIERS)]
        day = rand_day(MONTHS[k % 12])
        ln = Line(desc, unit, D(rng.randint(1, 3)), price)
        if rejected:
            ln.ingredient, ln.method, ln.status, ln.confidence = rejected, "ai", "rejected", D("0.41")
        invoices.append(Invoice(sup, 55, day, [ln]))
        k += 1
    # NFC-e: market receipts; refrigerante before 03/out, cleaning items without match.
    m = 0
    while sum(1 for i in invoices if i.model == 65) < nfce_target:
        day = rand_day(MONTHS[m % 12])
        sup = f"m{(m % 10) + 1:02d}"
        lines = []
        if (ln := older_line("refri", day)) is not None and m % 2 == 0:
            ln.qty = D(rng.choice([6, 12]))
            lines.append(ln)
        lines.append(Line("DETERGENTE LIQ 500ML", "UN", D(rng.randint(2, 6)), 279))
        invoices.append(Invoice(sup, 65, day, lines))
        m += 1
    return invoices


def balance_spend(invoices: list[Invoice]) -> None:
    """C11: 72% of the spend matched by barcode or rule, 15% suggested by AI, 13% without a match."""
    def spend(status_ok: str) -> int:
        tot = 0
        for inv in invoices:
            for ln in inv.lines:
                kind = "auto" if ln.status == "confirmed" else "ai" if ln.status == "suggested" else "none"
                if kind == status_ok:
                    tot += ln.total
        return tot

    auto = spend("auto")
    for kind, share in (("ai", 15), ("none", 13)):
        target = auto * share // 72
        have = spend(kind)
        # Scale quantities of that bucket's lines up to the target, then fix the rest on one line.
        lines = [ln for inv in invoices for ln in inv.lines
                 if ("ai" if ln.status == "suggested" else "none" if ln.status != "confirmed" else "auto") == kind]
        factor = D(target) / D(have)
        for ln in lines:
            ln.qty = max(D(1), (ln.qty * factor).quantize(D(1)))
        gap = target - sum(ln.total for ln in lines)
        last = max(lines, key=lambda ln: ln.unit_price)
        last.qty += D(gap // last.unit_price) if gap > 0 else -D((-gap) // last.unit_price)
    shares = {k: spend(k) for k in ("auto", "ai", "none")}
    total = sum(shares.values())
    got = {k: round(100 * v / total) for k, v in shares.items()}
    assert got == {"auto": 72, "ai": 15, "none": 13}, got


# Menu, recipes, campaigns (G-02) ---------------------------------------------------------------------

BURGER, FRANGO, MILK = sid("G-02:burger"), sid("G-02:frango"), sid("G-02:milk")


@dataclass(frozen=True)
class Dish:
    key: str
    name: str
    brand: str
    rank: int
    price: int | None  # menu price, both channels
    channels: tuple[str, ...]
    recipe: tuple[tuple[str, str, str, str], ...] = ()  # ingredient, qty, yield, confidence


DISHES = [
    Dish("xbacon", "X-Bacon artesanal", BURGER, 1, 3690, ("ifood", "food99"), (
        ("blend", "160", "0.85", "declarado"), ("cheddar", "28", "1", "medido"), ("bacon", "30", "1", "medido"),
        ("pao", "1", "1", "medido"), ("maionese", "20", "1", "medido"), ("kraft", "1", "1", "medido"))),
    Dish("smash", "Smash duplo", BURGER, 2, 3290, ("ifood", "food99"), (
        ("blend", "180", "0.85", "declarado"), ("cheddar", "28", "1", "medido"), ("pao", "1", "1", "medido"),
        ("cebola", "20", "1", "medido"), ("maionese", "15", "1", "medido"), ("kraft", "1", "1", "medido"))),
    Dish("batata", "Batata frita média", BURGER, 3, 1490, ("ifood",), (
        ("batata", "200", "1", "medido"), ("oleo", "30", "1", "medido"), ("sal", "2", "1", "medido"))),
    Dish("combo", "Combo casal", BURGER, 4, 7990, ("ifood",), (
        ("blend", "320", "0.85", "declarado"), ("cheddar", "56", "1", "medido"), ("bacon", "60", "1", "medido"),
        ("pao", "2", "1", "medido"), ("maionese", "40", "1", "medido"), ("kraft", "2", "1", "medido"),
        ("batata", "450", "1", "medido"), ("oleo", "60", "1", "medido"), ("sal", "8", "1", "medido"))),
    Dish("milk", "Milkshake 400 ml", BURGER, 5, 1990, ("ifood", "food99"), (
        ("sorvete", "200", "1", "medido"), ("leite", "150", "1", "medido"), ("calda", "30", "1", "medido"),
        ("copo", "1", "1", "medido"))),
    Dish("cheddarb", "Cheddar burger", BURGER, 6, None, ()),
    Dish("onion", "Onion rings", BURGER, 7, None, ()),
    Dish("refri", "Refrigerante lata", BURGER, 8, 500, ("ifood",), (("refri", "1", "1", "medido"),)),
    Dish("balde", "Balde de frango", FRANGO, 9, 5990, ("ifood",), (
        ("coxa", "1000", "0.80", "declarado"), ("farinha", "150", "1", "medido"), ("oleo", "200", "1", "medido"),
        ("balde", "1", "1", "medido"))),
    Dish("tiras", "Tiras de frango crocante", FRANGO, 10, 2990, ("ifood",), (
        ("file", "300", "0.90", "declarado"), ("farinha", "80", "1", "medido"), ("oleo", "100", "1", "medido"),
        ("barbecue", "40", "1", "medido"), ("kraft", "1", "1", "medido"))),
    # Milkshake Bar (Quiosque Shopping, not in analysis yet): on the list, fichas a fazer.
    *[Dish(f"mb{i}", n, MILK, 10 + i, None, ()) for i, n in enumerate([
        "Milkshake de morango 500 ml", "Milkshake de Ovomaltine 500 ml", "Milkshake de Nutella 500 ml",
        "Açaí 500 ml", "Açaí 300 ml", "Sundae de chocolate", "Casquinha mista", "Banana split",
        "Petit gâteau com sorvete", "Brownie com sorvete"], start=1)],
]
DISH = {d.key: d for d in DISHES}
CHANNEL_PREFIX = {"ifood": "IF", "food99": "99"}


def channel_ids(d: Dish) -> dict[str, str]:
    return {ch: f"{CHANNEL_PREFIX[ch]}-{d.key.upper()}" for ch in d.channels}


# Stores of the September close (g_syn.sql, g_syn_m2.sql).
STORES = {
    "s1": ("ifood", BURGER), "s2": ("ifood", FRANGO), "s3": ("food99", BURGER),
    "s4": ("ifood", BURGER), "s5": ("food99", BURGER),
}
COUPON_STORES = ("s1", "s4")  # Burger do Bairro on iFood: the coupon applies to Combo casal (C13)


# M2 inputs (read from the committed M2 seed, which worker-import wrote) -------------------------------

ORDER_RX = re.compile(r"^\('(s\d)', '([^']+)', '([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), '([cx])'")
CLOSE_RX = re.compile(r"^\s*\('(s\d)', (\d+), (-?\d+), (-?\d+), (-?\d+), (-?\d+), (-?\d+), (\d+)\)")


@dataclass(frozen=True)
class Order:
    store: str
    ext: str
    day: date
    items: int
    d_store: int


def m2_inputs() -> tuple[list[Order], dict[str, tuple[int, int]], dict[str, tuple[date, date, Decimal, str]]]:
    text = M2_SEED.read_text()
    orders = []
    for line in text.splitlines():
        m = ORDER_RX.match(line)
        if m and m.group(9) == "c" and m.group(3).startswith("2026-09"):
            orders.append(Order(m.group(1), m.group(2), date.fromisoformat(m.group(3)[:10]), int(m.group(5)),
                                int(m.group(7))))
    block = text.split("insert into public.close_line", 1)[1].split(";", 1)[0]
    per_channel: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for line in block.splitlines():
        m = CLOSE_RX.match(line)
        if m:
            ch = STORES[m.group(1)][0]
            per_channel[ch][0] += int(m.group(2))
            per_channel[ch][1] += int(m.group(8))
    assert per_channel["ifood"] == [9_240_000, 6_882_900] and per_channel["food99"] == [1_860_000, 1_447_100]
    campaigns = {
        s: (date(2026, 9, 1), date(2026, 9, 20), D("0.20"), "Cupom 20% cofinanciado") for s in COUPON_STORES
    }
    assert "('s1', 'Cupom 20% cofinanciado', 0.20, 0.50, '2026-09-01', '2026-09-20')" in text
    return orders, {k: (v[0], v[1]) for k, v in per_channel.items()}, campaigns


# Dishes of each order (order_item_fact): main dishes while they fit in the order's items value, then at
# most one side; the rest of the value is modifiers. An order below the cheapest dish gets that dish.
MAINS = {
    ("ifood", BURGER): [("xbacon", 65), ("smash", 25)],
    ("food99", BURGER): [("xbacon", 65), ("smash", 35)],
    ("ifood", FRANGO): [("balde", 40), ("tiras", 60)],
}
SIDES = {
    ("ifood", BURGER): [("batata", 45), ("refri", 40), ("milk", 15)],
    ("food99", BURGER): [("milk", 1)],
    ("ifood", FRANGO): [],
}


def order_items(orders: list[Order], campaigns: dict[str, tuple[date, date, Decimal, str]]) -> list[tuple[Order, list[str]]]:
    price = {d.key: d.price or 0 for d in DISHES}
    out = []
    for o in orders:
        channel, brand = STORES[o.store]
        rng = random.Random(f"{o.store}:{o.ext}")
        remaining, picks = o.items, []
        if channel == "ifood" and brand == BURGER and remaining >= price["combo"] and rng.random() < 0.5:
            picks.append("combo")
            remaining -= price["combo"]
        mains = MAINS[(channel, brand)]
        while fits := [(k, w) for k, w in mains if price[k] <= remaining]:
            k = rng.choices([k for k, _ in fits], weights=[w for _, w in fits])[0]
            picks.append(k)
            remaining -= price[k]
        if sides := [(k, w) for k, w in SIDES[(channel, brand)] if price[k] <= remaining]:
            picks.append(rng.choices([k for k, _ in sides], weights=[w for _, w in sides])[0])
        if not picks:
            picks.append(min([k for k, _ in mains + SIDES[(channel, brand)]], key=lambda k: price[k]))
        out.append((o, picks))
    return out


# Assemble and check ---------------------------------------------------------------------------------


def line_price(ln: Line) -> Decimal:
    assert ln.factor is not None
    return D(ln.unit_price) / ln.factor


def build() -> dict[str, object]:
    invoices = build_invoices()
    balance_spend(invoices)
    invoices.sort(key=lambda i: (i.issued, i.supplier, i.model))
    assert sum(1 for i in invoices if i.model == 55) == 268 and sum(1 for i in invoices if i.model == 65) == 44
    assert len({i.supplier for i in invoices}) == 41, len({i.supplier for i in invoices})
    assert len({(i.issued.year, i.issued.month) for i in invoices}) == 12

    prices: dict[str, list[PricePoint]] = defaultdict(list)
    for n, inv in enumerate(invoices):
        for j, ln in enumerate(inv.lines, 1):
            if ln.status == "confirmed":
                assert ln.ingredient
                prices[ln.ingredient].append(PricePoint(line_price(ln), inv.issued, "invoice", f"il:{n}:{j}"))
    for k, p in PRIORS.items():
        prices[k].append(PricePoint(p, PRIOR_ON, "regional_prior", None))

    orders, channel_close, campaigns = m2_inputs()
    sold_orders = order_items(orders, campaigns)
    items = [MenuItem(sid(f"G-02:dish:{d.key}"), d.name, d.brand, d.rank, channel_ids(d)) for d in DISHES]
    recipes = [
        RecipeIn(sid(f"G-02:recipe:{d.key}"), sid(f"G-02:dish:{d.key}"), [
            RecipeLineIn(sid(f"G-02:recipe:{d.key}:{i}"), ing, D(qty), D(y), conf)  # type: ignore[arg-type]
            for i, (ing, qty, y, conf) in enumerate(d.recipe, 1)
        ])
        for d in DISHES if d.recipe
    ]
    sold = [
        SoldLine(o.store, o.day, o.d_store > 0, DISH[k].name, channel_ids(DISH[k])[STORES[o.store][0]], 1,
                 DISH[k].price)  # type: ignore[arg-type]
        for o, picks in sold_orders for k in picks
    ]
    inputs = CloseInputs(
        month=date(2026, 9, 1),
        as_of=AS_OF,
        stores=[StoreIn(s, ch, b) for s, (ch, b) in STORES.items()],
        items=items,
        recipes=recipes,
        prices=prices,
        packaging={},
        campaigns=[CampaignIn(sid(f"G-02:camp:{s}"), s, name, pct, a, b, frozenset({sid("G-02:dish:combo")}))
                   for s, (a, b, pct, name) in campaigns.items()],
        sold=sold,
        channel_close=channel_close,
    )
    result = compute_close(inputs, PARAMS)
    check(result, items, recipes, prices)
    return {"invoices": invoices, "sold_orders": sold_orders, "result": result, "items": items,
            "recipes": recipes, "prices": prices}


def check(result, items, recipes, prices) -> None:  # type: ignore[no-untyped-def]
    """Every drawn M3 number (C12, C13, P06, W01) from worker-cost's functions."""
    name = {i.id: i.name for i in items}
    rc = {r.menu_item_id: r for r in result.recipes}
    xb = rc[sid("G-02:dish:xbacon")]
    assert xb.cost_cents == 1244 and round(xb.error_pct * 100) == 9, (xb.cost_cents, xb.error_pct)  # C12
    drawn_lines = [732, 146, 138, 115, 23, 90]  # C12 line costs in centavos
    assert [int(ln.cost.quantize(D(1), rounding="ROUND_HALF_UP")) for ln in xb.lines] == drawn_lines
    assert [ln.price.source for ln in xb.lines] == ["invoice", "invoice", "regional_prior", "invoice", "invoice",
                                                     "regional_prior"]
    assert [ln.price.observed_on for ln in xb.lines if ln.price.source == "invoice"] == [
        date(2026, 10, 12), date(2026, 9, 30), date(2026, 10, 5), date(2026, 9, 18)]
    rows = {(name[r.menu_item_id], r.channel, r.campaign_name): r for r in result.rows}
    drawn = {  # C13: price, channel take, insumos, left, % of price
        ("X-Bacon artesanal", "ifood", None): (3690, 941, 1244, 1505, 41),
        ("X-Bacon artesanal", "food99", None): (3690, 819, 1244, 1627, 44),
        ("Combo casal", "ifood", None): (7990, 2037, 3180, 2773, 35),
        ("Combo casal", "ifood", "Cupom 20% cofinanciado"): (6392, 1630, 3180, 1582, 25),
        ("Batata frita média", "ifood", None): (1490, 380, 310, 800, 54),
        ("Refrigerante lata", "ifood", None): (500, 128, 285, 87, 17),
    }
    for key, (p, t, i, left, pc) in drawn.items():
        r = rows[key]
        got = (r.price_cents, r.channel_take_cents, r.ingredient_cents + r.packaging_cents, r.left_cents,
               round(r.left_pct * 100))
        assert got == (p, t, i, left, pc), (key, got)
    assert not any(r.can_invert for r in result.rows)  # C13 "não inverte nenhuma linha"
    assert round(max(r.ingredient_error_pct for r in result.rows) * 100) == 9  # C13, P06 "± 9%"
    d = result.decision
    assert d and d.kind == "campaign" and name[d.menu_item_id] == "Combo casal"  # DLV-01
    assert (d.left_cents, d.base_left_cents) == (1582, 2773)
    units = Counter()
    for r in result.rows:
        units[r.menu_item_id] += r.units
    assert units.most_common(1)[0][0] == sid("G-02:dish:xbacon")  # P06: the best seller is X-Bacon
    lowest = min((r for r in result.rows if r.campaign_name is None and r.left_cents > 0), key=lambda r: r.left_cents)
    assert name[lowest.menu_item_id] == "Refrigerante lata"  # P06 last row
    line_ing = {ln.id: ln.ingredient_id for r in recipes for ln in r.lines}
    assert ingredient_coverage(result.recipes, line_ing, units, 20) == (16, 4, 0)  # P06, C10 "16 de 20"
    assert all(sc.uncovered_units == 0 for sc in result.store_costs)  # W01: every dish sold has a ficha


# SQL ------------------------------------------------------------------------------------------------


def emit(b: dict[str, object]) -> str:
    invoices: list[Invoice] = b["invoices"]  # type: ignore[assignment]
    sold_orders = b["sold_orders"]
    result = b["result"]
    out: list[str] = []
    w = out.append
    w("-- G-SYN, module 3: cost and contribution of Grupo Exemplo (G-02), September 2026 close. SINTÉTICO.")
    w("-- GENERATED by scripts/gen_g_syn_m3.py: do not edit by hand. Derived rows (prices of confirmed lines,")
    w("-- recipe costs, contribution, insumos per store, the decision) are margo_cost.compute on the rows above")
    w("-- them, as of 30/out/2026. See the script's docstring for the choices where drawings disagree.")
    w("")
    w("create or replace function pg_temp.sid(tag text) returns uuid language sql immutable as $$ select md5('g-syn:' || tag)::uuid $$;")
    w("")
    w("-- Global catalog (D14).")
    w("insert into public.ingredient (id, name, category, base_unit, gtin) values")
    w(",\n".join(f"  (pg_temp.sid('ing:{i.key}'), {q(i.name)}, {q(i.category)}, '{i.base_unit}', "
                 f"'{{{','.join(i.gtin)}}}')" for i in INGREDIENTS) + ";")
    w("")
    w("-- C10: 312 invoices (NF-e 268, NFC-e 44), 41 suppliers, 12 months. Issuer CNPJs are synthetic, with")
    w("-- wrong check digits; access keys pass app.nfe_access_key_valid.")
    w("insert into public.invoice (id, account_id, company_id, access_key, model, issuer_cnpj, issuer_name, issued_at, total_cents, source, xml_path) values")
    vals = []
    for n, inv in enumerate(invoices):
        cnpj = SUPPLIER_CNPJ[inv.supplier]
        key = access_key(cnpj, inv.model, inv.issued, n + 1)
        company = COMPANIES[n % 2]
        xml = None  # no XML file is stored for the synthetic invoices (the export and deletion jobs count files)
        vals.append(f"  (pg_temp.sid('inv:{n}'), pg_temp.sid('G-02'), {q(company)}, '{key}', {inv.model}, '{cnpj}', "
                    f"{q(SUPPLIER_NAME[inv.supplier])}, '{inv.issued.isoformat()} 10:00-03', {inv.total}, "
                    f"'{inv.source}', {q(xml)})")
    w(",\n".join(vals) + ";")
    w("")
    w("insert into public.invoice_line (id, account_id, invoice_id, line_no, description, ncm, gtin, unit, qty, unit_price_cents, total_cents) values")
    vals = []
    for n, inv in enumerate(invoices):
        for j, ln in enumerate(inv.lines, 1):
            vals.append(f"  (pg_temp.sid('il:{n}:{j}'), pg_temp.sid('G-02'), pg_temp.sid('inv:{n}'), {j}, {q(ln.desc)}, "
                        f"{q(ln.ncm)}, {q(ln.gtin)}, {q(ln.unit)}, {ln.qty}, {ln.unit_price}, {ln.total})")
    w(",\n".join(vals) + ";")
    w("")
    w("-- C11: de-para. Barcode and rule matches confirmed; the new supplier's lines suggested by AI (they do")
    w("-- not count, D14); some cleaning lines carry an AI suggestion a founder rejected.")
    w("insert into public.ingredient_match (id, account_id, invoice_line_id, ingredient_id, method, status, confidence, confirmed_by, conversion_factor, rule_note) values")
    vals = []
    for n, inv in enumerate(invoices):
        for j, ln in enumerate(inv.lines, 1):
            if ln.status is None:
                continue
            by = "pg_temp.sid('p:marlon')" if ln.status in ("confirmed", "rejected") else "null"
            factor = ln.factor if ln.status == "confirmed" else (ln.factor if ln.factor else None)
            vals.append(f"  (pg_temp.sid('im:{n}:{j}'), pg_temp.sid('G-02'), pg_temp.sid('il:{n}:{j}'), "
                        f"pg_temp.sid('ing:{ln.ingredient}'), '{ln.method}', '{ln.status}', {q(ln.confidence)}, {by}, "
                        f"{q(factor)}, {q(ln.rule_note)})")
    w(",\n".join(vals) + ";")
    w("")
    w("-- CST-01: one price per confirmed line (centavos per base unit); CST-02: regional priors, 01/out.")
    w("insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source, invoice_line_id) values")
    vals = []
    for n, inv in enumerate(invoices):
        for j, ln in enumerate(inv.lines, 1):
            if ln.status == "confirmed":
                vals.append(f"  (pg_temp.sid('G-02'), pg_temp.sid('ing:{ln.ingredient}'), {line_price(ln).normalize():f}, "
                            f"'{inv.issued.isoformat()}', 'invoice', pg_temp.sid('il:{n}:{j}'))")
    for k, p in PRIORS.items():
        vals.append(f"  (pg_temp.sid('G-02'), pg_temp.sid('ing:{k}'), {p}, '{PRIOR_ON.isoformat()}', 'regional_prior', null)")
    w(",\n".join(vals) + ";")
    w("")
    w("-- Dishes: the top-20 list of the onboarding (D15), C12 order. Milkshake Bar is not in analysis yet.")
    w("insert into public.menu_item (id, account_id, brand_id, name, channel_item_ids, is_top20, top20_rank) values")
    w(",\n".join(
        f"  (pg_temp.sid('G-02:dish:{d.key}'), pg_temp.sid('G-02'), {q(d.brand)}, {q(d.name)}, "
        f"{q(json.dumps(channel_ids(d)))}, true, {d.rank})"
        for d in DISHES) + ";")
    w("")
    rc = {r.recipe_id: r for r in result.recipes}
    w("-- C12: 8 de 20 fichas prontas, built in the onboarding session; costs by worker-cost as of 30/out.")
    w("insert into public.recipe (id, account_id, menu_item_id, status, built_by, built_on, cost_cents, error_pct, cost_as_of, cost_computed_at) values")
    w(",\n".join(
        f"  (pg_temp.sid('G-02:recipe:{d.key}'), pg_temp.sid('G-02'), pg_temp.sid('G-02:dish:{d.key}'), 'ready', "
        f"pg_temp.sid('p:marlon'), '2026-10-28', {rc[sid(f'G-02:recipe:{d.key}')].cost_cents}, "
        f"{rc[sid(f'G-02:recipe:{d.key}')].error_pct}, '{AS_OF.isoformat()}', '{AS_OF.isoformat()} 06:00-03')"
        for d in DISHES if d.recipe) + ";")
    w("insert into public.recipe_line (id, account_id, recipe_id, ingredient_id, qty_base_units, yield_pct, yield_confidence, price_per_base_unit_cents, price_source, price_observed_on, cost_cents, created_at) values")
    vals = []
    for d in DISHES:
        if not d.recipe:
            continue
        res = rc[sid(f"G-02:recipe:{d.key}")]
        for i, ((ing, qty, y, conf), lr) in enumerate(zip(d.recipe, res.lines, strict=True), 1):
            vals.append(f"  (pg_temp.sid('G-02:recipe:{d.key}:{i}'), pg_temp.sid('G-02'), pg_temp.sid('G-02:recipe:{d.key}'), "
                        f"pg_temp.sid('ing:{ing}'), {qty}, {y}, '{conf}', {lr.price.price.normalize():f}, "
                        f"'{lr.price.source}', '{lr.price.observed_on.isoformat()}', {lr.cost.quantize(D('0.0001')).normalize():f}, "
                        f"'2026-10-28 15:00-03'::timestamptz + interval '{i} seconds')")
    w(",\n".join(vals) + ";")
    w("")
    w("-- C13, DLV-01: the iFood coupon of Burger do Bairro applies to Combo casal.")
    w("insert into public.campaign_item (account_id, campaign_id, menu_item_id) values")
    w(",\n".join(f"  (pg_temp.sid('G-02'), pg_temp.sid('G-02:camp:{s}'), pg_temp.sid('G-02:dish:combo'))" for s in COUPON_STORES) + ";")
    w("")
    w("-- Dishes of each September order (order_item_fact, as the extension's item report gives them).")
    w("insert into public.order_item_fact (account_id, order_fact_id, line_no, item_name, external_item_id, qty, unit_price_cents) values")
    vals = []
    for o, picks in sold_orders:  # type: ignore[attr-defined]
        for j, k in enumerate(picks, 1):
            dsh = DISH[k]
            vals.append(f"  (pg_temp.sid('G-02'), pg_temp.sid('order:{o.store}:{o.ext}'), {j}, {q(dsh.name)}, "
                        f"'{channel_ids(dsh)[STORES[o.store][0]]}', 1, {dsh.price})")
    w(",\n".join(vals) + ";")
    w("")
    w("-- Derived: contribution per dish and channel (CTB-01, CTB-02), insumos per store (W01), DLV-01.")
    key_of = {sid(f"G-02:dish:{d.key}"): d.key for d in DISHES}
    w("insert into public.contribution (account_id, close_period_id, menu_item_id, channel, campaign_name, campaign_discount_pct, units, price_cents, channel_take_cents, ingredient_cents, packaging_cents, ingredient_error_pct, left_cents, left_pct, can_invert, prices_as_of) values")
    w(",\n".join(
        f"  (pg_temp.sid('G-02'), pg_temp.sid('G-02:close:2026-09'), pg_temp.sid('G-02:dish:{key_of[r.menu_item_id]}'), "
        f"'{r.channel}', {q(r.campaign_name)}, {q(r.campaign_discount_pct)}, {r.units}, {r.price_cents}, "
        f"{r.channel_take_cents}, {r.ingredient_cents}, {r.packaging_cents}, {r.ingredient_error_pct}, {r.left_cents}, "
        f"{q(r.left_pct)}, {q(r.can_invert)}, '{AS_OF.isoformat()}')"
        for r in result.rows) + ";")  # type: ignore[attr-defined]
    w("insert into public.close_cost_line (account_id, close_period_id, channel_store_id, units, uncovered_units, ingredient_cents, packaging_cents) values")
    w(",\n".join(
        f"  (pg_temp.sid('G-02'), pg_temp.sid('G-02:close:2026-09'), pg_temp.sid('G-02:{sc.store_id}'), {sc.units}, "
        f"{sc.uncovered_units}, {sc.ingredient_cents}, {sc.packaging_cents})"
        for sc in result.store_costs) + ";")  # type: ignore[attr-defined]
    d = result.decision  # type: ignore[attr-defined]
    w("insert into public.close_decision (close_period_id, account_id, kind, menu_item_id, channel, campaign_name, campaign_discount_pct, left_cents, base_left_cents) values")
    w(f"  (pg_temp.sid('G-02:close:2026-09'), pg_temp.sid('G-02'), '{d.kind}', pg_temp.sid('G-02:dish:{key_of[d.menu_item_id]}'), "
      f"'{d.channel}', {q(d.campaign_name)}, {q(d.campaign_discount_pct)}, {d.left_cents}, {q(d.base_left_cents)});")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    text = emit(build())
    if "--check" in argv:
        if OUT.read_text() != text:
            print(f"{OUT} is out of date: run uv run python scripts/gen_g_syn_m3.py", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
