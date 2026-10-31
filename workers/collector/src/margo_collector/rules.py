"""Price X-ray rules M1-01 to M1-08 (spec/04-rules.md §1) as pure functions over canonical rows.

Inputs are the rows of `public_store` and `public_menu_item` (03 §2); outputs are what the worker writes to
`xray_store`, `xray_item` and `xray_pair`. Money is integer centavos; intermediate values are exact
fractions and are rounded once, half away from zero, when they become centavos. M1-09 (what the PDF shows)
lives with the PDF in margo_render.

Params (04 §1 "param") come from `xray.rules`; the defaults below are used when a key is absent.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Any, Literal
from zoneinfo import ZoneInfo

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
EARTH_RADIUS_M = 6_371_008.8
"""Mean Earth radius (IUGG). Distances are great-circle (haversine), in whole metres."""

Unit = Literal["un", "g", "ml", "pack"]
NormUnit = Literal["un", "100g", "100ml", "combo"]
PairStatus = Literal["auto", "revisar", "normalizado", "manual"]
Reading = Literal["pode_subir", "na_media", "nao_mexer"]


# Rows ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Store:
    """A `public_store` row, as far as the rules need it."""

    id: str
    name: str | None
    category: str | None
    lat: Decimal | float | None
    lng: Decimal | float | None
    last_seen_open_at: datetime | None = None
    is_national_chain: bool = False


@dataclass(frozen=True)
class Item:
    """A `public_menu_item` row."""

    id: str
    store_id: str
    name: str
    price_cents: int
    unit: Unit = "un"
    unit_qty: Decimal | float | int | None = None


@dataclass(frozen=True)
class Settings:
    """`xray.radius_km` and `xray.rules`, with the 04 §1 defaults."""

    radius_km: int = 3
    exclude_closed: bool = True
    exclude_national_chains: bool = True
    same_neighborhood_only: bool = False
    closed_days: int = 30
    min_pairs: int = 5
    similarity_threshold: Fraction = Fraction(3, 4)
    candidate_floor: Fraction = Fraction(3, 5)
    reading_band: Fraction = Fraction(1, 10)

    @classmethod
    def from_xray(cls, radius_km: int, rules: Mapping[str, Any] | None) -> Settings:
        r = dict(rules or {})
        d = cls()

        def frac(key: str, default: Fraction) -> Fraction:
            return Fraction(str(r[key])) if key in r and r[key] is not None else default

        return cls(
            radius_km=int(radius_km),
            exclude_closed=bool(r.get("exclude_closed", d.exclude_closed)),
            exclude_national_chains=bool(r.get("exclude_national_chains", d.exclude_national_chains)),
            same_neighborhood_only=bool(r.get("same_neighborhood_only", d.same_neighborhood_only)),
            closed_days=int(r.get("closed_days", d.closed_days)),
            min_pairs=int(r.get("min_pairs", d.min_pairs)),
            similarity_threshold=frac("similarity_threshold", d.similarity_threshold),
            candidate_floor=frac("candidate_floor", d.candidate_floor),
            reading_band=frac("reading_band", d.reading_band),
        )


# Rounding -----------------------------------------------------------------------------------------


def round_half_away(x: Fraction) -> int:
    """Round to the nearest integer, halves away from zero (centavos)."""
    n = math.floor(abs(x) + Fraction(1, 2))
    return n if x >= 0 else -n


def to_numeric(x: Fraction, places: int = 4) -> Decimal:
    """A fraction as a Postgres numeric with `places` decimals, halves away from zero."""
    q = Decimal(1).scaleb(-places)
    return (Decimal(x.numerator) / Decimal(x.denominator)).quantize(q, rounding=ROUND_HALF_UP)


def percent_label(x: Fraction, signed: bool = True) -> str:
    """'−23%', '+17%', '0%' (C05, P01), with the minus sign U+2212 as drawn; unsigned: '31%'."""
    n = round_half_away(x * 100)
    if not signed:
        return f"{n}%"
    if n > 0:
        return f"+{n}%"
    return f"\u2212{-n}%" if n < 0 else "0%"


# M1-01 neighborhood -------------------------------------------------------------------------------


def distance_m_m1_01(
    lat1: Decimal | float, lng1: Decimal | float, lat2: Decimal | float, lng2: Decimal | float
) -> int:
    """M1-01: great-circle distance in whole metres (haversine)."""
    p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
    dp = p2 - p1
    dl = math.radians(float(lng2) - float(lng1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * EARTH_RADIUS_M * math.asin(math.sqrt(a)))


def neighborhood_m1_01(target: Store, stores: Iterable[Store], radius_km: int) -> list[tuple[Store, int]]:
    """M1-01: public stores within `radius_km` of the target, nearest first. Stores without coordinates
    and the target itself are left out."""
    if target.lat is None or target.lng is None:
        raise ValueError("M1-01 needs the target store's coordinates")
    out: list[tuple[Store, int]] = []
    for s in stores:
        if s.id == target.id or s.lat is None or s.lng is None:
            continue
        d = distance_m_m1_01(target.lat, target.lng, s.lat, s.lng)
        if d <= radius_km * 1000:
            out.append((s, d))
    return sorted(out, key=lambda sd: (sd[1], sd[0].name or "", sd[0].id))


# M1-02 competitive set ----------------------------------------------------------------------------


def _local_date(at: datetime) -> date:
    return at.astimezone(SAO_PAULO).date()


def exclusion_m1_02(
    store: Store, *, collected_at: datetime, delivers_to_target: bool | None, settings: Settings
) -> str | None:
    """M1-02: the C03 exclusion reason for a store in the neighborhood, or None when it is in the set.

    The three C02 toggles, in this order: national chains with list prices, stores closed more than
    `closed_days` days (days between the last time the store was seen open and the collection, in São
    Paulo dates), stores that do not deliver to the target's neighborhood (unknown counts as delivering).
    The category part of M1-02 is applied by the collector, which only searches the categories chosen in
    C02; a store listed there under another category is taken out by hand in C03 ("manual: ...").
    """
    if settings.exclude_national_chains and store.is_national_chain:
        return "regra: rede tabelada"
    if settings.exclude_closed and store.last_seen_open_at is not None:
        days = (_local_date(collected_at) - _local_date(store.last_seen_open_at)).days
        if days > settings.closed_days:
            return f"regra: fechada há {days} dias"
    if settings.same_neighborhood_only and delivers_to_target is False:
        return "regra: não entrega no bairro"
    return None


# M1-03 unit normalization -------------------------------------------------------------------------


@dataclass(frozen=True)
class Normalized:
    """M1-03: price per base unit (per g, per ml, per un, or per combo) and the unit shown in C04."""

    unit: NormUnit
    per_base: Fraction
    """Centavos per base unit (exact)."""
    own_base_qty: Fraction
    """Base units in this item: grams, millilitres, units; 1 for a combo."""
    by_weight_or_pack: bool

    @property
    def display_factor(self) -> int:
        return 100 if self.unit in ("100g", "100ml") else 1

    @property
    def display_cents(self) -> int:
        """Price per displayed unit ("por 100 g": centavos per 100 g)."""
        return round_half_away(self.per_base * self.display_factor)


def normalize_m1_03(item: Item) -> Normalized:
    """M1-03: items sold by weight (g), volume (ml) or pack are converted to a price per base unit (g, ml,
    un) before comparing. A pack without a unit count is a combo of different items: it compares only
    with other combos, whole."""
    price = Fraction(item.price_cents)
    qty = Fraction(str(item.unit_qty)) if item.unit_qty is not None else None
    if item.unit in ("g", "ml"):
        if qty is None:
            raise ValueError(f"M1-03: item {item.id} sold by {item.unit} needs unit_qty")
        return Normalized("100g" if item.unit == "g" else "100ml", price / qty, qty, True)
    if item.unit == "pack":
        if qty is None:
            return Normalized("combo", price, Fraction(1), False)
        return Normalized("un", price / qty, qty, True)
    q = qty or Fraction(1)
    return Normalized("un", price / q, q, q != 1)


# M1-04 pairing ------------------------------------------------------------------------------------

STOPWORDS = frozenset({"a", "o", "e", "de", "da", "do", "das", "dos", "com", "em", "na", "no", "ao", "x"})
UNIT_WORDS = frozenset({"g", "kg", "gr", "ml", "l", "lt", "un", "und", "unid"})
_NON_WORD = re.compile(r"[^a-z0-9]+")


def name_tokens(name: str) -> frozenset[str]:
    """Words of an item name for M1-04: lower case, no accents, no numbers or unit abbreviations, no
    stopwords, plural "s" dropped from words longer than 3 letters."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    out = set()
    for w in _NON_WORD.split(plain):
        if not w or w.isdigit() or w in STOPWORDS or w in UNIT_WORDS or re.fullmatch(r"\d+(g|kg|ml|l)", w):
            continue
        if len(w) > 3 and w.endswith("s"):
            w = w[:-1]
        out.add(w)
    return frozenset(out)


def similarity_m1_04(a: str, b: str) -> Fraction:
    """M1-04 name similarity: Sørensen-Dice over `name_tokens`, from 0 to 1."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return Fraction(0)
    return Fraction(2 * len(ta & tb), len(ta) + len(tb))


@dataclass(frozen=True)
class Candidate:
    item: Item
    similarity: Fraction
    accepted: bool


@dataclass(frozen=True)
class Pairing:
    own: Item
    norm: Normalized
    status: PairStatus
    note: str | None
    candidates: tuple[Candidate, ...] = field(default=())


def pair_item_m1_04(own: Item, pool: Iterable[Item], settings: Settings) -> Pairing:
    """M1-03 and M1-04 for one item of the target store.

    Comparable items ("Comparáveis" in C04) are items of the stores in the set with the same normalized
    unit and a name similarity of at least `candidate_floor`. The item pairs automatically when at least
    `min_pairs` of them reach `similarity_threshold`; those pairs are accepted. Otherwise, and always for
    a combo, it goes to `revisar` for a founder with nothing accepted. A paired item sold by weight or
    pack shows `normalizado`.
    """
    norm = normalize_m1_03(own)
    found: list[Candidate] = []
    for c in pool:
        if c.id == own.id or c.store_id == own.store_id:
            continue
        if normalize_m1_03(c).unit != norm.unit:
            continue
        sim = similarity_m1_04(own.name, c.name)
        if sim >= settings.candidate_floor:
            found.append(Candidate(c, sim, False))
    found.sort(key=lambda c: (-c.similarity, c.item.name, c.item.id))
    strong = [c for c in found if c.similarity >= settings.similarity_threshold]
    if norm.unit == "combo":
        return Pairing(own, norm, "revisar", "combos diferentes", tuple(found))
    if len(strong) < settings.min_pairs:
        return Pairing(own, norm, "revisar", "poucos pares", tuple(found))
    accepted = tuple(
        Candidate(c.item, c.similarity, c.similarity >= settings.similarity_threshold) for c in found
    )
    return Pairing(own, norm, "normalizado" if norm.by_weight_or_pack else "auto", None, accepted)


# M1-05 to M1-07 parity, gap, reading --------------------------------------------------------------


def median(values: Sequence[Fraction]) -> Fraction:
    if not values:
        raise ValueError("median of nothing")
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def parity_m1_05(own: Item, accepted: Sequence[Item]) -> int | None:
    """M1-05: parity = median normalized price of the accepted comparable items, in the own item's
    terms (median price per base unit times the item's base quantity), in centavos. None without pairs."""
    if not accepted:
        return None
    norm = normalize_m1_03(own)
    per_base = median([normalize_m1_03(i).per_base for i in accepted])
    return round_half_away(per_base * norm.own_base_qty)


def gap_m1_06(own_cents: int, parity_cents: int) -> Fraction:
    """M1-06: gap = (own price minus parity) / parity."""
    if parity_cents <= 0:
        raise ValueError("M1-06 needs a positive parity")
    return Fraction(own_cents - parity_cents, parity_cents)


def reading_m1_07(gap: Fraction, band: Fraction = Fraction(1, 10)) -> Reading:
    """M1-07: at or below minus the band, `pode_subir`; at or above plus the band, `nao_mexer` (raising
    is safe without cost data, lowering is not); otherwise `na_media`."""
    if gap <= -band:
        return "pode_subir"
    if gap >= band:
        return "nao_mexer"
    return "na_media"


READING_LABEL: dict[Reading, str] = {
    "pode_subir": "pode subir hoje",
    "na_media": "na faixa",
    "nao_mexer": "precisa do custo",
}
"""C05 "Leitura" column, as drawn."""


# M1-08 loss and Pareto ----------------------------------------------------------------------------


def loss_m1_08(parity_cents: int, own_cents: int, weekly_units: Decimal | float | int | None) -> int:
    """M1-08: loss per item = (parity minus own price) times expected weekly units when known, else 1.
    Negative for items above parity (they carry no loss in the Pareto)."""
    units = Fraction(str(weekly_units)) if weekly_units is not None else Fraction(1)
    return round_half_away((parity_cents - own_cents) * units)


@dataclass(frozen=True)
class ParetoRow:
    key: str
    loss_cents: int
    rank: int
    cum_share: Fraction


@dataclass(frozen=True)
class Pareto:
    rows: tuple[ParetoRow, ...]
    total_loss_cents: int
    items_for_80: int
    """How many items carry 80% of the loss (the smallest N whose cumulative share reaches 0.8)."""
    items_total: int
    """All items analyzed, the M of "N de M itens"."""


def pareto_m1_08(
    losses: Mapping[str, tuple[str, int]], items_total: int, share: Fraction = Fraction(4, 5)
) -> Pareto:
    """M1-08: ranks items with a positive loss, largest first (ties by name), with the cumulative share
    of the total loss, and counts the items that carry `share` (80%) of it.

    `losses` maps a key (the xray_item id) to (item name, loss in centavos).
    """
    positive = sorted(((k, n, v) for k, (n, v) in losses.items() if v > 0), key=lambda t: (-t[2], t[1], t[0]))
    total = sum(v for _, _, v in positive)
    rows: list[ParetoRow] = []
    cum = 0
    n80 = 0
    for i, (k, _, v) in enumerate(positive, start=1):
        cum += v
        frac = Fraction(cum, total)
        rows.append(ParetoRow(k, v, i, frac))
        if not n80 and frac >= share:
            n80 = i
    return Pareto(tuple(rows), total, n80, items_total)
