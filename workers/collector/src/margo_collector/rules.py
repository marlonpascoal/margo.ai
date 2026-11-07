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
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Any, Literal
from zoneinfo import ZoneInfo

from .attributes import (
    NO_SAME_ATTRIBUTES,
    NO_SIMILAR_ITEM,
    UNKNOWN_CATEGORY,
    BeverageAttrs,
    Category,
    beverage_attrs,
    category_m1_04,
    compare_beverages,
    is_combo_m1_04,
    missing_reason,
    quantity_m1_04,
    unreadable_reason,
)

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
    rating_count: int | None = None


@dataclass(frozen=True)
class Item:
    """A `public_menu_item` row."""

    id: str
    store_id: str
    name: str
    price_cents: int
    """M1-05: public_menu_item.comparison_price_cents, the price that enters parity."""
    unit: Unit = "un"
    unit_qty: Decimal | float | int | None = None
    taxonomy_level1: str | None = None
    taxonomy_level2: str | None = None
    full_price_cents: int | None = None
    """M1-05: the price before a promotion (original_price_cents); None means the current price."""
    section: str | None = None
    """M1-04: the menu section (public_menu_item.category), one source of `category_m1_04`."""
    description: str | None = None
    size_from_name_ml: Decimal | float | int | None = None
    """M1-04: public_menu_item.size_from_name_ml, what app.size_from_name_m1_03 reads in ml."""


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


def neighborhood_m1_01(
    target: Store,
    stores: Iterable[Store],
    radius_km: int,
    discovered_m: Mapping[str, int | None] | None = None,
) -> list[tuple[Store, int]]:
    """M1-01: public stores within `radius_km` of the target, nearest first. Haversine when both stores have
    coordinates, else the distance of the discovery copy (`discovered_m`: store id to metres). A store with
    neither and the target itself are left out."""
    known = discovered_m or {}
    has_target = target.lat is not None and target.lng is not None
    if not has_target and not any(v is not None for v in known.values()):
        raise ValueError("M1-01 needs the target store's coordinates or a discovery distance")
    out: list[tuple[Store, int]] = []
    for s in stores:
        if s.id == target.id:
            continue
        if has_target and s.lat is not None and s.lng is not None:
            d = distance_m_m1_01(target.lat, target.lng, s.lat, s.lng)  # type: ignore[arg-type]
        else:
            found = known.get(s.id)
            if found is None:
                continue
            d = found
        if d <= radius_km * 1000:
            out.append((s, d))
    return sorted(out, key=lambda sd: (sd[1], sd[0].name or "", sd[0].id))


# M1-02 competitive set ----------------------------------------------------------------------------


def _local_date(at: datetime) -> date:
    return at.astimezone(SAO_PAULO).date()


def _term(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().strip().casefold()


def candidate_m1_02(target_terms: Iterable[str], store_terms: Iterable[str]) -> bool:
    """M1-02: a store is a candidate when its discovered search terms or item taxonomies intersect the
    target's (the C02 categories and the taxonomies of its items). Case and accents do not count. A side with
    no terms says nothing, and the store stays."""
    a, b = {_term(t) for t in target_terms}, {_term(t) for t in store_terms}
    return not a or not b or bool(a & b)


def exclusion_m1_02(
    store: Store,
    *,
    collected_at: datetime,
    delivers_to_target: bool | None,
    settings: Settings,
    is_candidate: bool = True,
) -> str | None:
    """M1-02: the C03 exclusion reason for a store in the neighborhood, or None when it is in the set.

    The three C02 toggles, in this order: national chains with list prices, stores closed more than
    `closed_days` days (days between the last time the store was seen open and the collection, in São
    Paulo dates), stores that do not deliver to the target's neighborhood (unknown counts as delivering).
    Then the category part (`candidate_m1_02`), which is no toggle. A store never seen open has no closed
    days. A founder can still take a store out by hand in C03 ("manual: ...").
    """
    if settings.exclude_national_chains and store.is_national_chain:
        return "regra: rede tabelada"
    if settings.exclude_closed and store.last_seen_open_at is not None:
        days = (_local_date(collected_at) - _local_date(store.last_seen_open_at)).days
        if days > settings.closed_days:
            return f"regra: fechada há {days} dias"
    if settings.same_neighborhood_only and delivers_to_target is False:
        return "regra: não entrega no bairro"
    if not is_candidate:
        return "regra: outra categoria"
    return None


# M1-11 capture ranking ----------------------------------------------------------------------------


@dataclass(frozen=True)
class RankWeights:
    """`m1.rank_weight_ratings`, `m1.rank_weight_distance`, `m1.rank_weight_terms` (04 §1, param)."""

    ratings: Fraction = Fraction(50)
    distance: Fraction = Fraction(30)
    terms: Fraction = Fraction(20)


@dataclass(frozen=True)
class RankCandidate:
    store_id: str
    distance_m: int | None
    rating_count: int | None
    terms: tuple[str, ...] = ()


@dataclass(frozen=True)
class Ranked:
    store_id: str
    score: Fraction
    """From 0 to 100. Exact, except for the logarithm of the rating count; rounded only to store and show."""
    rank: int


def rank_m1_11(
    candidates: Iterable[RankCandidate],
    target_terms: Iterable[str],
    radius_km: int,
    weights: RankWeights = RankWeights(),  # noqa: B008 (frozen)
) -> list[Ranked]:
    """M1-11: which stores deserve a capture, best first; the one place that decides. Candidates are the
    stores that passed M1-01 and M1-02. Score = weighted share of: rating count on a log scale over the
    highest among candidates, proximity (1 - distance / radius, clamped; 0 when unknown), and the share of
    the target's terms the store has (`_term`). The rating value does not enter. Ties: smaller distance,
    unknown last, then store id."""
    pool = list(candidates)
    wanted = {_term(t) for t in target_terms}
    highest = max((c.rating_count or 0 for c in pool), default=0)
    total = weights.ratings + weights.distance + weights.terms

    def score(c: RankCandidate) -> Fraction:
        if total <= 0:
            return Fraction(0)
        count = c.rating_count or 0
        ratings = (
            Fraction(1)
            if count == highest and highest > 0
            else (Fraction(math.log1p(count) / math.log1p(highest)) if highest > 0 else Fraction(0))
        )
        near = Fraction(0)
        if c.distance_m is not None:
            near = min(Fraction(1), max(Fraction(0), 1 - Fraction(c.distance_m, radius_km * 1000)))
        terms = Fraction(len(wanted & {_term(t) for t in c.terms}), len(wanted)) if wanted else Fraction(0)
        return 100 * (weights.ratings * ratings + weights.distance * near + weights.terms * terms) / total

    scored = sorted(
        ((score(c), c) for c in pool),
        key=lambda sc: (-sc[0], sc[1].distance_m is None, sc[1].distance_m or 0, sc[1].store_id),
    )
    return [Ranked(c.store_id, s, i) for i, (s, c) in enumerate(scored, start=1)]


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


def same_taxonomy_m1_04(a: Item, b: Item) -> bool:
    """M1-04: level 2 when both items have it, else level 1 when both have it; no taxonomy, no filter."""
    if a.taxonomy_level2 and b.taxonomy_level2:
        return a.taxonomy_level2 == b.taxonomy_level2
    if a.taxonomy_level1 and b.taxonomy_level1:
        return a.taxonomy_level1 == b.taxonomy_level1
    return True


def item_category_m1_04(item: Item) -> Category | None:
    """M1-04: the item's category (`category_m1_04`), from its row."""
    return category_m1_04(item.name, item.section, item.description, item.taxonomy_level2)


def item_is_combo_m1_04(item: Item) -> bool:
    """M1-04: a pack without a count (M1-03), or a combo by its words (`is_combo_m1_04`)."""
    return normalize_m1_03(item).unit == "combo" or is_combo_m1_04(item.name, item.section)


def item_beverage_attrs_m1_04(item: Item) -> BeverageAttrs:
    """M1-04: the beverage attributes of a row. The size is the one M1-03 keeps: the row's millilitres,
    else what the parser read in the name of a row whose unit says nothing (a pack of 6 has no size)."""
    if item.unit == "ml" and item.unit_qty is not None:
        return beverage_attrs(item.name, item.unit_qty)
    if item.unit == "un" and item.unit_qty is None:
        return beverage_attrs(item.name, item.size_from_name_ml)
    return beverage_attrs(item.name)


def _stores(items: Iterable[Item]) -> int:
    return len({i.store_id for i in items})


def _pair_beverage(own: Item, norm: Normalized, pool: Iterable[Item], settings: Settings) -> Pairing:
    """M1-04: only beverages with the same type, brand, flavor, variant and size confirm, however many stores
    sell them; similarity is then 1. An item with an unreadable attribute is listed for a founder and never
    accepted."""
    attrs = item_beverage_attrs_m1_04(own)
    blocked_reason = unreadable_reason(attrs)
    found: list[Candidate] = []
    for c in pool:
        if c.store_id == own.store_id or item_category_m1_04(c) != "bebidas" or item_is_combo_m1_04(c):
            continue
        if quantity_m1_04(c.name) != quantity_m1_04(own.name):
            continue
        if normalize_m1_03(c).unit != norm.unit:
            continue
        match = compare_beverages(attrs, item_beverage_attrs_m1_04(c))
        if match == "identical":
            found.append(Candidate(c, Fraction(1), True))
        elif match == "unreadable":
            sim = similarity_m1_04(own.name, c.name)
            if sim >= settings.candidate_floor:
                found.append(Candidate(c, sim, False))
    found.sort(key=lambda c: (-c.similarity, c.item.name, c.item.id))
    if any(c.accepted for c in found):
        return Pairing(own, norm, "normalizado" if norm.by_weight_or_pack else "auto", None, tuple(found))
    note = blocked_reason or missing_reason(attrs) or NO_SAME_ATTRIBUTES
    return Pairing(own, norm, "revisar", note, tuple(found))


def pair_item_m1_04(own: Item, pool: Iterable[Item], settings: Settings) -> Pairing:
    """M1-03 and M1-04 for one item of the target store. A hard block comes before any name: a combo only
    meets combos, an item only meets its category, an add-on nothing else, a count only the same count, and a
    beverage only what `_pair_beverage` lets through.

    Other categories keep the name similarity (Stage 2 replaces it): comparable ("Comparáveis" in C04) means
    the same taxonomy when both have one, the same normalized unit and a similarity of at least
    `candidate_floor`. The item pairs automatically when at least `min_pairs` distinct stores reach
    `similarity_threshold`; those pairs are accepted. Otherwise, and always for a combo or an unknown
    category, `revisar` for a founder with nothing accepted. A paired item sold by weight or pack shows
    `normalizado`.
    """
    norm = normalize_m1_03(own)
    category = item_category_m1_04(own)
    combo = item_is_combo_m1_04(own)
    if category == "bebidas" and not combo:
        return _pair_beverage(own, norm, pool, settings)
    found: list[Candidate] = []
    for c in pool:
        if c.id == own.id or c.store_id == own.store_id or item_is_combo_m1_04(c) != combo:
            continue
        if quantity_m1_04(c.name) != quantity_m1_04(own.name):
            continue
        other = item_category_m1_04(c)
        if "bebidas" in (category, other) and not combo:
            continue
        if category != other and ("adicionais" in (category, other) or (category and other)):
            continue
        if not same_taxonomy_m1_04(own, c) or normalize_m1_03(c).unit != norm.unit:
            continue
        sim = similarity_m1_04(own.name, c.name)
        if sim >= settings.candidate_floor:
            found.append(Candidate(c, sim, False))
    found.sort(key=lambda c: (-c.similarity, c.item.name, c.item.id))
    if combo:
        return Pairing(own, norm, "revisar", "combos diferentes", tuple(found))
    if category is None:
        return Pairing(own, norm, "revisar", UNKNOWN_CATEGORY, tuple(found))

    def confirms(c: Candidate) -> bool:
        return c.similarity >= settings.similarity_threshold and item_category_m1_04(c.item) == category

    stores = _stores(c.item for c in found if confirms(c))
    if stores == 0:
        return Pairing(own, norm, "revisar", NO_SIMILAR_ITEM, tuple(found))
    if stores < settings.min_pairs:
        return Pairing(own, norm, "revisar", "poucos pares", tuple(found))
    accepted = tuple(Candidate(c.item, c.similarity, confirms(c)) for c in found)
    return Pairing(own, norm, "normalizado" if norm.by_weight_or_pack else "auto", None, accepted)


# M1-05 to M1-07 parity, gap, reading --------------------------------------------------------------


def median(values: Sequence[Fraction]) -> Fraction:
    if not values:
        raise ValueError("median of nothing")
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def one_per_store_m1_05(accepted: Sequence[Item]) -> list[Item]:
    """M1-05: a store counts once. Its duplicate or identical rows collapse into the row at its lower median
    price per base unit, so the current and the full parity keep using the same items."""
    by_store: dict[str, list[Item]] = {}
    for i in accepted:
        by_store.setdefault(i.store_id, []).append(i)
    out = []
    for rows in by_store.values():
        rows.sort(key=lambda i: (normalize_m1_03(i).per_base, i.id))
        out.append(rows[(len(rows) - 1) // 2])
    return out


def parity_m1_05(own: Item, accepted: Sequence[Item]) -> int | None:
    """M1-05: parity = median normalized price of the accepted comparable items, in the own item's
    terms (median price per base unit times the item's base quantity), in centavos. None without pairs."""
    if not accepted:
        return None
    norm = normalize_m1_03(own)
    per_base = median([normalize_m1_03(i).per_base for i in accepted])
    return round_half_away(per_base * norm.own_base_qty)


def full_price_m1_05(item: Item) -> int:
    """M1-05: the full price is the original price when present (a zero is no price), else the current one."""
    return item.full_price_cents or item.price_cents


def _at_full_price(item: Item) -> Item:
    return replace(item, price_cents=full_price_m1_05(item), full_price_cents=None)


def parity_full_m1_05(own: Item, accepted: Sequence[Item]) -> int | None:
    """M1-05: the same parity over the same accepted items and M1-03 normalization, at full prices."""
    return parity_m1_05(_at_full_price(own), [_at_full_price(i) for i in accepted])


def gap_m1_06(own_cents: int, parity_cents: int) -> Fraction:
    """M1-06: gap = (own price minus parity) / parity."""
    if parity_cents <= 0:
        raise ValueError("M1-06 needs a positive parity")
    return Fraction(own_cents - parity_cents, parity_cents)


def reading_m1_07(
    gap: Fraction, band: Fraction = Fraction(1, 10), gap_full: Fraction | None = None
) -> Reading:
    """M1-07, the more cautious of the current and the full-price gap: either at or above plus the band,
    `nao_mexer` (raising is safe without cost data, lowering is not); else both at or below minus the band,
    `pode_subir`; otherwise `na_media`. Without a full gap, the current one counts for both."""
    full = gap if gap_full is None else gap_full
    if gap >= band or full >= band:
        return "nao_mexer"
    if gap <= -band and full <= -band:
        return "pode_subir"
    return "na_media"


def full_price_room_m1_07(
    reading: Reading, gap_full: Fraction | None, band: Fraction = Fraction(1, 10)
) -> bool:
    """M1-07: the note of a `na_media` item whose full-price gap is at or below minus the band."""
    return reading == "na_media" and gap_full is not None and gap_full <= -band


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
