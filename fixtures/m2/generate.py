"""Generate the synthetic G-SYN September 2026 statements and the M2 seed from one source.

    uv run python fixtures/m2/generate.py

Writes, all labeled SINTÉTICO (D46):
  fixtures/m2/ifood-conciliacao-set2026-SINTETICO.csv     iFood export, layout gsyn-sintetico-v1
  fixtures/m2/99food-extrato-set2026-SINTETICO-v1.xlsx    99Food statement, layout gsyn-sintetico-v1
  fixtures/m2/99food-extrato-set2026-SINTETICO.xlsx       same month, changed layout (3 new columns, C17)
  fixtures/m2/99food-extrato-out2026-SINTETICO.xlsx       October, changed layout (C02: imports alone)
  supabase/seed/g_syn_m2.sql                              canonical rows, close, differences, history

The canonical rows of the seed are what worker-import's own parser (margo_import.layout) reads from these
files, and the close and differences are what margo_import.close computes from them, so the seed, the
files and the code cannot drift apart. The values reproduce the drawings of C08, C09, C16 and P06 to the
centavo. None of this is a real portal layout (fixtures/m2/README.md).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import random
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from margo_import.claims import claim_text
from margo_import.close import StoreMonth, compute_close
from margo_import.layout import (
    SAO_PAULO,
    Parsed,
    apply,
    examples,
    propose,
    read_table,
    signature,
)
from margo_import.rules import Campaign, Entry, Order, Params, Terms, cents, rep05_expected_payout
from margo_import.synthetic_layouts import (
    F99_MAPPING,
    F99_NEW,
    F99_V1_HEADERS,
    F99_V2_MAPPING,
    IFOOD_HEADERS,
    IFOOD_MAPPING,
)
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "m2"
SEED = ROOT / "supabase" / "seed" / "g_syn_m2.sql"
LABEL = "SINTÉTICO: dados fictícios do G-SYN (Grupo Exemplo), gerados por fixtures/m2/generate.py"
AS_OF = date(2026, 10, 30)  # "hoje" in the drawings

IFOOD_CSV = "ifood-conciliacao-set2026-SINTETICO.csv"
F99_V1 = "99food-extrato-set2026-SINTETICO-v1.xlsx"
F99_V2 = "99food-extrato-set2026-SINTETICO.xlsx"
F99_OCT = "99food-extrato-out2026-SINTETICO.xlsx"


def sid(tag: str) -> uuid.UUID:
    """Same ids as pg_temp.sid() in the seed files: md5('g-syn:' || tag)."""
    return uuid.UUID(hashlib.md5(("g-syn:" + tag).encode()).hexdigest())


# Stores of Grupo Exemplo (supabase/seed/g_syn.sql) and their contracts ------------------------------

STORES = {
    "s1": ("3fa85f64-5717-4562-b3fc-2c963f66afa6", "ifood"),  # Burger do Bairro Centro
    "s2": ("9b1c22d0-4e8a-4c3b-9f21-7d5e0a6b3c41", "ifood"),  # Frango Crocante Centro
    "s4": ("c47e0a19-2b6d-4f8e-a135-9c0d7e2f450d", "ifood"),  # Burger do Bairro Zona Sul
    "s3": ("99F-551203", "food99"),  # Burger do Bairro Centro
    "s5": ("99F-551877", "food99"),  # Burger do Bairro Zona Sul
}
TAG_OF = {ext: tag for tag, (ext, _) in STORES.items()}
TERMS = {
    "s1": ("Plano Entrega", Decimal("0.12"), Decimal("0.035")),
    "s2": ("Plano Entrega", Decimal("0.13"), Decimal("0.035")),
    "s4": ("Plano Entrega", Decimal("0.12"), Decimal("0.035")),
    "s3": ("Parceiro 99Food", Decimal("0.09"), Decimal("0.033")),
    "s5": ("Parceiro 99Food", Decimal("0.09"), Decimal("0.033")),
}
IFOOD_CAMPAIGN = (
    "Cupom 20% cofinanciado",
    Decimal("0.20"),
    Decimal("0.50"),
    date(2026, 9, 1),
    date(2026, 9, 20),
)
F99_CAMPAIGN = ("Promoção da loja 10%", Decimal("0.10"), Decimal("0"), date(2026, 9, 1), date(2026, 9, 30))

# C08, P06 (drawn, centavos) and C09 (drawn).
IFOOD_TARGET = dict(
    gross=9_240_000,
    commission=-1_108_800,
    payment=-295_700,
    delivery=-462_000,
    promotion=-369_600,
    anticipation=-121_000,
    payout=6_882_900,
)
F99_TARGET = dict(
    gross=1_860_000,
    commission=-167_400,
    payment=-59_500,
    delivery=-130_200,
    promotion=-55_800,
    anticipation=0,
    payout=1_447_100,
)


@dataclass
class Gen:
    """One generated order with what the statement says about it."""

    tag: str
    ext: str
    at: datetime
    items: int = 0
    fee: int = 0  # iFood: customer delivery fee in the total; 99Food: delivery charged to the store
    d_store: int = 0
    d_chan: int = 0
    status: str = "concluido"
    by: str = ""
    reason: str = ""
    kind: str = "plain"
    commission: int = 0
    payment: int = 0
    promotion: int = 0
    anticipation: int = 0
    payouts: list[tuple[str, int, date, str]] = field(default_factory=list)  # tx, amount, day, "1 de 2"
    expected: date | None = None
    rate: Decimal = Decimal("0")

    @property
    def day(self) -> date:
        return self.at.date()

    @property
    def gross(self) -> int:
        return self.items + (self.fee if STORES[self.tag][1] == "ifood" else 0)

    @property
    def delivery(self) -> int:
        return -self.fee if self.status == "concluido" else 0

    def net(self) -> int:
        return (
            self.gross + self.commission + self.payment + self.delivery + self.promotion + self.anticipation
        )


def rep05(o: Gen) -> int:
    """REP-05 for a generated order, through the worker's own rule (no campaign: none applies to these)."""
    _, rate, pay = TERMS[o.tag]
    order = Order("x", o.tag, o.ext, o.day, o.gross, o.items, o.fee, o.d_store, o.d_chan)
    return rep05_expected_payout(order, Terms(rate, pay, "canal"), None)


def fit(values: list[int], target: int, lo: int, hi: int, rng: random.Random) -> list[int]:
    """Nudge integers (each kept within lo..hi) until they sum to target exactly."""
    vals = list(values)
    diff = target - sum(vals)
    idx = list(range(len(vals)))
    while diff != 0:
        rng.shuffle(idx)
        moved = False
        for i in idx:
            step = max(-abs(diff), min(abs(diff), 50)) if diff > 0 else -min(abs(diff), 50)
            if lo <= vals[i] + step <= hi:
                vals[i] += step
                diff -= step
                moved = True
                if diff == 0:
                    break
        if not moved:
            raise ValueError("cannot fit")
    return vals


def at(rng: random.Random, first: date, last: date) -> datetime:
    days = (last - first).days
    d = first + timedelta(days=rng.randint(0, days))
    return datetime(d.year, d.month, d.day, rng.randint(11, 22), rng.randint(0, 59), tzinfo=SAO_PAULO)


def nudge(orders: list[Gen], attr: str, residual: int, rng: random.Random) -> None:
    """Rounding noise of one centavo per order (within the rules' tolerance) to hit a drawn total."""
    pool = list(orders)
    rng.shuffle(pool)
    step = 1 if residual > 0 else -1
    for o in pool[: abs(residual)]:
        setattr(o, attr, getattr(o, attr) + step)
    assert abs(residual) <= len(pool), (attr, residual)


# iFood ----------------------------------------------------------------------------------------------


def make_ifood(rng: random.Random) -> list[Gen]:
    sept1, sept20, sept29 = date(2026, 9, 1), date(2026, 9, 20), date(2026, 9, 29)
    seq = iter(range(7_710_001, 7_799_999, 7))

    def new(tag: str, first: date = sept1, last: date = sept29, kind: str = "plain") -> Gen:
        return Gen(tag, f"IF-{next(seq)}", at(rng, first, last), kind=kind)

    orders: list[Gen] = []
    s1 = [new("s1", kind="B") for _ in range(214)]
    s1 += [new("s1", sept1, sept20, "C") for _ in range(31)]
    s1 += [new("s1", date(2026, 9, 21), date(2026, 9, 27), "D") for _ in range(22)]
    s1 += [new("s1") for _ in range(700 - len(s1))]
    s2 = [new("s2") for _ in range(240)]
    s4 = [new("s4") for _ in range(600)]
    orders = s1 + s2 + s4
    plain = [o for o in orders if o.kind == "plain"]

    # REP-04: co-funded 20% coupon until 20/set at every iFood store; the store pays half.
    cofunded = [o for o in plain if o.day <= sept20]
    rng.shuffle(cofunded)
    cofunded = cofunded[:560]
    ds = fit([2 * rng.randint(450, 700) for _ in cofunded], 635_200, 400, 3000, rng)
    ds = [d + (d % 2) for d in ds]
    ds[-1] += 635_200 - sum(ds)
    for o, d in zip(cofunded, ds, strict=True):
        o.kind, o.items, o.d_store, o.d_chan, o.promotion = (
            "cofunded",
            5 * d + rng.randint(-2, 2),
            d // 2,
            d // 2,
            -(d // 2),
        )
    # DIF-03 certa: 31 coupon orders of s1 debited in full (R$ 186,00 = half of R$ 372,00).
    cs = [o for o in orders if o.kind == "C"]
    dc = fit([2 * rng.randint(500, 700) for _ in cs], 37_200, 400, 3000, rng)
    dc = [d + (d % 2) for d in dc]
    dc[-1] += 37_200 - sum(dc)
    for o, d in zip(cs, dc, strict=True):
        o.items, o.d_store, o.promotion = 5 * d + rng.randint(-2, 2), d, -d
    # DIF-03 provável: 22 promotions of s1 in week 39 with no campaign registered (R$ 148,00).
    dd = fit([rng.randint(500, 850) for _ in range(22)], 14_800, 300, 1500, rng)
    for o, p in zip([o for o in orders if o.kind == "D"], dd, strict=True):
        o.items, o.d_store, o.promotion = rng.randint(4000, 8000), p, -p
    # iFood-funded coupons: the store pays nothing (REP-04 share 0, no entry).
    plain = [o for o in orders if o.kind == "plain"]
    coupons = rng.sample(plain, 150)
    kc = [rng.choice((500, 700, 1000)) for _ in coupons]
    kc = fit(kc, 104_229, 100, 2000, rng)
    for o, k in zip(coupons, kc, strict=True):
        o.kind, o.d_chan = "coupon", k
        o.items = rng.randint(3500, 9000)

    # Customer delivery fees (REP-03: the channel's in Plano Entrega).
    fees = fit([rng.choice((199, 249, 299, 349, 399)) for _ in orders], 462_000, 99, 999, rng)
    for o, f in zip(orders, fees, strict=True):
        o.fee = f

    # DIF-01: 214 orders of s1 charged 15% where the contract says 12% (R$ 412,00).
    bs = [o for o in orders if o.kind == "B"]
    for o, v in zip(bs, fit([rng.randint(4000, 9000) for _ in bs], 1_373_333, 2500, 12000, rng), strict=True):
        o.items = v
    extra = lambda i: cents(Decimal("0.15") * i) - cents(Decimal("0.12") * i)  # noqa: E731
    rest = 41_200 - sum(extra(o.items) for o in bs[:-1])
    bs[-1].items = next(i for i in range(100, 200_000) if extra(i) == rest)

    # Items of the free orders, to the drawn totals: s2 base for 13%, then the rest.
    def settle(group: list[Gen], target: int) -> None:
        free = [o for o in group if o.kind in ("plain", "coupon", "D")]
        fixed = sum(o.items for o in group if o not in free)
        for o in free:
            o.items = o.items or rng.randint(3000, 9000)
        vals = fit([o.items for o in free], target - fixed, 1500, 20000, rng)
        for o, v in zip(free, vals, strict=True):
            o.items = v

    items_total = IFOOD_TARGET["gross"] - 462_000
    s2_items = 1_424_000  # 0.12 * all items + 0.01 * s2 items + R$ 412,00 = R$ 11.088,00
    settle(s2, s2_items)
    settle(s1 + s4, items_total - s2_items)

    for o in orders:
        _, rate, pay = TERMS[o.tag]
        o.rate = Decimal("0.15") if o.kind == "B" else rate
        o.commission = -cents(o.rate * o.items)
        o.payment = -cents(pay * (o.gross - o.d_store - o.d_chan))
    noise = [o for o in orders if o.kind in ("plain", "coupon", "cofunded")]
    nudge(noise, "commission", IFOOD_TARGET["commission"] - sum(o.commission for o in orders), rng)
    nudge(noise, "payment", IFOOD_TARGET["payment"] - sum(o.payment for o in orders), rng)

    # Anticipation fees on some payouts.
    early = rng.sample(orders, 420)
    fees_a = fit([cents(Decimal("0.025") * o.net()) for o in early], 121_000, 10, 2000, rng)
    for o, a in zip(early, fees_a, strict=True):
        o.anticipation = -a
    for o in orders:
        o.expected = o.day + timedelta(days=1)
        o.payouts = [("", o.net(), o.day + timedelta(days=1), "")]

    # DIF-02: 9 orders of s4 cancelled by the customer, charged to the store (R$ 238,00).
    cancelled = [
        Gen(
            "s4",
            f"IF-{next(seq)}",
            at(rng, sept1, sept29),
            status="cancelado",
            by="Cliente",
            reason="Cliente desistiu do pedido",
        )
        for _ in range(9)
    ]
    for o in cancelled:
        o.items, o.fee = rng.randint(2800, 3600), rng.choice((249, 299))
    rest = 23_800 - sum(rep05(o) for o in cancelled[:-1])
    last = cancelled[-1]
    last.items = next(i for i in range(1000, 50_000) if (setattr(last, "items", i) or rep05(last)) == rest)
    # Cancelled by the store: the store's fault, no difference.
    by_store = [
        Gen(
            "s1",
            f"IF-{next(seq)}",
            at(rng, sept1, sept29),
            status="cancelado",
            by="Loja",
            reason="Item em falta",
            items=rng.randint(3000, 6000),
            fee=249,
        )
        for _ in range(3)
    ]
    return orders + cancelled + by_store


def brl(c: int) -> str:
    sign = "-" if c < 0 else ""
    return f"{sign}{abs(c) // 100},{abs(c) % 100:02d}"


def ddmmyyyy(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def ifood_csv(orders: list[Gen]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\n")
    w.writerow([LABEL])
    w.writerow(IFOOD_HEADERS)
    for o in sorted(orders, key=lambda o: (o.at, o.ext)):
        done = o.status == "concluido"
        pay = o.payouts[0] if o.payouts else ("", 0, None, "")
        w.writerow(
            [
                o.at.strftime("%d/%m/%Y %H:%M"),
                STORES[o.tag][0],
                o.ext,
                "Concluído" if done else "Cancelado",
                o.by,
                o.reason,
                brl(o.items),
                brl(o.fee),
                brl(o.gross),
                brl(o.d_chan),
                brl(o.commission),
                brl(o.payment),
                brl(o.delivery),
                brl(o.promotion),
                brl(o.anticipation),
                brl(pay[1]),
                ddmmyyyy(pay[2]) if done else "",
                ddmmyyyy(o.expected),
            ]
        )
    return buf.getvalue().encode("utf-8")


# 99Food ---------------------------------------------------------------------------------------------


def make_99food(rng: random.Random) -> tuple[list[Gen], Gen, Gen]:
    """September orders (with DIF-02, DIF-04), plus Y: an August order whose 2nd installment came in September."""
    sept1, sept28 = date(2026, 9, 1), date(2026, 9, 28)
    seq = iter(range(8_812_304, 8_999_999, 11))
    tx = iter(range(5_500_001, 5_999_999, 3))
    new = lambda tag: Gen(tag, f"99F-{next(seq)}", at(rng, sept1, sept28))  # noqa: E731
    orders = [new("s3") for _ in range(299)] + [new("s5") for _ in range(216)]
    # DIF-04: one order of week 37 at s3 with no payout yet (R$ 80,00); payment expected 03/nov.
    x = Gen("s3", f"99F-{next(seq)}", datetime(2026, 9, 9, 20, 41, tzinfo=SAO_PAULO), kind="X", fee=250)
    x.items = next(i for i in range(5000, 20000) if (setattr(x, "items", i) or rep05(x)) == 8_000)
    x.expected = date(2026, 11, 3)

    promo = rng.sample(orders, 120)
    dps = fit([rng.randint(300, 560) for _ in promo], 55_800, 150, 1500, rng)
    for o, d in zip(promo, dps, strict=True):
        o.kind, o.items, o.d_store, o.promotion = "promo", 10 * d + rng.randint(-4, 4), d, -d
    for o in rng.sample([o for o in orders if o.kind == "plain"], 12):
        o.d_chan = 400  # "Subsídio da plataforma" (changed layout only)
    fees = fit([rng.choice((180, 220, 250, 280, 320)) for _ in orders], 130_200 - x.fee, 80, 900, rng)
    for o, f in zip(orders, fees, strict=True):
        o.fee = f
    free = [o for o in orders if o.kind == "plain"]
    vals = fit(
        [rng.randint(2200, 5200) for _ in free],
        F99_TARGET["gross"] - x.items - sum(o.items for o in orders if o.kind == "promo"),
        1200,
        15000,
        rng,
    )
    for o, v in zip(free, vals, strict=True):
        o.items = v
    allo = orders + [x]
    for o in allo:
        _, rate, pay = TERMS[o.tag]
        o.commission = -cents(rate * o.items)
        o.payment = -cents(pay * (o.items - o.d_store - o.d_chan))
    noise = [o for o in orders if o.kind in ("plain", "promo")]
    nudge(noise, "commission", F99_TARGET["commission"] - sum(o.commission for o in allo), rng)
    nudge(noise, "payment", F99_TARGET["payment"] - sum(o.payment for o in allo), rng)
    assert x.net() == 8_000
    single = set(map(id, rng.sample(orders, 15)))
    for o in orders:
        n = o.net()
        o.expected = o.day + timedelta(days=2)
        if id(o) in single:
            o.payouts = [(f"TX-{next(tx)}", n, o.day + timedelta(days=1), "1 de 1")]
        else:
            first = n // 2
            o.payouts = [
                (f"TX-{next(tx)}", first, o.day + timedelta(days=1), "1 de 2"),
                (f"TX-{next(tx)}", n - first, o.day + timedelta(days=2), "2 de 2"),
            ]
    # Y: ordered 31/ago; its 2nd installment of R$ 80,00 is paid on 01/set (in the September statement).
    y = Gen("s3", f"99F-{next(seq)}", datetime(2026, 8, 31, 21, 5, tzinfo=SAO_PAULO), items=17_640, fee=320)
    _, rate, pay = TERMS["s3"]
    y.commission, y.payment = -cents(rate * y.items), -cents(pay * y.items)
    y.expected = date(2026, 9, 1)
    y.payouts = [(f"TX-{next(tx)}", 8_000, date(2026, 9, 1), "2 de 2")]
    # DIF-02: 5 orders of s5 cancelled for the courier's delay (R$ 120,00).
    cancelled = [
        Gen(
            "s5",
            f"99F-{next(seq)}",
            at(rng, sept1, sept28),
            status="cancelado",
            by="Entregador",
            reason="Atraso do entregador",
        )
        for _ in range(5)
    ]
    for o in cancelled:
        o.items = rng.randint(2400, 3100)
    rest = 12_000 - sum(rep05(o) for o in cancelled[:-1])
    last = cancelled[-1]
    last.items = next(i for i in range(1000, 50_000) if (setattr(last, "items", i) or rep05(last)) == rest)
    return allo + cancelled, x, y


def make_99food_october(rng: random.Random) -> list[Gen]:
    seq = iter(range(9_100_001, 9_199_999, 13))
    tx = iter(range(6_100_001, 6_199_999, 3))
    out = []
    for i in range(36):
        o = Gen("s3" if i % 2 else "s5", f"99F-{next(seq)}", at(rng, date(2026, 10, 1), date(2026, 10, 4)))
        o.items, o.fee = rng.randint(2400, 5200), rng.choice((180, 220, 250))
        if i % 9 == 0:
            o.d_chan = 400
        _, rate, pay = TERMS[o.tag]
        o.commission, o.payment = -cents(rate * o.items), -cents(pay * (o.items - o.d_chan))
        n = o.net()
        o.expected = o.day + timedelta(days=2)
        o.payouts = [
            (f"TX-{next(tx)}", n // 2, o.day + timedelta(days=1), "1 de 2"),
            (f"TX-{next(tx)}", n - n // 2, o.day + timedelta(days=2), "2 de 2"),
        ]
        out.append(o)
    return out


def f99_rows(orders: list[Gen], v2: bool) -> list[list[object]]:
    rows: list[tuple[datetime, str, int, list[object]]] = []
    for o in orders:
        done = o.status == "concluido"
        lines = o.payouts or [("", 0, None, "")]
        for n, (t, amount, paid, inst) in enumerate(lines):
            row: list[object] = [
                o.at.replace(tzinfo=None),
                STORES[o.tag][0],
                o.ext,
                t or None,
                "Entregue" if done else "Cancelado",
                o.by or None,
                o.reason or None,
                o.items / 100,
                o.commission / 100,
                o.payment / 100,
                o.delivery / 100,
                o.promotion / 100,
                amount / 100 if amount else None,
                datetime(paid.year, paid.month, paid.day) if paid else None,
                datetime(o.expected.year, o.expected.month, o.expected.day) if o.expected else None,
            ]
            if v2:
                row += [o.d_chan / 100, 0.0, inst or None]
            rows.append(
                (
                    paid and datetime(paid.year, paid.month, paid.day) or o.at.replace(tzinfo=None),
                    o.ext,
                    n,
                    row,
                )
            )
    return [r for *_, r in sorted(rows, key=lambda r: (r[0], r[1], r[2]))]


def xlsx(headers: list[str], rows: list[list[object]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Extrato"
    ws.append([LABEL])
    ws.append(headers)
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=3):
        for c in row:
            if isinstance(c.value, datetime):
                c.number_format = "dd/mm/yyyy hh:mm" if c.column == 1 else "dd/mm/yyyy"
            elif isinstance(c.value, float):
                c.number_format = "#,##0.00"
    buf = io.BytesIO()
    wb.properties.creator = "MargoAI G-SYN (SINTÉTICO)"
    wb.properties.created = datetime(2026, 10, 1)
    wb.properties.modified = datetime(2026, 10, 1)
    wb.save(buf)
    # Same bytes on every run: fixed zip timestamps and document dates.
    src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "docProps/core.xml":
                data = re.sub(rb"(<dcterms:(?:created|modified)[^>]*>)[^<]*", rb"\g<1>2026-10-01T00:00:00Z", data)
            dst.writestr(zipfile.ZipInfo(info.filename, (2026, 10, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    return out.getvalue()


# Close of the generated facts ------------------------------------------------------------------------


def as_store_month(parsed: list[Parsed], month: date) -> list[StoreMonth]:
    """The parsed rows as margo_import.close sees them after they are in the database."""
    out = []
    for tag, (ext, channel) in STORES.items():
        name, rate, pay = TERMS[tag]
        camps = []
        c = IFOOD_CAMPAIGN if channel == "ifood" else F99_CAMPAIGN
        camps.append(Campaign(str(sid(f"G-02:camp:{tag}")), tag, c[1], c[2], c[3], c[4]))
        orders, by_order, month_entries = [], {}, []
        for p in parsed:
            for (s, oid), o in p.orders.items():
                day = o.ordered_at.astimezone(SAO_PAULO).date()
                if s != ext or day.replace(day=1) != month:
                    continue
                orders.append(
                    Order(
                        str(sid(f"order:{tag}:{oid}")),
                        tag,
                        oid,
                        day,
                        o.gross_cents,
                        o.items_cents,
                        o.delivery_fee_cents,
                        o.discount_store_cents,
                        o.discount_channel_cents,
                        o.status,
                        o.cancelled_by,
                        o.cancel_reason,
                    )
                )
            for (s, key), e in p.entries.items():
                if s != ext:
                    continue
                entry = Entry(
                    str(sid(f"entry:{tag}:{key}")),
                    tag,
                    str(sid(f"order:{tag}:{e.external_order_id}")),
                    e.entry_date,
                    e.type,
                    e.amount_cents,
                    e.expected_payment_date,
                )
                by_order.setdefault(entry.order_id, []).append(entry)
                if e.entry_date.replace(day=1) == month:
                    month_entries.append(entry)
        ids = {o.id for o in orders}
        out.append(
            StoreMonth(
                tag,
                channel,
                [Terms(rate, pay, "canal", date(2026, 1, 1))],
                camps,
                orders,
                {k: v for k, v in by_order.items() if k in ids},
                month_entries,
            )
        )
    return out


# SQL --------------------------------------------------------------------------------------------------


def q(v: object) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | Decimal):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v.isoformat()}'"
    if isinstance(v, date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


def values(rows: list[tuple[object, ...]], indent: str = "  ") -> str:
    return ",\n".join(indent + "(" + ", ".join(q(v) for v in r) + ")" for r in rows)


def main() -> None:
    rng = random.Random(20260930)
    ifood = make_ifood(rng)
    f99, x, y = make_99food(rng)
    october = make_99food_october(rng)

    files = {
        IFOOD_CSV: ifood_csv(ifood),
        F99_V1: xlsx(F99_V1_HEADERS, f99_rows(f99 + [y], v2=False)),
        F99_V2: xlsx(F99_V1_HEADERS + F99_NEW, f99_rows(f99 + [y], v2=True)),
        F99_OCT: xlsx(F99_V1_HEADERS + F99_NEW, f99_rows(october, v2=True)),
    }
    for name, data in files.items():
        (OUT / name).write_bytes(data)

    p_ifood = apply(read_table(files[IFOOD_CSV], IFOOD_CSV), IFOOD_MAPPING)
    p_f99 = apply(read_table(files[F99_V1], F99_V1), F99_MAPPING)
    v2_table = read_table(files[F99_V2], F99_V2)
    p_v2 = apply(v2_table, F99_V2_MAPPING)
    assert v2_table.preamble == [LABEL]
    assert p_v2.rows_in_file == 1_022, p_v2.rows_in_file
    assert p_v2.payout_total_file_cents == p_v2.payout_total_mapped_cents == 1_447_100
    assert set(p_v2.entries) == set(p_f99.entries) and set(p_v2.orders) == set(p_f99.orders)

    sept = date(2026, 9, 1)
    result = compute_close(as_store_month([p_ifood, p_f99], sept), Params(), AS_OF)
    by_channel: dict[str, dict[str, int]] = {}
    for line in result.lines:
        ch = STORES[line.store_id][1]
        acc = by_channel.setdefault(ch, dict.fromkeys(IFOOD_TARGET, 0))
        for k in acc:
            acc[k] += getattr(line, f"{'payment' if k == 'payment' else k}_cents")
    assert by_channel["ifood"] == IFOOD_TARGET, by_channel["ifood"]
    assert by_channel["food99"] == F99_TARGET, by_channel["food99"]
    drawn = sorted(
        [
            ("DIF-01", 41_200, "certa"),
            ("DIF-02", 23_800, "certa"),
            ("DIF-03", 18_600, "certa"),
            ("DIF-02", 12_000, "certa"),
            ("DIF-03", 14_800, "provavel"),
            ("DIF-04", 8_000, "provavel"),
        ]
    )
    got = sorted((f.rule_id, f.amount_cents, f.confidence) for f in result.findings)
    assert got == drawn, got

    SEED.write_text(seed_sql(ifood, f99 + [y], p_ifood, p_f99, v2_table, p_v2, result, x))
    print(f"wrote {len(files)} files to {OUT.relative_to(ROOT)} and {SEED.relative_to(ROOT)}")


def seed_sql(
    ifood: list[Gen],
    f99: list[Gen],
    p_ifood: Parsed,
    p_f99: Parsed,
    v2_table: object,
    p_v2: Parsed,
    result: object,
    x: Gen,
) -> str:
    from margo_import.close import CloseResult

    assert isinstance(result, CloseResult)
    head = SEED_HEAD

    # Canonical rows, exactly as the parser read them: one row per order with its deduction entries
    # (key "<order>:<type>", dated the order's day), and one row per payout entry.
    deduction = ("commission", "payment_fee", "delivery", "promotion", "anticipation")
    order_rows, payout_rows = [], []
    for p, run in ((p_ifood, "i"), (p_f99, "n")):
        by_order: dict[tuple[str, str], dict[str, int]] = {}
        for (s, key), e in sorted(p.entries.items()):
            if e.type == "payout":
                payout_rows.append(
                    (TAG_OF[s], e.external_order_id, key, e.amount_cents, e.entry_date, e.raw_type)
                )
                continue
            assert (
                e.type in deduction and key == f"{e.external_order_id}:{e.type}" and e.raw_type == RAW[e.type]
            )
            by_order.setdefault((s, e.external_order_id), {})[e.type] = e.amount_cents
        for (s, oid), o in sorted(p.orders.items()):
            amounts = by_order.get((s, oid), {})
            expected = {
                e.expected_payment_date
                for (s2, _), e in p.entries.items()
                if s2 == s and e.external_order_id == oid
            }
            assert len(expected) <= 1
            order_rows.append(
                (
                    TAG_OF[s],
                    oid,
                    o.ordered_at.strftime("%Y-%m-%d %H:%M"),
                    o.gross_cents,
                    o.items_cents,
                    o.delivery_fee_cents,
                    o.discount_store_cents,
                    o.discount_channel_cents,
                    "c" if o.status == "concluido" else "x",
                    o.cancelled_by,
                    o.cancel_reason,
                    run,
                    next(iter(expected), None),
                    *(amounts.get(t, 0) for t in deduction),
                )
            )

    # C17 state of the 28/out upload: proposal from the saved 99Food layout, examples, check block.
    proposal, statuses, _ = propose(v2_table.headers, [F99_MAPPING])  # type: ignore[attr-defined]
    ex = examples(v2_table)  # type: ignore[arg-type]
    v2_log = {
        "signature": signature(v2_table.headers),  # type: ignore[attr-defined]
        "columns": [
            {"name": s.name, "example": ex.get(s.name, ""), "field": s.field, "known": s.known}
            for s in statuses
        ],
        "proposal": proposal.to_json(),
        "rows_in_file": p_v2.rows_in_file,
        "payout_total_file_cents": p_v2.payout_total_file_cents,
        "payout_total_mapped_cents": apply(v2_table, proposal).payout_total_mapped_cents,  # type: ignore[arg-type]
    }

    runs = history(v2_log, p_ifood, p_f99)
    cp = "G-02:close:2026-09"
    lines = [
        (
            f"{cp}:{line.store_id}",
            line.store_id,
            line.gross_cents,
            line.commission_cents,
            line.payment_cents,
            line.delivery_cents,
            line.promotion_cents,
            line.anticipation_cents,
            line.payout_cents,
        )
        for line in result.lines
    ]
    diffs, diff_orders, contests = [], [], []
    deadlines = {
        ("DIF-03", "certa"): date(2026, 11, 15),
        ("DIF-02", "food99"): date(2026, 11, 20),
        ("DIF-03", "provavel"): date(2026, 11, 22),
        ("DIF-01", "certa"): date(2026, 10, 29),
        ("DIF-02", "ifood"): date(2026, 10, 29),
    }
    for f in result.findings:
        tag = f"{cp}:{f.store_id}:{f.finding_key}"
        ch = STORES[f.store_id][1]
        detail = json.dumps({**f.detail, "short": f.short}, ensure_ascii=False, default=str)
        diffs.append(
            (
                tag,
                f.store_id,
                f.rule_id,
                f.finding_key,
                f.description,
                f.orders_count,
                f.amount_cents,
                f.confidence,
                f.rule_id in result.shown,
                detail,
            )
        )
        for oid, amount in f.orders:
            diff_orders.append((tag, oid, amount))
        if f.rule_id == "DIF-04":
            continue
        key = (f.rule_id, ch) if f.rule_id == "DIF-02" else (f.rule_id, f.confidence)
        status = "a_contestar" if f.confidence == "certa" else "precisa_resposta"
        contests.append(
            (tag, status, deadlines[key], claim_text(f, date(2026, 9, 1), ch), f.rule_id, f.store_id)
        )

    parts = [head]
    parts.append(
        "-- REP-01 to REP-03 inputs: one contract per store (synthetic plan names and rates).\n"
        "insert into public.contract_terms (account_id, channel_store_id, plan_name, commission_pct, "
        "payment_fee_pct, delivery_model, valid_from)\nselect pg_temp.sid('G-02'), pg_temp.sid('G-02:' || s), n, c, p, "
        "'canal', '2026-01-01' from (values\n"
        + values([(t, *TERMS[t]) for t in STORES])
        + "\n) as v (s, n, c, p);\n"
    )
    parts.append(
        "-- REP-04, DIF-03: the iFood coupon is co-funded half and half until 20/set; the 99Food promotion is the "
        "store's own.\ninsert into public.campaign (id, account_id, channel_store_id, name, discount_pct, "
        "channel_share_pct, starts_on, ends_on)\nselect pg_temp.sid('G-02:camp:' || s), pg_temp.sid('G-02'), "
        "pg_temp.sid('G-02:' || s), n, d, c, a::date, b::date from (values\n"
        + values([(t, *(IFOOD_CAMPAIGN if STORES[t][1] == "ifood" else F99_CAMPAIGN)) for t in STORES])
        + "\n) as v (s, n, d, c, a, b);\n"
    )
    parts.append(
        MAPPINGS_SQL.format(
            ifood_sig=signature(IFOOD_HEADERS),
            ifood_map=json.dumps(IFOOD_MAPPING.to_json(), ensure_ascii=False),
            f99_sig=signature(F99_V1_HEADERS),
            f99_map=json.dumps(F99_MAPPING.to_json(), ensure_ascii=False),
        )
    )
    parts.append(SOURCES_SQL)
    parts.append(
        "-- C07: import history (D31), 214 runs since 10/out; the newest seven as drawn.\n"
        "insert into public.import_run (id, account_id, source_id, trigger, channel, store_ids, period_start, "
        "period_end, file_path, file_name, rows_total, rows_new, rows_duplicate, duration_ms, status, log, "
        "created_by, created_at)\nselect pg_temp.sid(t), pg_temp.ref(a), pg_temp.ref(src), tr::public.import_trigger, "
        "ch::public.channel, ids::uuid[], ps::date, pe::date, fp, fn, rt::int, rn::int, rd::int, dur::int, "
        "st::public.import_status, lg::jsonb, pg_temp.ref(cb), ca::timestamptz from (values\n"
        + values(runs)
        + "\n) as v (t, a, src, tr, ch, ids, ps, pe, fp, fn, rt, rn, rd, dur, st, lg, cb, ca);\n"
    )
    parts.append(
        "-- Canonical rows of the September statements: what worker-import reads from fixtures/m2.\n"
        "-- m2_order: store, order, ordered at (São Paulo), gross, items, delivery fee, discounts (store, app),\n"
        "-- c(oncluído) or x (cancelado), cancelled by, reason, i(Food) or n(99Food) run, expected payment date,\n"
        "-- then the signed commission, payment fee, delivery, promotion and anticipation entries.\n"
        "create temp table m2_order (store text, ext text, at text, gross bigint, items bigint, fee bigint, "
        "d_store bigint, d_chan bigint, st text, cancelled_by public.cancel_party, reason text, run text, "
        "expected date, commission bigint, payment_fee bigint, delivery bigint, promotion bigint, "
        "anticipation bigint);\ninsert into m2_order values\n" + values(order_rows, "") + ";\n"
    )
    parts.append(
        "create temp table m2_payout (store text, ext text, key text, amount bigint, paid date, raw text);\n"
        "insert into m2_payout values\n" + values(payout_rows, "") + ";\n"
    )
    parts.append(FACTS_SQL)
    parts.append(
        "-- C08: the September close of Grupo Exemplo (margo_import.close on the rows above).\n"
        "insert into public.close_period (id, account_id, kitchen_id, month, status) values "
        f"(pg_temp.sid({q(cp)}), pg_temp.sid('G-02'), null, '2026-09-01', 'open');\n"
        "insert into public.close_line (account_id, close_period_id, channel_store_id, gross_cents, "
        "commission_cents, payment_cents, delivery_cents, promotion_cents, anticipation_cents, payout_cents)\n"
        "select pg_temp.sid('G-02'), pg_temp.sid("
        + q(cp)
        + "), pg_temp.sid('G-02:' || s), g, c, p, d, pr, a, r "
        "from (values\n" + values([line[1:] for line in lines]) + "\n) as v (s, g, c, p, d, pr, a, r);\n"
    )
    parts.append(
        "-- C09: differences found by DIF-01 to DIF-04, and the orders behind each.\n"
        "insert into public.difference (id, account_id, close_period_id, channel_store_id, rule_id, finding_key, "
        "description, orders_count, amount_cents, confidence, shown, detail)\n"
        "select pg_temp.sid(t), pg_temp.sid('G-02'), pg_temp.sid("
        + q(cp)
        + "), pg_temp.sid('G-02:' || s), r, k, "
        "dsc, n, a, c::public.difference_confidence, sh, dt::jsonb from (values\n"
        + values(diffs)
        + "\n) as v (t, s, r, k, dsc, n, a, c, sh, dt);\n"
    )
    parts.append(
        "insert into public.difference_order (account_id, difference_id, order_fact_id, amount_cents)\n"
        "select pg_temp.sid('G-02'), pg_temp.sid(t), o::uuid, a from (values\n"
        + values(diff_orders)
        + "\n) as v (t, o, a);\n"
    )
    parts.append(contest_sql(contests))
    return "\n".join(parts)


def contest_sql(contests: list[tuple[object, ...]]) -> str:
    rows = [(t, st, dl, txt) for t, st, dl, txt, *_ in contests]
    s = (
        "-- C16, P12: contestations as drawn on 30/out, moved through public.contestation_mark (04 §3).\n"
        "insert into public.contestation (id, account_id, difference_id, status, deadline_on, claim_text)\n"
        "select pg_temp.sid(t || ':c'), pg_temp.sid('G-02'), pg_temp.sid(t), st::public.contestation_status, dl::date, txt "
        "from (values\n" + values(rows) + "\n) as v (t, st, dl, txt);\n"
    )
    by = {(r, store): t for t, _, _, _, r, store in contests}
    dif01, dif02 = by[("DIF-01", "s1")], by[("DIF-02", "s4")]
    s += f"""
-- DIF-01: the Dono contested on 02/out, protocol 48213 (C16, P12).
select public.contestation_mark(pg_temp.sid({q(dif01 + ":c")}), 'ja_contestei', 'person', pg_temp.sid('p:g02-dono'),
  '48213', null, '2026-10-02 10:15-03');
-- DIF-02 iFood: contested on 03/out; the R$ 238,00 credit came in the repasse of 14/out (MargoAI marked it).
insert into public.ledger_entry (id, account_id, channel_store_id, external_entry_id, entry_date, type, raw_type, amount_cents)
values (pg_temp.sid('entry:s4:AJ-20261014-0238'), pg_temp.sid('G-02'), pg_temp.sid('G-02:s4'), 'AJ-20261014-0238',
  '2026-10-14', 'adjustment', 'ajuste de contestação', 23800);
select public.contestation_mark(pg_temp.sid({q(dif02 + ":c")}), 'ja_contestei', 'person', pg_temp.sid('p:g02-dono'),
  null, null, '2026-10-03 09:40-03');
select public.contestation_mark(pg_temp.sid({q(dif02 + ":c")}), 'credito_encontrado', 'system', null, null,
  pg_temp.sid('entry:s4:AJ-20261014-0238'), '2026-10-14 06:10-03');
"""
    return s


def history(v2_log: dict[str, object], p_ifood: Parsed, p_f99: Parsed) -> list[tuple[object, ...]]:
    """214 runs: the eight drawn in C07 (minus the invoices row, which is module 3), the two September
    uploads behind the canonical rows, and daily API runs back to 10/out."""
    ifood5 = "{" + ",".join(str(sid(f"G-02:{t}")) for t in ("s1", "s2", "s4", "s6", "s7")) + "}"
    ifood3 = "{" + ",".join(str(sid(f"G-02:{t}")) for t in ("s1", "s2", "s4")) + "}"
    f99 = "{" + ",".join(str(sid(f"G-02:{t}")) for t in ("s3", "s5")) + "}"
    api, ext, up_if, up_99, bpo = (
        "@G-02:src:ifood-api",
        "@G-02:src:ifood-ext",
        "@G-02:src:ifood-up",
        "@G-02:src:99-up",
        "@G-02:src:99-bpo",
    )

    def ts(s: str) -> datetime:
        return datetime.fromisoformat(s).replace(tzinfo=SAO_PAULO)

    def log(**kw: object) -> str:
        return json.dumps(kw, ensure_ascii=False)

    rows: list[tuple[object, ...]] = [
        (
            "run:30-api",
            "@G-02",
            api,
            "schedule",
            "ifood",
            ifood5,
            date(2026, 10, 24),
            date(2026, 10, 30),
            None,
            None,
            1204,
            None,
            None,
            None,
            "running",
            log(source="API conciliação", progress=60),
            None,
            ts("2026-10-30 06:00"),
        ),
        (
            "run:29-ext",
            "@G-02",
            ext,
            "extension",
            "ifood",
            ifood5,
            date(2026, 10, 1),
            date(2026, 10, 31),
            None,
            None,
            3880,
            3880,
            0,
            40_000,
            "ok",
            log(source="vendas por item"),
            None,
            ts("2026-10-29 21:14"),
        ),
        (
            "run:29-api",
            "@G-02",
            api,
            "schedule",
            "ifood",
            ifood5,
            date(2026, 10, 23),
            date(2026, 10, 29),
            None,
            None,
            1187,
            1187,
            0,
            120_000,
            "ok",
            log(source="API conciliação"),
            None,
            ts("2026-10-29 06:00"),
        ),
        (
            run_key("run:99food-set-v2"),
            "@G-02",
            up_99,
            "upload",
            "food99",
            f99,
            date(2026, 9, 1),
            date(2026, 9, 30),
            "imports/G-02/99food-set-v2/extrato-99food-set.xlsx",
            "extrato-99food-set.xlsx",
            1022,
            None,
            None,
            8_000,
            "needs_mapping",
            json.dumps(v2_log, ensure_ascii=False),
            "@p:manuel",
            ts("2026-10-28 15:02"),
        ),
        (
            "run:28-api-rep",
            "@G-02",
            api,
            "schedule",
            "ifood",
            ifood5,
            date(2026, 10, 1),
            date(2026, 10, 31),
            None,
            None,
            9,
            9,
            0,
            5_000,
            "ok",
            log(source="API repasses"),
            None,
            ts("2026-10-28 06:00"),
        ),
        (
            "run:27-api",
            "@G-02",
            api,
            "schedule",
            "ifood",
            ifood5,
            date(2026, 10, 21),
            date(2026, 10, 27),
            None,
            None,
            0,
            0,
            0,
            1_000,
            "failed",
            log(source="API conciliação", reason="token_expired"),
            None,
            ts("2026-10-27 06:00"),
        ),
        (
            "run:26-bpo",
            "@G-02",
            bpo,
            "upload",
            "food99",
            f99,
            date(2026, 8, 1),
            date(2026, 8, 31),
            None,
            "extrato.xlsx",
            988,
            988,
            0,
            7_000,
            "ok",
            log(),
            None,
            ts("2026-10-26 18:40"),
        ),
        (
            run_key("run:99food-set-v1"),
            "@G-02",
            bpo,
            "upload",
            "food99",
            f99,
            date(2026, 9, 1),
            date(2026, 9, 30),
            f"imports/G-02/99food-set-v1/{F99_V1}",
            F99_V1,
            p_f99.rows_in_file,
            p_f99.rows_in_file,
            0,
            9_000,
            "ok",
            log(
                mapping="gsyn-sintetico-v1",
                payout_total_file_cents=p_f99.payout_total_file_cents,
                payout_total_mapped_cents=p_f99.payout_total_mapped_cents,
            ),
            None,
            ts("2026-10-12 18:20"),
        ),
        (
            run_key("run:ifood-set"),
            "@G-02",
            up_if,
            "upload",
            "ifood",
            ifood3,
            date(2026, 9, 1),
            date(2026, 9, 30),
            f"imports/G-02/ifood-set/{IFOOD_CSV}",
            IFOOD_CSV,
            p_ifood.rows_in_file,
            p_ifood.rows_in_file,
            0,
            6_000,
            "ok",
            log(
                mapping="gsyn-sintetico-v1",
                payout_total_file_cents=p_ifood.payout_total_file_cents,
                payout_total_mapped_cents=p_ifood.payout_total_mapped_cents,
            ),
            "@p:marlon",
            ts("2026-10-10 05:30"),
        ),
    ]
    # Daily API runs, one per authorized iFood store and report, from 26/out back to 10/out.
    rng = random.Random(214)
    slots = [
        (f"06:{2 * i:02d}", t, report)
        for i, (t, report) in enumerate(
            [
                (t, r)
                for r in ("API conciliação", "API repasses", "API antecipações")
                for t in ("s1", "s2", "s4", "s6", "s7")
            ]
        )
    ]
    day = date(2026, 10, 26)
    while len(rows) < 214:
        for hh, t, report in slots:
            if len(rows) >= 214 or (day == date(2026, 10, 26) and report != "API conciliação"):
                continue
            n = rng.randint(180, 260) if report == "API conciliação" else rng.randint(0, 3)
            rows.append(
                (
                    f"run:{day.isoformat()}-{hh}",
                    "@G-02",
                    api,
                    "schedule",
                    "ifood",
                    "{" + str(sid(f"G-02:{t}")) + "}",
                    day - timedelta(days=6),
                    day,
                    None,
                    None,
                    n,
                    n,
                    0,
                    rng.randint(1_000, 40_000),
                    "ok",
                    log(source=report),
                    None,
                    ts(f"{day.isoformat()} {hh}"),
                )
            )
        day -= timedelta(days=1)
    assert min(r[-1] for r in rows).date() >= date(2026, 10, 10), min(r[-1] for r in rows)
    return rows


def run_key(tag: str) -> str:
    return tag


SEED_HEAD = """-- G-SYN, module 2: Grupo Exemplo's September 2026 close (C07, C08, C09, C16, C17, C19, P06). SINTÉTICO.
-- GENERATED by fixtures/m2/generate.py from the synthetic statements in fixtures/m2: do not edit by hand.
-- Canonical rows are what worker-import reads from those files; close and differences are what
-- margo_import.close computes from them. Loaded after g_syn.sql (./seed/*.sql).
--
-- Choices where drawings disagree (questions for Marlon):
--   The close is Grupo Exemplo's (G-02), with its 2 iFood + 2 99Food... stores; C08, C09, C16, C17 and P06 call the
--   group "Pantanos Burguer", which has a single iFood store in g_syn.sql.
--   Drawn deadlines (15/nov, 20/nov, 22/nov) do not follow the 30-day default of 04 §3; they are seeded as drawn.
--   The 28/out 99Food upload is a second export of September in a changed layout: after C17 maps it, every row
--   is a duplicate of the 05/out import, so the close does not change.

create or replace function pg_temp.sid(tag text) returns uuid language sql immutable as $$ select md5('g-syn:' || tag)::uuid $$;
-- "@tag" in the value lists below is pg_temp.sid('tag').
create or replace function pg_temp.ref(v text) returns uuid language sql immutable as $$
  select case when v is null then null when left(v, 1) = '@' then pg_temp.sid(substr(v, 2)) else v::uuid end $$;
"""

MAPPINGS_SQL = """-- C17: the layouts already known. Synthetic (gsyn-sintetico-v1), not the real portal layouts.
insert into public.column_mapping (id, channel, file_signature, name, mapping, created_by, created_at) values
  (pg_temp.sid('map:ifood-v1'), 'ifood', '{ifood_sig}', 'gsyn-sintetico-v1', '{ifood_map}', pg_temp.sid('p:marlon'), '2026-10-10 05:00-03'),
  (pg_temp.sid('map:99food-v1'), 'food99', '{f99_sig}', 'gsyn-sintetico-v1', '{f99_map}', pg_temp.sid('p:marlon'), '2026-10-10 05:00-03');
"""

SOURCES_SQL = """-- C07 source cards.
insert into public.import_source (id, account_id, channel, kind, schedule_cron, last_ok_at, stale_after_hours) values
  (pg_temp.sid('G-02:src:ifood-api'), pg_temp.sid('G-02'), 'ifood', 'api', '0 6 * * *', '2026-10-29 06:02-03', 30),
  (pg_temp.sid('G-02:src:ifood-ext'), pg_temp.sid('G-02'), 'ifood', 'extension', null, '2026-10-29 21:14-03', 72),
  (pg_temp.sid('G-02:src:ifood-up'), pg_temp.sid('G-02'), 'ifood', 'upload', null, '2026-10-10 05:31-03', null),
  (pg_temp.sid('G-02:src:99-up'), pg_temp.sid('G-02'), 'food99', 'upload', null, null, null),
  (pg_temp.sid('G-02:src:99-bpo'), pg_temp.sid('G-02'), 'food99', 'bpo_folder', null, '2026-10-26 18:40-03', null);
"""

RAW = {
    "commission": "comissão",
    "payment_fee": "taxa de pagamento",
    "delivery": "entrega",
    "promotion": "promoção paga pela loja",
    "anticipation": "antecipação",
}

FACTS_SQL = """create temp table m2_run (run text, id uuid);
insert into m2_run values ('i', pg_temp.sid('run:ifood-set')), ('n', pg_temp.sid('run:99food-set-v1'));

insert into public.order_fact (id, account_id, channel_store_id, external_order_id, ordered_at, gross_cents, items_cents,
  delivery_fee_cents, discount_store_cents, discount_channel_cents, status, cancelled_by, cancel_reason, import_run_id, created_at)
select pg_temp.sid('order:' || o.store || ':' || o.ext), pg_temp.sid('G-02'), pg_temp.sid('G-02:' || o.store), o.ext,
  (o.at || '-03')::timestamptz, o.gross, o.items, o.fee, o.d_store, o.d_chan,
  case o.st when 'c' then 'concluido' else 'cancelado' end::public.order_status, o.cancelled_by, o.reason, r.id, ir.created_at
from m2_order o join m2_run r using (run) join public.import_run ir on ir.id = r.id;

insert into public.ledger_entry (id, account_id, channel_store_id, external_entry_id, order_fact_id, entry_date,
  expected_payment_date, type, raw_type, amount_cents, import_run_id, created_at)
select pg_temp.sid('entry:' || o.store || ':' || o.ext || ':' || t.type), pg_temp.sid('G-02'), pg_temp.sid('G-02:' || o.store),
  o.ext || ':' || t.type, pg_temp.sid('order:' || o.store || ':' || o.ext), left(o.at, 10)::date, o.expected,
  t.type::public.ledger_type, t.raw, t.amount, r.id, ir.created_at
from m2_order o join m2_run r using (run) join public.import_run ir on ir.id = r.id
cross join lateral (values
  ('commission', o.commission, 'comissão'), ('payment_fee', o.payment_fee, 'taxa de pagamento'),
  ('delivery', o.delivery, 'entrega'), ('promotion', o.promotion, 'promoção paga pela loja'),
  ('anticipation', o.anticipation, 'antecipação')
) as t (type, amount, raw)
where t.amount <> 0;

insert into public.ledger_entry (id, account_id, channel_store_id, external_entry_id, order_fact_id, entry_date,
  expected_payment_date, type, raw_type, amount_cents, import_run_id, created_at)
select pg_temp.sid('entry:' || p.store || ':' || p.key), pg_temp.sid('G-02'), pg_temp.sid('G-02:' || p.store), p.key,
  pg_temp.sid('order:' || p.store || ':' || p.ext), p.paid, o.expected, 'payout', p.raw, p.amount, r.id, ir.created_at
from m2_payout p join m2_order o on o.store = p.store and o.ext = p.ext
join m2_run r on r.run = o.run join public.import_run ir on ir.id = r.id;
drop table m2_order, m2_payout, m2_run;
"""


if __name__ == "__main__":
    main()
