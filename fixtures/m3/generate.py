"""Generate the synthetic accountant zip of Pantanos Burguer (G-01), 12 months of purchase XMLs (D01).

    uv run python fixtures/m3/generate.py

Writes fixtures/m3/notas-pantanos-nov2025-out2026-SINTETICO.zip: 312 distinct invoices (268 NF-e, 44
NFC-e) from 41 suppliers over 12 months, plus 9 duplicate files (same access key, as accountants send when
two monthly folders overlap), the numbers drawn in C10. Everything is SINTÉTICO (D46): every issuer CNPJ
has invalid check digits, so none can be a real company; access keys have valid check digits, as the
import checks them (06 §5). The XMLs follow the public NF-e 4.00 layout with only the fields worker-import
reads. Products include the six lines drawn in C11 with their drawn prices.
"""

from __future__ import annotations

import io
import random
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent
ZIP_NAME = "notas-pantanos-nov2025-out2026-SINTETICO.zip"
BUYER_CNPJ = "98765432000150"  # G-01 company in supabase/seed/g_syn.sql (invalid check digits)
CUF = "41"  # PR, Londrina
MONTHS = [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 11)]
NFE, NFCE, DUPLICATES, SUPPLIERS = 268, 44, 9, 41


def cnpj_invalid(root8: str, branch: str = "0001") -> str:
    """A 14-digit CNPJ whose check digits are wrong on purpose."""
    base = root8 + branch

    def dv(digits: str, weights: list[int]) -> int:
        r = sum(int(d) * w for d, w in zip(digits, weights, strict=True)) % 11
        return 0 if r < 2 else 11 - r

    d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = dv(base + str(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return base + str((d1 + 1) % 10) + str(d2)


def key_dv(first43: str) -> int:
    total, weight = 0, 2
    for ch in reversed(first43):
        total += int(ch) * weight
        weight = 2 if weight == 9 else weight + 1
    r = total % 11
    return 0 if r < 2 else 11 - r


def access_key(issued: date, cnpj: str, model: int, serie: int, number: int, code: int) -> str:
    k = f"{CUF}{issued:%y%m}{cnpj}{model:02d}{serie:03d}{number:09d}1{code:08d}"
    return k + str(key_dv(k))


def gtin13(body12: str) -> str:
    s = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(body12))
    return body12 + str((10 - s % 10) % 10)


@dataclass(frozen=True)
class Product:
    description: str
    ncm: str
    unit: str
    price: Decimal  # vUnCom in reais
    qty: tuple[int, int]
    gtin: str | None = None
    retail: bool = False  # bought at a cash-and-carry with an NFC-e


def P(
    desc: str,
    ncm: str,
    unit: str,
    price: str,
    qty: tuple[int, int],
    gtin: str | None = None,
    retail: bool = False,
) -> Product:  # noqa: E501
    return Product(desc, ncm, unit, Decimal(price), qty, gtin, retail)


# Restricted-circulation GTIN prefix 200: never a real product code.
COLA = gtin13("200000000101")
GUARANA = gtin13("200000000102")
AGUA = gtin13("200000000103")

PRODUCTS: dict[str, Product] = {
    # C11 drawn lines, drawn prices: R$ 38,90/kg, R$ 2,85/un, R$ 14,20/kg, R$ 52,10/kg, R$ 11,30/kg, R$ 1,15/un.
    "carne": P("CARNE BOV MOIDA PATINHO/ACEM 80/20 KG", "02013000", "KG", "38.90", (20, 60)),
    "refri": P("REFRIG COCA COLA LT 350ML", "22021000", "UN", "2.85", (48, 144), COLA, retail=True),
    "batata": P("BAT PRE FRITA CONG 2,5KG PALITO 9MM", "20041000", "PC", "35.50", (6, 20)),
    "cheddar": P("QJO PROC CHED FAT 2,27KG 160FT", "04063000", "PC", "118.27", (2, 6)),
    "maionese": P("MAION TEMP CASA 3KG BALDE", "21039011", "UN", "33.90", (2, 6)),
    "brioche": P("PAO HAMB BRIOCHE GERG C/12", "19059090", "PCT", "13.80", (10, 40)),
    # C10 drawn: R$ 8,40/l.
    "oleo": P("OLEO SOJA REFINADO PET 900ML", "15079011", "UN", "7.56", (12, 40)),
    "alface": P("ALFACE AMERICANA UN", "07051100", "UN", "3.20", (20, 60)),
    "tomate": P("TOMATE ITALIANO KG", "07020000", "KG", "7.90", (10, 30)),
    "cebola": P("CEBOLA ROXA KG", "07031019", "KG", "6.40", (8, 20)),
    "prato": P("QJO PRATO FAT KG", "04069030", "KG", "44.90", (4, 12)),
    "frango": P("FILE PEITO FRANGO CONG KG", "02071400", "KG", "21.50", (10, 30)),
    "ketchup": P("KETCHUP TRAD BAG 1,01KG", "21032010", "UN", "14.90", (4, 12)),
    "picles": P("PICLES PEPINO FATIADO 2KG", "20011000", "UN", "32.00", (2, 6)),
    "ovo": P("OVO BRANCO CX C/30", "04072100", "CX", "18.90", (2, 8)),
    "barbecue": P("MOLHO BARBECUE GALAO 3,5KG", "21039091", "UN", "42.00", (1, 4)),
    "panko": P("FARINHA PANKO 1KG", "19041000", "UN", "16.50", (2, 8)),
    "guarana": P("REFRIG GUARANA LT 350ML", "22021000", "UN", "2.60", (24, 96), GUARANA, retail=True),
    "agua": P("AGUA MINERAL S/GAS 500ML", "22011000", "UN", "1.10", (24, 96), AGUA, retail=True),
    # Not ingredients: they stay without a pair in C11.
    "gas": P("GAS GLP P13", "27111910", "UN", "115.00", (1, 3)),
    "detergente": P("DETERGENTE NEUTRO 5L", "34022000", "UN", "18.90", (1, 4)),
    "toalha": P("PAPEL TOALHA INTERFOLHA 1000FL", "48183000", "FD", "24.90", (1, 4)),
    "luva": P("LUVA DESCARTAVEL VINIL CX C/100", "39262000", "CX", "29.90", (1, 4)),
}

# Supplier groups (index ranges of the 41 suppliers) and what each sells.
GROUPS: list[tuple[range, list[str]]] = [
    (range(0, 6), ["carne", "frango"]),
    (range(6, 11), ["batata", "panko", "frango"]),
    (range(11, 17), ["cheddar", "prato", "maionese", "ketchup", "barbecue", "picles"]),
    (range(17, 21), ["brioche"]),
    (range(21, 27), ["alface", "tomate", "cebola", "ovo"]),
    (range(27, 30), ["oleo", "ketchup", "maionese"]),
    (range(30, 35), ["gas", "detergente", "toalha", "luva"]),
    (range(35, 41), ["refri", "guarana", "agua", "oleo", "detergente"]),  # cash-and-carry, NFC-e
]

# Last purchase of the items C10 draws with a date (nota or cupom de dd/mmm).
LAST: dict[str, tuple[date, int]] = {
    "carne": (date(2026, 10, 12), 55),
    "batata": (date(2026, 10, 8), 55),
    "refri": (date(2026, 10, 3), 65),
    "oleo": (date(2026, 9, 21), 55),
}


@dataclass
class Item:
    product: Product
    qty: int


@dataclass
class Doc:
    key: str
    model: int
    issuer: int
    issued: datetime
    items: list[Item]


def money(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def supplier(i: int) -> tuple[str, str]:
    root = f"{11 + i:02d}{(i * 7919) % 1_000_000:06d}"
    kind = "Atacarejo" if i >= 35 else "Distribuidora"
    return cnpj_invalid(root), f"{kind} Exemplo {i + 1:02d} Ltda (SINTÉTICO)"


def products_of(i: int) -> list[str]:
    return next(p for r, p in GROUPS if i in r)


def xml(doc: Doc) -> bytes:
    cnpj, name = supplier(doc.issuer)
    dets, total = [], Decimal(0)
    for n, it in enumerate(doc.items, start=1):
        p = it.product
        v = (p.price * it.qty).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total += v
        ean = p.gtin or "SEM GTIN"
        dets.append(
            f'<det nItem="{n}"><prod><cProd>{n:04d}</cProd><cEAN>{ean}</cEAN><xProd>{escape(p.description)}</xProd>'
            f"<NCM>{p.ncm}</NCM><CFOP>{'5102' if doc.model == 55 else '5405'}</CFOP><uCom>{p.unit}</uCom>"
            f"<qCom>{it.qty}.0000</qCom><vUnCom>{money(p.price)}</vUnCom><vProd>{money(v)}</vProd>"
            f"<cEANTrib>{ean}</cEANTrib><uTrib>{p.unit}</uTrib><qTrib>{it.qty}.0000</qTrib>"
            f"<vUnTrib>{money(p.price)}</vUnTrib><indTot>1</indTot></prod></det>"
        )
    dest = (
        f"<dest><CNPJ>{BUYER_CNPJ}</CNPJ><xNome>Pantanos Burguer Ltda (SINTÉTICO)</xNome></dest>"
        if doc.model == 55
        else ""
    )
    serie, number = int(doc.key[22:25]), int(doc.key[25:34])
    body = (
        f'<?xml version="1.0" encoding="UTF-8"?>'
        f'<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe{doc.key}" versao="4.00">'
        f"<ide><cUF>{CUF}</cUF><cNF>{doc.key[35:43]}</cNF><natOp>VENDA</natOp><mod>{doc.model}</mod>"
        f"<serie>{serie}</serie><nNF>{number}</nNF><dhEmi>{doc.issued.isoformat()}</dhEmi><tpNF>1</tpNF>"
        f"<tpAmb>2</tpAmb><cDV>{doc.key[43]}</cDV></ide>"
        f"<emit><CNPJ>{cnpj}</CNPJ><xNome>{escape(name)}</xNome></emit>{dest}{''.join(dets)}"
        f"<total><ICMSTot><vProd>{money(total)}</vProd><vNF>{money(total)}</vNF></ICMSTot></total>"
        f"<infAdic><infCpl>DOCUMENTO SINTETICO PARA TESTES. SEM VALOR FISCAL.</infCpl></infAdic>"
        f'</infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>{doc.key}</chNFe>'
        f"</infProt></protNFe></nfeProc>"
    )
    return body.encode()


def build() -> list[Doc]:
    rng = random.Random(20261031)
    numbers: dict[int, int] = {}
    docs: list[Doc] = []

    def new_doc(issuer: int, model: int, day: date, names: list[str]) -> Doc:
        numbers[issuer] = numbers.get(issuer, 1000 * (issuer + 1)) + 1
        cnpj, _ = supplier(issuer)
        key = access_key(day, cnpj, model, 1, numbers[issuer], rng.randrange(10**8))
        hour = rng.randrange(7, 18)
        issued = datetime(day.year, day.month, day.day, hour, rng.randrange(60), tzinfo=_SP)
        items = [Item(PRODUCTS[n], rng.randint(*PRODUCTS[n].qty)) for n in names]
        return Doc(key, model, issuer, issued, items)

    def random_day(y: int, m: int, before: date | None = None) -> date:
        last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
        while True:
            d = date(y, m, rng.randint(1, last))
            if before is None or d < before:
                return d

    # The dated last purchases first, then every other invoice strictly before them for those items.
    for name, (day, model) in LAST.items():
        issuer = next(i for r, p in GROUPS for i in r if name in p and (model == 65) == (i >= 35))
        docs.append(new_doc(issuer, model, day, [name]))
    cutoff = {n: d for n, (d, _) in LAST.items()}
    nfe_left, nfce_left = (
        NFE - sum(1 for d in docs if d.model == 55),
        NFCE - sum(1 for d in docs if d.model == 65),
    )
    plan = [55] * nfe_left + [65] * nfce_left
    rng.shuffle(plan)
    for n, model in enumerate(plan):
        # Every supplier sells at least once: the first 41 invoices go round the suppliers of the right kind.
        pool = [i for i in range(SUPPLIERS) if (i >= 35) == (model == 65)]
        issuer = pool[n % len(pool)] if n < 2 * SUPPLIERS else rng.choice(pool)
        y, m = MONTHS[n % len(MONTHS)]
        sold = products_of(issuer)
        first = date(y, m, 1)
        open_ = [x for x in sold if x not in cutoff or first < cutoff[x]]
        names = rng.sample(open_, rng.randint(1, min(3, len(open_))))
        cut = min((cutoff[x] for x in names if x in cutoff), default=None)
        docs.append(new_doc(issuer, model, random_day(y, m, cut), names))
    return docs


_SP = __import__("zoneinfo").ZoneInfo("America/Sao_Paulo")


def write_zip(docs: list[Doc]) -> bytes:
    buf = io.BytesIO()
    stamp = (2026, 10, 31, 12, 0, 0)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            zipfile.ZipInfo("LEIA-ME-SINTETICO.txt", stamp),
            "Notas SINTÉTICAS de teste (G-SYN). Sem valor fiscal.\n",
        )
        for d in sorted(docs, key=lambda d: (d.issued, d.key)):
            folder = f"{d.issued:%Y-%m}"
            zf.writestr(
                zipfile.ZipInfo(f"{folder}/{d.key}-{'nfe' if d.model == 55 else 'nfce'}.xml", stamp), xml(d)
            )
        # The accountant's overlap: 9 files of September again in the October folder.
        again = [
            d for d in sorted(docs, key=lambda d: d.key) if d.issued.month == 9 and d.issued.year == 2026
        ][:DUPLICATES]
        for d in again:
            zf.writestr(zipfile.ZipInfo(f"2026-10/repetidas/{d.key}.xml", stamp), xml(d))
    return buf.getvalue()


def main() -> None:
    docs = build()
    assert len({d.key for d in docs}) == NFE + NFCE
    assert sum(1 for d in docs if d.model == 55) == NFE and sum(1 for d in docs if d.model == 65) == NFCE
    assert len({d.issuer for d in docs}) == SUPPLIERS
    (OUT / ZIP_NAME).write_bytes(write_zip(docs))
    print(OUT / ZIP_NAME)


if __name__ == "__main__":
    main()
