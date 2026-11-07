#!/usr/bin/env python3
"""Writes supabase/seed/g_syn_m1.sql: the G-SYN price X-ray of Pantanos Burguer, 28/out/2026 (03 §6, D46).

The canonical rows (public stores, their menu items, the founder's C03 and C04 decisions, expected weekly
units) are written here by hand to reproduce every number drawn in C03 to C06 and P01. The derived rows
(`xray_store`, `xray_item`, `xray_pair` and the calculated columns) are produced by the worker's own
functions (margo_collector.xray), and the script stops if any drawn number does not come out.

    uv run python scripts/gen_g_syn_m1.py           write the file
    uv run python scripts/gen_g_syn_m1.py --check   exit 1 if the file is not what the script writes
"""

from __future__ import annotations

import hashlib
import math
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from zoneinfo import ZoneInfo

from margo_collector.rules import (
    EARTH_RADIUS_M,
    Item,
    Settings,
    Store,
    percent_label,
    round_half_away,
    to_numeric,
)
from margo_collector.xray import CalcInput, build_neighborhood, build_pairs, calculate

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "supabase" / "seed" / "g_syn_m1.sql"
SP = ZoneInfo("America/Sao_Paulo")


def sid(tag: str) -> str:
    """Same ids as pg_temp.sid() in g_syn.sql: md5('g-syn:' || tag)::uuid."""
    return str(uuid.UUID(hashlib.md5(f"g-syn:{tag}".encode()).hexdigest()))


ACCOUNT = sid("G-01")
KITCHEN = sid("G-01:igapo")
MARLON = sid("p:marlon")
XRAY = sid("m1:xray:G-01")
TARGET_EXTERNAL_ID = "91a9c35d-0000-4000-8000-000000000000"  # channel_store of G-01 (g_syn.sql)
TARGET_LAT, TARGET_LNG = Decimal("-23.338000"), Decimal("-51.158000")
CREATED = datetime(2026, 10, 28, 9, 30, tzinfo=SP)
COLLECTED = datetime(2026, 10, 28, 10, 0, tzinfo=SP)
REVIEWED = datetime(2026, 10, 28, 11, 0, tzinfo=SP)
DELIVERED = datetime(2026, 10, 28, 16, 0, tzinfo=SP)
CATEGORIES = ["Lanches", "Hambúrguer", "Porções"]
RULES = {
    "exclude_closed": True,
    "exclude_national_chains": True,
    "same_neighborhood_only": False,
    "closed_days": 30,
    "min_pairs": 5,
    "similarity_threshold": "0.75",
    "candidate_floor": "0.6",
    "reading_band": "0.1",
}
SETTINGS = Settings.from_xray(3, RULES)


# Stores -------------------------------------------------------------------------------------------


@dataclass
class StoreSpec:
    tag: str
    name: str
    category: str
    distance_m: int
    chain: bool = False
    closed_days: int | None = None
    manual: str | None = None
    lat: Decimal = Decimal(0)
    lng: Decimal = Decimal(0)
    external_id: str = ""
    items: list[tuple[str, str, int, str, Decimal | None]] = field(default_factory=list)


def destination(distance_m: float, bearing_deg: float) -> tuple[Decimal, Decimal]:
    p1, l1 = math.radians(float(TARGET_LAT)), math.radians(float(TARGET_LNG))
    d, t = distance_m / EARTH_RADIUS_M, math.radians(bearing_deg)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(t))
    l2 = l1 + math.atan2(math.sin(t) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    q = Decimal("0.000001")
    return Decimal(math.degrees(p2)).quantize(q), Decimal(math.degrees(l2)).quantize(q)


def build_stores() -> list[StoreSpec]:
    # C03 as drawn: the first eight rows, in the drawing's order.
    drawn = [
        StoreSpec("01", "Loja vizinha 01", "Hambúrguer", 400),
        StoreSpec("02", "Loja vizinha 02", "Lanches", 900),
        StoreSpec("03", "Loja vizinha 03", "Hambúrguer", 1200),
        StoreSpec("rede-X", "Rede nacional X", "Hambúrguer", 1500, chain=True),
        StoreSpec("05", "Loja vizinha 05", "Porções", 1800),
        StoreSpec("06", "Loja vizinha 06", "Lanches", 2300, closed_days=40),
        StoreSpec("07", "Loja vizinha 07", "Hambúrguer", 2600),
        StoreSpec("08", "Loja vizinha 08", "Pizza", 2900, manual="manual: outra categoria"),
    ]
    closed = {12: 35, 19: 45, 27: 52, 33: 61, 41: 33, 48: 90, 56: 120, 63: 38, 71: 47, 88: 75}
    manual = {15: ("Pizza", "manual: outra categoria"), 66: ("Japonesa", "manual: outra categoria")}
    cycle = ["Hambúrguer", "Lanches", "Porções"]
    others: list[StoreSpec] = []
    for n in range(9, 100):
        cat, why = manual.get(n, (cycle[n % 3], None))
        others.append(
            StoreSpec(f"{n:02d}", f"Loja vizinha {n:02d}", cat, 0, closed_days=closed.get(n), manual=why)
        )
    for letter in "YZWVUTSR":
        others.append(StoreSpec(f"rede-{letter}", f"Rede nacional {letter}", "Hambúrguer", 0, chain=True))
    # Spread the others between 300 m and 2980 m, interleaving chains among the neighbors.
    others.sort(key=lambda s: hashlib.md5(s.tag.encode()).hexdigest())
    for i, s in enumerate(others):
        s.distance_m = 300 + round(i * 2680 / (len(others) - 1))
    far = [
        StoreSpec(f"longe-{i}", f"Loja longe {i}", "Lanches", d)
        for i, d in enumerate([3150, 3400, 3800, 4200, 4700], 1)
    ]
    stores = drawn + others + far
    golden = 137.50776405
    for i, s in enumerate(stores):
        s.lat, s.lng = destination(s.distance_m, (i * golden) % 360)
        s.external_id = str(uuid.UUID(hashlib.md5(f"g-syn:m1:ifood:{s.tag}".encode()).hexdigest()))
    return stores


def as_store(s: StoreSpec) -> Store:
    seen = COLLECTED - timedelta(days=s.closed_days) if s.closed_days else COLLECTED
    return Store(sid(f"m1:store:{s.tag}"), s.name, s.category, s.lat, s.lng, seen, s.chain)


# Menu items ---------------------------------------------------------------------------------------


@dataclass
class OwnSpec:
    code: str
    name: str
    price: int
    parity: int
    weekly_units: int
    k: int
    names: list[str]
    unit: str = "un"
    qty: int | None = None
    sizes: list[int] | None = None


# Pantanos Burguer, 24 items. Drawn in C04, C05, P01: refri, batata, milk, smash2, xbacon, combo, sundae,
# molho, agua (with comparables 80, 72, 33, 61, 12, 9, 4). The others are filled in so the drawn totals hold
# (7 below parity, 5 above, 12 in the band; Pareto 31, 53, 67, 75, 78, 80 percent).
AUTO = [
    OwnSpec(
        "refri",
        "Refrigerante lata 350 ml",
        500,
        650,
        103,
        80,
        ["Refrigerante lata 350 ml", "Refrigerante em lata 350 ml"],
    ),
    OwnSpec(
        "batata",
        "Batata frita média",
        1490,
        1840,
        62,
        72,
        ["Batata frita média", "Batata frita"],
        "g",
        300,
        [300, 400, 500, 250],
    ),
    OwnSpec("milk", "Milkshake 400 ml", 1690, 1990, 33, 33, ["Milkshake"], "ml", 400, [400, 500, 300, 700]),
    OwnSpec("agua", "Água 500 ml", 450, 520, 80, 40, ["Água 500 ml", "Água mineral 500 ml"]),
    OwnSpec("aneis", "Anéis de cebola", 1690, 1890, 7, 25, ["Anéis de cebola", "Anel de cebola"]),
    OwnSpec("smash2", "Smash duplo", 2990, 3050, 20, 45, ["Smash duplo", "Smash burger duplo"]),
    OwnSpec("smash1", "Smash simples", 2290, 2390, 13, 38, ["Smash simples", "Smash burger simples"]),
    OwnSpec("salada", "X-Salada", 2490, 2590, 12, 52, ["X-Salada", "X Salada"]),
    OwnSpec("egg", "X-Egg", 2590, 2690, 11, 30, ["X-Egg", "X Egg"]),
    OwnSpec("cheese", "Cheeseburger", 2190, 2290, 13, 50, ["Cheeseburger"]),
    OwnSpec("frango", "Frango crispy", 2790, 2890, 12, 27, ["Frango crispy", "Burger de frango crispy"]),
    OwnSpec(
        "veg",
        "Burger vegetariano",
        2690,
        2790,
        10,
        18,
        ["Burger vegetariano", "Burger vegetariano artesanal"],
    ),
    OwnSpec(
        "suco", "Suco natural 500 ml", 990, 1050, 20, 24, ["Suco natural 500 ml", "Suco natural copo 500 ml"]
    ),
    OwnSpec(
        "guarana", "Guaraná 2 litros", 1290, 1390, 13, 44, ["Guaraná 2 litros", "Guaraná garrafa 2 litros"]
    ),
    OwnSpec("brownie", "Brownie", 890, 950, 15, 21, ["Brownie"]),
    OwnSpec("petit", "Petit gâteau", 1490, 1540, 17, 15, ["Petit gâteau", "Petit gateau"]),
    OwnSpec("casa", "Hambúrguer da casa", 3290, 3190, 25, 35, ["Hambúrguer da casa"]),
    OwnSpec(
        "xbacon",
        "X-Bacon artesanal",
        3690,
        3150,
        30,
        61,
        ["X-Bacon artesanal", "Bacon burger artesanal", "Burger bacon artesanal"],
    ),
    OwnSpec("costela", "Costela burger", 3990, 3590, 9, 26, ["Costela burger", "Burger de costela"]),
    OwnSpec("bacon2", "Bacon duplo", 3490, 3150, 10, 33, ["Bacon duplo", "Burger bacon duplo"]),
    OwnSpec("acai", "Açaí 500 ml", 2290, 2050, 14, 29, ["Açaí 500 ml", "Acai 500 ml"]),
]
# Items a founder reviewed in C04 on 28/out: (name, price, accepted).
REVIEWED_ITEMS = {
    "sundae": (
        OwnSpec("sundae", "Sundae", 1190, 1340, 12, 4, []),
        [
            ("Sundae", 1340, True),
            ("Sundae", 1390, True),
            ("Sundae de chocolate", 1290, True),
            ("Sundae de chocolate", 1690, False),
        ],
    ),
    "molho": (
        OwnSpec("molho", "Molho especial extra", 350, 400, 32, 9, []),
        [
            ("Molho especial", 400, True),
            ("Molho extra", 390, True),
            ("Molho especial", 410, True),
            ("Molho extra", 380, True),
            ("Maionese especial extra", 420, True),
            ("Maionese especial extra", 600, False),
            ("Maionese especial extra", 650, False),
            ("Maionese especial extra", 700, False),
            ("Maionese especial extra", 250, False),
        ],
    ),
    "combo": (
        OwnSpec("combo", "Combo casal", 7990, 6990, 8, 12, [], "pack"),
        [("Combo casal", p, True) for p in (6490, 6690, 6890, 6990, 7190, 7290, 7490)]
        + [("Combo casal premium", p, False) for p in (9990, 10490, 11990)]
        + [("Combo para casal", p, False) for p in (5490, 12990)],
    ),
}
OWN_ORDER = [
    "xbacon",
    "batata",
    "refri",
    "milk",
    "combo",
    "molho",
    "sundae",
    "smash2",
    "smash1",
    "salada",
    "egg",
    "cheese",
    "frango",
    "veg",
    "casa",
    "costela",
    "bacon2",
    "aneis",
    "agua",
    "suco",
    "guarana",
    "acai",
    "brownie",
    "petit",
]
# M1-04: the menu section of each item (public_menu_item.category), not drawn; the others are "Lanches".
SECTIONS = {
    "refri": "Bebidas",
    "agua": "Bebidas",
    "suco": "Bebidas",
    "guarana": "Bebidas",
    "batata": "Porções",
    "aneis": "Porções",
    "milk": "Sobremesas",
    "sundae": "Sobremesas",
    "acai": "Sobremesas",
    "brownie": "Sobremesas",
    "petit": "Sobremesas",
    "molho": "Adicionais",
    "combo": "Combos",
}
NOISE = ["Pizza calabresa", "Pastel de carne", "Coxinha", "Esfiha de carne", "Tapioca"]


def section_of(ext: str) -> str | None:
    """The section of an item from its code ("refri-001"); the noise rows ("outro") have none."""
    code = ext.split("-")[0]
    return None if code == "outro" else SECTIONS.get(code, "Lanches")


def size_ml(name: str) -> int | None:
    """M1-04: public_menu_item.size_from_name_ml of a seed name, which the database computes with
    app.size_from_name_m1_03. Written out because this script runs without a database;
    test_b01_xray_db checks the worker gets the same pairs from the column."""
    return {
        "Refrigerante lata 350 ml": 350,
        "Refrigerante em lata 350 ml": 350,
        "Água 500 ml": 500,
        "Água mineral 500 ml": 500,
        "Suco natural 500 ml": 500,
        "Suco natural copo 500 ml": 500,
        "Guaraná 2 litros": 2000,
        "Guaraná garrafa 2 litros": 2000,
    }.get(name)


def step_for(parity: int) -> int:
    return 10 if parity < 1000 else 20 if parity < 3000 else 50


def spread(target: Fraction, k: int, step: Fraction) -> list[Fraction]:
    """k values whose median is exactly `target`: the middle one (odd k) or two (even k) equal it."""
    mid = [target] if k % 2 else [target, target]
    side = (k - len(mid)) // 2
    return (
        [target - step * j for j in range(side, 0, -1)]
        + mid
        + [target + step * j for j in range(1, side + 1)]
    )


def auto_candidates(o: OwnSpec) -> list[tuple[str, int, str, Decimal | None]]:
    """(name, price, unit, unit_qty) of the comparable items of an automatically paired item."""
    out = []
    if o.unit == "un":
        for j, v in enumerate(spread(Fraction(o.parity), o.k, Fraction(step_for(o.parity)))):
            out.append((o.names[j % len(o.names)], int(v), "un", None))
        return out
    assert o.qty and o.sizes
    # Steps of 1/(2k) of the target keep every price positive and the order intact after rounding.
    per_base = spread(Fraction(o.parity, o.qty), o.k, Fraction(o.parity, o.qty) / (2 * o.k))
    mid = {o.k // 2, (o.k - 1) // 2}
    for j, v in enumerate(per_base):
        size = o.qty if j in mid else o.sizes[j % len(o.sizes)]
        out.append(
            (f"{o.names[j % len(o.names)]} {size} {o.unit}", round_half_away(v * size), o.unit, Decimal(size))
        )
    return out


# Build --------------------------------------------------------------------------------------------


@dataclass
class Seed:
    stores: list[StoreSpec]
    target: Store
    own: list[Item]
    own_specs: dict[str, OwnSpec]
    pool_items: list[Item]
    sql: str = ""


def build() -> Seed:
    stores = build_stores()
    inside = [s for s in stores if s.distance_m <= 3000]
    target = Store(
        sid("m1:store:pantanos"), "Pantanos Burguer", "Lanches", TARGET_LAT, TARGET_LNG, COLLECTED, False
    )

    # Which stores end in the set (rules plus manual), to place comparable items there.
    manual = {as_store(s).id: (False, s.manual) for s in stores if s.manual}
    hood = build_neighborhood(
        target, [as_store(s) for s in stores], collected_at=COLLECTED, settings=SETTINGS, manual=manual
    )
    included_ids = {r.public_store_id for r in hood if r.included}
    by_id = {as_store(s).id: s for s in stores}
    in_set = sorted((by_id[i] for i in included_ids), key=lambda s: (s.distance_m, s.tag))
    out_of_set = [s for s in stores if as_store(s).id not in included_ids]

    own_specs = {o.code: o for o in AUTO} | {code: spec for code, (spec, _) in REVIEWED_ITEMS.items()}
    own_items = []
    for code in OWN_ORDER:
        o = own_specs[code]
        unit_qty = Decimal(o.qty) if o.qty else None
        own_items.append(
            Item(
                sid(f"m1:own:{code}"),
                target.id,
                o.name,
                o.price,
                o.unit,  # type: ignore[arg-type]
                unit_qty,
                section=section_of(code),
                size_from_name_ml=size_ml(o.name),
            )
        )

    decisions: dict[tuple[str, str], tuple[bool, str]] = {}
    offset = 0
    for code in OWN_ORDER:
        o = own_specs[code]
        if code in REVIEWED_ITEMS:
            cands = [(n, p, o.unit, None, acc) for n, p, acc in REVIEWED_ITEMS[code][1]]
        else:
            cands = [(n, p, u, q, None) for n, p, u, q in auto_candidates(o)]
        for j, (name, price, unit, qty, accepted) in enumerate(cands):
            s = in_set[(offset + j * 5) % len(in_set)]
            ext = f"{code}-{j + 1:03d}"
            s.items.append((ext, name, price, unit, qty))
            if accepted is not None:
                decisions[(sid(f"m1:own:{code}"), sid(f"m1:item:{s.tag}:{ext}"))] = (accepted, MARLON)
        offset += 11
    # Items in excluded and far stores: they would move the parity if those stores were in the set.
    for s in out_of_set:
        s.items.append(("refri-x", "Refrigerante lata 350 ml", 300, "un", None))
        s.items.append(("xbacon-x", "X-Bacon artesanal", 1990, "un", None))
    for i, s in enumerate(in_set):
        s.items.append(("outro", NOISE[i % len(NOISE)], 1500 + 100 * (i % 7), "un", None))
    del inside

    pool_items = [
        Item(
            sid(f"m1:item:{s.tag}:{ext}"),
            as_store(s).id,
            name,
            price,
            unit,  # type: ignore[arg-type]
            qty,
            section=section_of(ext),
            size_from_name_ml=size_ml(name),
        )
        for s in stores
        for ext, name, price, unit, qty in s.items
    ]
    seed = Seed(stores, target, own_items, own_specs, pool_items)
    seed.sql = render_sql(seed, hood, decisions)
    return seed


# Checks against the drawings -----------------------------------------------------------------------


def check_drawn(hood, items, calc, own_by_id) -> None:
    included = [r for r in hood if r.included]
    assert (len(hood), len(included), len(hood) - len(included)) == (107, 84, 23), (
        "C03: 107 found, 84 in the set, 23 out"
    )
    status = {own_by_id[i.public_menu_item_id].name: i for i in items}
    counts = {s: sum(1 for i in items if i.pair_status == s) for s in ("auto", "revisar", "normalizado")}
    assert (len(items), counts["auto"], counts["revisar"], counts["normalizado"]) == (24, 19, 3, 2), counts
    drawn_k = {
        "X-Bacon artesanal": 61,
        "Batata frita média": 72,
        "Refrigerante lata 350 ml": 80,
        "Milkshake 400 ml": 33,
        "Combo casal": 12,
        "Molho especial extra": 9,
        "Sundae": 4,
    }
    for name, k in drawn_k.items():
        assert len(status[name].pairs) == k, (name, len(status[name].pairs))
    assert status["Combo casal"].pair_note == "combos diferentes"
    assert status["Molho especial extra"].pair_note == status["Sundae"].pair_note == "poucos pares"
    rows = {own_by_id[r.key].name: r for r in calc.rows}
    drawn = {
        "Refrigerante lata 350 ml": (500, 650, "−23%"),
        "Batata frita média": (1490, 1840, "−19%"),
        "Milkshake 400 ml": (1690, 1990, "−15%"),
        "Smash duplo": (2990, 3050, "−2%"),
        "X-Bacon artesanal": (3690, 3150, "+17%"),
        "Combo casal": (7990, 6990, "+14%"),
    }
    for name, (own, parity, gap) in drawn.items():
        r = rows[name]
        assert (own_by_id[r.key].price_cents, r.parity_cents, percent_label(r.gap)) == (own, parity, gap), (
            name
        )
    readings = [r.reading for r in calc.rows]
    assert (calc.items_analyzed, readings.count("pode_subir"), readings.count("nao_mexer")) == (24, 7, 5)
    pareto = sorted((r for r in calc.rows if r.pareto_rank), key=lambda r: r.pareto_rank)
    top = [(own_by_id[r.key].name, percent_label(r.pareto_cum_share, signed=False)) for r in pareto[:6]]
    assert top == [
        ("Batata frita média", "31%"),
        ("Refrigerante lata 350 ml", "53%"),
        ("Milkshake 400 ml", "67%"),
        ("Água 500 ml", "75%"),
        ("Sundae", "78%"),
        ("Molho especial extra", "80%"),
    ], top
    assert calc.items_for_80 == 6
    top3 = sorted((r for r in calc.rows if r.reading == "pode_subir"), key=lambda r: -r.loss_cents)[:3]
    assert {own_by_id[r.key].name for r in top3} == {
        "Refrigerante lata 350 ml",
        "Batata frita média",
        "Milkshake 400 ml",
    }


# SQL ----------------------------------------------------------------------------------------------


def lit(v: object) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | Decimal):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v.isoformat()}'"
    if isinstance(v, list):
        return "array[" + ", ".join(lit(x) for x in v) + "]::text[]"
    return "'" + str(v).replace("'", "''") + "'"


def values(rows: list[list[object]]) -> str:
    return ",\n".join("  (" + ", ".join(lit(v) for v in r) + ")" for r in rows)


def render_sql(seed: Seed, hood, decisions) -> str:
    stores, target = seed.stores, seed.target
    own_by_id = {i.id: i for i in seed.own}
    in_set = {r.public_store_id for r in hood if r.included}
    pool = [i for i in seed.pool_items if i.store_id in in_set]
    items = build_pairs(seed.own, pool, SETTINGS, decisions)
    pool_by_id = {i.id: i for i in seed.pool_items}
    item_ids = {i.public_menu_item_id: sid(f"m1:xray_item:{i.public_menu_item_id}") for i in items}
    calc_in = []
    for it in items:
        spec = next(o for o in seed.own_specs.values() if o.name == own_by_id[it.public_menu_item_id].name)
        accepted = tuple(pool_by_id[p.public_menu_item_id] for p in it.pairs if p.accepted)
        calc_in.append(
            CalcInput(
                item_ids[it.public_menu_item_id],
                own_by_id[it.public_menu_item_id],
                accepted,
                spec.weekly_units,
                reviewed=spec.code in REVIEWED_ITEMS,
            )
        )
    calc = calculate(calc_in, SETTINGS.reading_band, SETTINGS.min_pairs)
    check_drawn(hood, items, calc, {item_ids[k]: v for k, v in own_by_id.items()} | own_by_id)
    calc_by_key = {r.key: r for r in calc.rows}

    out = [
        "-- G-SYN, module 1: the price X-ray of Pantanos Burguer of 28/out/2026 (03 §2, §6; C02 to C06, P01).",
        "-- GENERATED by scripts/gen_g_syn_m1.py from hand-written canonical rows; derived rows come from the",
        "-- worker's functions (margo_collector.xray). Do not edit: change the script and run it again.",
        "-- Synthetic (D46): store names, ids, coordinates and prices are fictitious.",
        "",
        "-- Pantanos kitchen, Igapó (Londrina): fictitious coordinates for M1-01.",
        f"update public.kitchen set lat = {TARGET_LAT}, lng = {TARGET_LNG} where id = {lit(KITCHEN)};",
        "",
        "-- Public catalog: the target store, 107 stores within 3 km and 5 beyond.",
        "insert into public.public_store (id, channel, external_id, name, url, area, category, lat, lng, last_seen_open_at, is_national_chain) values",
    ]
    rows: list[list[object]] = [
        [
            target.id,
            "ifood",
            TARGET_EXTERNAL_ID,
            "Pantanos Burguer",
            f"https://www.ifood.com.br/delivery/londrina-pr/pantanos-burguer-igapo/{TARGET_EXTERNAL_ID}",
            "Igapó, Londrina",
            "Lanches",
            TARGET_LAT,
            TARGET_LNG,
            COLLECTED,
            False,
        ]
    ]
    for s in stores:
        st = as_store(s)
        slug = s.name.lower().replace(" ", "-")
        rows.append(
            [
                st.id,
                "ifood",
                s.external_id,
                s.name,
                f"https://www.ifood.com.br/delivery/londrina-pr/{slug}/{s.external_id}",
                "Londrina",
                s.category,
                s.lat,
                s.lng,
                st.last_seen_open_at,
                s.chain,
            ]
        )
    out += [values(rows) + ";", ""]

    out.append(
        "insert into public.public_menu_item (id, public_store_id, external_item_id, name, category, price_cents, unit, unit_qty, collected_at) values"
    )
    rows = [
        [i.id, target.id, f"own-{code}", i.name, section_of(code), i.price_cents, i.unit, i.unit_qty, COLLECTED]
        for code, i in zip(OWN_ORDER, seed.own, strict=True)
    ]
    for s in stores:
        for ext, name, price, unit, qty in s.items:
            rows.append(
                [sid(f"m1:item:{s.tag}:{ext}"), as_store(s).id, ext, name, section_of(ext), price, unit, qty, COLLECTED]
            )
    out += [values(rows) + ";", ""]

    out += [
        '-- The X-ray: delivered on 28/out (C01 "Entregue 28/out").',
        "insert into public.xray (id, account_id, target_store_id, radius_km, categories, rules, status, collected_at, delivered_at, created_by, created_at) values",
        "  ("
        + ", ".join(
            [
                lit(XRAY),
                lit(ACCOUNT),
                lit(target.id),
                "3",
                lit(CATEGORIES),
                lit(_json(RULES)) + "::jsonb",
                "'delivered'",
                lit(COLLECTED),
                lit(DELIVERED),
                lit(MARLON),
                lit(CREATED),
            ]
        )
        + ");",
        "",
        "-- C03: neighborhood (M1-01) and competitive set (M1-02); 3 stores taken out by hand.",
        "insert into public.xray_store (id, xray_id, public_store_id, distance_m, included, exclusion_reason) values",
    ]
    out += [
        values(
            [
                [
                    sid(f"m1:xray_store:{r.public_store_id}"),
                    XRAY,
                    r.public_store_id,
                    r.distance_m,
                    r.included,
                    r.exclusion_reason,
                ]
                for r in hood
            ]
        )
        + ";",
        "",
    ]

    out.append("-- C04, C05: items (M1-03, M1-04) and their calculation (M1-05 to M1-08).")
    out.append(
        "insert into public.xray_item (id, xray_id, public_menu_item_id, norm_unit, norm_price_cents, parity_cents, gap_pct, "
        "loss_cents, reading, pair_status, pair_note, item_category, weekly_units, reviewed_by, reviewed_at, pareto_rank, "
        "pareto_cum_share, parity_full_cents, gap_full_pct, full_price_room) values"
    )
    rows = []
    for it in items:
        key = item_ids[it.public_menu_item_id]
        c = calc_by_key[key]
        spec = next(o for o in seed.own_specs.values() if o.name == own_by_id[it.public_menu_item_id].name)
        reviewed = spec.code in REVIEWED_ITEMS
        rows.append(
            [
                key,
                XRAY,
                it.public_menu_item_id,
                it.norm_unit,
                it.norm_price_cents,
                c.parity_cents,
                to_numeric(c.gap) if c.gap is not None else None,
                c.loss_cents,
                c.reading,
                it.pair_status,
                it.pair_note,
                it.item_category,
                Decimal(spec.weekly_units),
                MARLON if reviewed else None,
                REVIEWED if reviewed else None,
                c.pareto_rank,
                to_numeric(c.pareto_cum_share) if c.pareto_cum_share is not None else None,
                c.parity_full_cents,
                to_numeric(c.gap_full) if c.gap_full is not None else None,
                c.full_price_room,
            ]
        )
    out += [values(rows) + ";", ""]

    out.append(
        "insert into public.xray_pair (id, xray_item_id, public_menu_item_id, similarity, accepted, by) values"
    )
    rows = []
    for it in items:
        for p in it.pairs:
            rows.append(
                [
                    sid(f"m1:xray_pair:{it.public_menu_item_id}:{p.public_menu_item_id}"),
                    item_ids[it.public_menu_item_id],
                    p.public_menu_item_id,
                    to_numeric(p.similarity),
                    p.accepted,
                    p.by,
                ]
            )
    out += [values(rows) + ";", ""]

    out += [
        "-- C06: hours per step, as drawn (0,5 h, 1,0 h, 0,3 h).",
        "insert into public.time_log (account_id, xray_id, step, minutes, person_id, created_at) values",
        values(
            [
                [ACCOUNT, XRAY, "vizinhanca", 30, MARLON, DELIVERED],
                [ACCOUNT, XRAY, "pareamento", 60, MARLON, DELIVERED],
                [ACCOUNT, XRAY, "entrega", 18, MARLON, DELIVERED],
            ]
        )
        + ";",
        "",
    ]
    return "\n".join(out)


def _json(d: dict) -> str:
    import json

    return json.dumps(d, ensure_ascii=False, sort_keys=True)


def main(argv: list[str]) -> int:
    sql = build().sql
    if "--check" in argv:
        if not OUT.exists() or OUT.read_text() != sql:
            print(f"{OUT.relative_to(ROOT)} is not what scripts/gen_g_syn_m1.py writes; run it again")
            return 1
        print("g_syn_m1.sql: up to date")
        return 0
    OUT.write_text(sql)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
