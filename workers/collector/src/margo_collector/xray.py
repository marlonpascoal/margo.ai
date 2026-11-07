"""The three X-ray steps over canonical rows, with no database: what the worker writes after collection
(neighborhood, M1-01 and M1-02), after "Confirmar N lojas" (pairs, M1-03 and M1-04) and after "Calcular
raio-X" (parity to Pareto, M1-05 to M1-08). The repository (repo.py) loads and saves the rows; the G-SYN
seed generator calls the same functions, so the seed and the worker cannot disagree.

Founder decisions survive a rerun: a store put in or out by hand keeps its manual reason, a pair a
founder accepted or rejected keeps that decision, and items keep their review, skip and weekly units.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal
from fractions import Fraction

from .rules import (
    Item,
    PairStatus,
    RankCandidate,
    RankWeights,
    Reading,
    Settings,
    Store,
    candidate_m1_02,
    exclusion_m1_02,
    full_price_m1_05,
    full_price_room_m1_07,
    gap_m1_06,
    loss_m1_08,
    neighborhood_m1_01,
    normalize_m1_03,
    pair_item_m1_04,
    pareto_m1_08,
    parity_full_m1_05,
    parity_m1_05,
    rank_m1_11,
    reading_m1_07,
)

# Neighborhood -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class StoreRow:
    """An `xray_store` row."""

    public_store_id: str
    distance_m: int
    delivers_to_target: bool | None
    included: bool
    exclusion_reason: str | None
    capture_score: Fraction | None = None
    """M1-11; None for a store the filters left out."""
    capture_rank: int | None = None


def is_manual(reason: str | None) -> bool:
    return reason is not None and reason.startswith("manual")


def build_neighborhood(
    target: Store,
    stores: Iterable[Store],
    *,
    collected_at: datetime,
    settings: Settings,
    delivers_to_target: Mapping[str, bool | None] | None = None,
    manual: Mapping[str, tuple[bool, str]] | None = None,
    discovered_m: Mapping[str, int | None] | None = None,
    target_terms: Iterable[str] = (),
    store_terms: Mapping[str, Iterable[str]] | None = None,
    rank_weights: RankWeights = RankWeights(),  # noqa: B008 (frozen)
) -> list[StoreRow]:
    """M1-01, M1-02, then M1-11 over the stores those filters kept; `manual` holds the founder's C03 choices.
    A manual choice wins over the filters and changes no rank."""
    terms = store_terms or {}
    wanted = list(target_terms)
    delivers = delivers_to_target or {}
    kept = manual or {}
    rows: list[StoreRow] = []
    candidates: list[RankCandidate] = []
    for store, distance in neighborhood_m1_01(target, stores, settings.radius_km, discovered_m):
        d = delivers.get(store.id)
        reason = exclusion_m1_02(
            store,
            collected_at=collected_at,
            delivers_to_target=d,
            settings=settings,
            is_candidate=candidate_m1_02(wanted, terms.get(store.id, ())),
        )
        if reason is None:
            own = tuple(terms.get(store.id, ()))
            candidates.append(RankCandidate(store.id, distance, store.rating_count, own))
        if store.id in kept:
            included, manual_reason = kept[store.id]
            rows.append(StoreRow(store.id, distance, d, included, manual_reason))
        else:
            rows.append(StoreRow(store.id, distance, d, reason is None, reason))
    ranked = {r.store_id: r for r in rank_m1_11(candidates, wanted, settings.radius_km, rank_weights)}
    return [
        replace(r, capture_score=ranked[r.public_store_id].score, capture_rank=ranked[r.public_store_id].rank)
        if r.public_store_id in ranked
        else r
        for r in rows
    ]


# Pairing ------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PairRow:
    """An `xray_pair` row."""

    public_menu_item_id: str
    similarity: Fraction
    accepted: bool
    by: str | None


@dataclass(frozen=True)
class ItemRow:
    """The pairing part of an `xray_item` row."""

    public_menu_item_id: str
    norm_unit: str
    norm_price_cents: int
    pair_status: PairStatus
    pair_note: str | None
    pairs: tuple[PairRow, ...]


def build_pairs(
    own_items: Sequence[Item],
    pool: Sequence[Item],
    settings: Settings,
    decisions: Mapping[tuple[str, str], tuple[bool, str]] | None = None,
) -> list[ItemRow]:
    """M1-03 and M1-04 for every item of the target store against the items of the stores in the set.
    `decisions` maps (own item id, comparable item id) to a founder's (accepted, person id)."""
    kept = decisions or {}
    out: list[ItemRow] = []
    for own in own_items:
        p = pair_item_m1_04(own, pool, settings)
        pairs = []
        for c in p.candidates:
            decided = kept.get((own.id, c.item.id))
            if decided is not None:
                pairs.append(PairRow(c.item.id, c.similarity, decided[0], decided[1]))
            else:
                pairs.append(PairRow(c.item.id, c.similarity, c.accepted, None))
        out.append(ItemRow(own.id, p.norm.unit, p.norm.display_cents, p.status, p.note, tuple(pairs)))
    return out


# Calculation --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CalcInput:
    key: str
    """The xray_item id."""
    own: Item
    accepted: tuple[Item, ...]
    weekly_units: Decimal | float | int | None
    skipped: bool = False


@dataclass(frozen=True)
class CalcRow:
    """The calculated part of an `xray_item` row; all None for a skipped item or one without pairs."""

    key: str
    parity_cents: int | None
    gap: Fraction | None
    reading: Reading | None
    loss_cents: int | None
    pareto_rank: int | None
    pareto_cum_share: Fraction | None
    parity_full_cents: int | None = None
    gap_full: Fraction | None = None
    full_price_room: bool = False


@dataclass(frozen=True)
class CalcResult:
    rows: tuple[CalcRow, ...]
    items_analyzed: int
    items_for_80: int
    total_loss_cents: int


def calculate(items: Sequence[CalcInput], band: Fraction = Fraction(1, 10)) -> CalcResult:
    """M1-05 to M1-08. Skipped items stay out of parity and of the Pareto (C04). The reading (M1-07) takes
    both parities; the loss and the Pareto (M1-08) stay on the current one."""
    partial: dict[str, tuple[int, Fraction, Reading, int, int, Fraction]] = {}
    for it in items:
        if it.skipped:
            continue
        # M1-03: a pair accepted before a size was read from a name never mixes base units.
        unit = normalize_m1_03(it.own).unit
        accepted = [a for a in it.accepted if normalize_m1_03(a).unit == unit]
        parity = parity_m1_05(it.own, accepted)
        if parity is None:
            continue
        gap = gap_m1_06(it.own.price_cents, parity)
        parity_full = parity_full_m1_05(it.own, accepted)
        assert parity_full is not None, "same accepted items as the current parity"
        gap_full = gap_m1_06(full_price_m1_05(it.own), parity_full)
        partial[it.key] = (
            parity,
            gap,
            reading_m1_07(gap, band, gap_full),
            loss_m1_08(parity, it.own.price_cents, it.weekly_units),
            parity_full,
            gap_full,
        )
    names = {it.key: it.own.name for it in items}
    pareto = pareto_m1_08({k: (names[k], v[3]) for k, v in partial.items()}, items_total=len(partial))
    ranks = {r.key: r for r in pareto.rows}
    rows = []
    for it in items:
        if it.key not in partial:
            rows.append(CalcRow(it.key, None, None, None, None, None, None))
            continue
        parity, gap, reading, loss, parity_full, gap_full = partial[it.key]
        r = ranks.get(it.key)
        rows.append(
            CalcRow(
                it.key,
                parity,
                gap,
                reading,
                loss,
                r.rank if r else None,
                r.cum_share if r else None,
                parity_full,
                gap_full,
                full_price_room_m1_07(reading, gap_full, band),
            )
        )
    return CalcResult(tuple(rows), len(partial), pareto.items_for_80, pareto.total_loss_cents)
