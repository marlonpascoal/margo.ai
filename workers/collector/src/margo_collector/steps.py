"""The X-ray jobs of worker-collector, over a repository interface (repo.py has Postgres and memory).

    collect            C02 "Buscar vizinhança": queues the discovery for an extractor (D47b)
    xray_neighborhood  after the discovery and its captures: the neighborhood (M1-01, M1-02)
    xray_pair          C03 "Confirmar N lojas": pairs (M1-03, M1-04)
    xray_calc          C04 "Calcular raio-X": parity, gap, reading, loss, Pareto (M1-05 to M1-08), ready

Results returned to the runner are counts and ids only (02 §7).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from margo_common.log import log_event

from .family import (
    Family,
    FamilyClassifier,
    classify_step_m1_13,
    family_ranges_m1_13,
    menu_term_shares_m1_02,
)
from .ifood_public import ParsedStore
from .learning import (
    Answer,
    AttrReader,
    FoodRun,
    FounderLearning,
    Learning,
    Pattern,
    apply_founders,
    founder_learnings_m1_04,
    pattern_m1_04,
    read_food_m1_04,
    unreadable_items,
)
from .pair_review import PairReviewer, ReviewRun, review_pairing_m1_12
from .rules import Item, RankWeights, Settings, Store
from .xray import CalcInput, CalcResult, ItemRow, StoreRow, build_neighborhood, calculate


@dataclass(frozen=True)
class XrayRun:
    id: str
    account_id: str | None
    target_store_id: str
    target_url: str | None
    radius_km: int
    categories: list[str]
    rules: dict[str, Any]
    collected_at: datetime | None

    @property
    def settings(self) -> Settings:
        return Settings.from_xray(self.radius_km, self.rules)


class LoadPending(Exception):
    """Pairing arrived while the X-ray's captures or its neighborhood job are active. The job fails with this
    name; C04 turns it into the reason and C03 lets the founder confirm again when the load ends."""


class ExtractionOff(Exception):
    """The flag m1.extracao is off for the X-ray's account: no discovery was queued (A05)."""


@dataclass(frozen=True)
class Discovered:
    """A store in the latest discovery of the X-ray's target (public.xray_discovery)."""

    distance_m: int | None
    terms: tuple[str, ...]


class XrayRepo(Protocol):
    def load_xray(self, xray_id: str) -> XrayRun: ...

    def save_public_store(self, store: ParsedStore) -> str: ...

    def mark_collected(self, xray_id: str, at: datetime) -> None: ...

    def store(self, store_id: str) -> Store: ...

    def public_stores(self, include: list[str] | None = None) -> list[Store]:
        """Stores with coordinates, plus the ones in `include` (discovered, coordinates not captured yet)."""
        ...

    def discovery(self, xray_id: str) -> dict[str, Discovered]: ...

    def queue_discover(self, xray_id: str, env: str) -> str | None:
        """The discovery job id; None when the flag m1.extracao is off."""
        ...

    def queue_captures(self, xray_id: str, env: str) -> int: ...

    def neighborhood_state(self, xray_id: str) -> tuple[dict[str, tuple[bool, str]], dict[str, bool | None]]:
        """(manual choices to keep, delivers_to_target per store) from the current xray_store rows."""
        ...

    def save_neighborhood(self, xray_id: str, rows: list[StoreRow], *, keep_rank: bool = False) -> None:
        """Saves the rows; with keep_rank, M1-11 scores and ranks already recorded stay."""
        ...

    def rank_weights(self) -> RankWeights: ...

    def included_store_ids(self, xray_id: str) -> list[str]: ...

    def compared_store_ids(self, xray_id: str) -> list[str]:
        """The stores a run compares with: its capture slots, or every included store when it has none
        (Marlon, 08/nov)."""
        ...

    def pair_blocker(self, xray_id: str) -> str | None:
        """What pairing waits for: "captures", "neighborhood", "target" or None (xray_pair_blocker)."""
        ...

    def unfinished_captures(self, xray_id: str) -> list[str]:
        """Stores of the set whose capture is still queued or running; pairing leaves them out."""
        ...

    def mark_left_out(self, xray_id: str, store_ids: list[str]) -> None:
        """Which stores the last pairing left out; the only writer of xray_store.left_out_of_pairing."""
        ...

    def items_of_stores(self, store_ids: list[str]) -> list[Item]: ...

    def pair_decisions(self, xray_id: str) -> dict[tuple[str, str], tuple[bool, str]]: ...

    def save_pairs(self, xray_id: str, rows: list[ItemRow]) -> None: ...

    def two_tiers(self, xray_id: str) -> bool:
        """M1-13: flag m1.comparacao_faixa for this monitored run."""
        ...

    def capture_cap(self) -> int:
        """Param m1.extract_max_captures_per_xray."""
        ...

    def menu_first_state(self, xray_id: str) -> str | None:
        """D76: the capture asked before the discovery: "waiting", "finished", or None when never asked."""
        ...

    def queue_menu_first(self, xray_id: str, env: str) -> str | None:
        """D76: queues the target's capture; None when it cannot."""
        ...

    def save_menu_terms(self, xray_id: str, shares: dict[str, float]) -> None:
        """D76: adds the menu's terms to the X-ray's categories and keeps their shares in its rules."""
        ...

    def item_families(self) -> dict[str, Family]:
        """M1-13: every classified pattern (public.m1_item_family)."""
        ...

    def save_item_families(self, found: dict[str, Family], model: str) -> None:
        """M1-13: new patterns; an existing one stays."""
        ...

    def pair_review_learnings(self) -> dict[str, dict[str, bool]]:
        """M1-12: each pair pattern's verdict by X-ray (public.m1_pair_review_answer)."""
        ...

    def pair_review_params(self) -> tuple[float, int, int]:
        """M1-12: target share, rounds, runs for a learning (rule_param)."""
        ...

    def save_pair_review(self, xray_id: str, review: ReviewRun) -> None:
        """M1-12: the run's review and its verdicts; a re-run replaces both."""
        ...

    def attr_learnings(self) -> dict[Pattern, Learning]:
        """M1-04 Stage 2: every learning with its answers by X-ray (public.m1_attr_learning and _run)."""
        ...

    def attr_learning_min_runs(self) -> int:
        """Param m1.attr_learning_min_runs."""
        ...

    def save_attr_answers(self, xray_id: str, model: str, answers: Sequence[Answer]) -> None:
        """This run's AI answers: one per pattern per X-ray, a re-run replacing it."""
        ...

    def save_founder_learnings(self, taught: Sequence[FounderLearning]) -> None:
        """Founder corrections from C04: an answer wins and clears a dispute; a rejection disputes the
        pattern."""
        ...

    def calc_inputs(self, xray_id: str) -> list[CalcInput]: ...

    def save_calc(self, xray_id: str, result: CalcResult) -> None: ...

    def snapshot(self, xray_id: str) -> None:
        """M1 history: keep this run's stores, items and prices as a dated snapshot; never rewrites one."""
        ...


def neighborhood_step(
    repo: XrayRepo,
    xray_id: str,
    delivers_to_target: dict[str, bool | None] | None = None,
    *,
    keep_rank: bool = False,
) -> dict[str, int]:
    """M1-01, M1-02 and M1-11 over the public catalog and the discovery copies; manual C03 choices stay."""
    x = repo.load_xray(xray_id)
    if x.collected_at is None:
        raise ValueError("the neighborhood needs a collection date")
    manual, delivers = repo.neighborhood_state(xray_id)
    delivers.update(delivers_to_target or {})
    found = repo.discovery(xray_id)
    own = found.get(x.target_store_id)
    # M1-01: with a discovery, only what it found; other runs and seed rows nearby are no neighbors.
    discovered = set(found) - {x.target_store_id}
    keep = discovered | {x.target_store_id}
    stores = [s for s in repo.public_stores(list(found)) if not discovered or s.id in keep]
    rows = build_neighborhood(
        repo.store(x.target_store_id),
        stores,
        collected_at=x.collected_at,
        settings=x.settings,
        delivers_to_target=delivers,
        manual=manual,
        discovered_m={sid: d.distance_m for sid, d in found.items()},
        target_terms=[*x.categories, *(own.terms if own else ())],
        store_terms={sid: d.terms for sid, d in found.items()},
        rank_weights=repo.rank_weights(),
        term_shares=x.rules.get("menu_term_shares"),
        capture_cap=repo.capture_cap(),
    )
    repo.save_neighborhood(xray_id, rows, keep_rank=keep_rank)
    return {"stores": len(rows), "in_set": sum(1 for r in rows if r.included)}


def collect_step(
    repo: XrayRepo, xray_id: str, env: str, classifier: FamilyClassifier | None = None
) -> dict[str, int]:
    """C02: queues the discovery of the target for an extractor (docs/extract-api.md). The result comes back
    through /api/extract/result, which applies the copies and queues `xray_neighborhood`.

    D76: with m1.comparacao_faixa the discovery searches for what the store sells. With no menu yet its
    capture comes first and this job runs again when it ends; if that capture fails, the categories chosen
    stand."""
    if classifier is not None and repo.two_tiers(xray_id):
        target = repo.load_xray(xray_id).target_store_id
        menu = repo.items_of_stores([target])
        if not menu:
            state = repo.menu_first_state(xray_id)
            if state == "waiting" or (state is None and repo.queue_menu_first(xray_id, env) is not None):
                return {"menu_first": 1}
        else:
            known = repo.item_families()
            found = classify_step_m1_13(menu, known, classifier, xray_id)
            repo.save_item_families(found, classifier.model)
            shares = menu_term_shares_m1_02(menu, {**known, **found})
            if shares:
                repo.save_menu_terms(xray_id, shares)
    if repo.queue_discover(xray_id, env) is None:
        raise ExtractionOff()
    return {"queued": 1}


def neighborhood_job_step(
    repo: XrayRepo, xray_id: str, env: str, *, queue_captures: bool
) -> dict[str, int]:
    """M1-01, M1-02 and M1-11 from the applied copies; on a discovery's run, the captures of the target and
    the top of the rank (public.extract_queue_xray_captures). The run after the captures keeps the rank."""
    result = neighborhood_step(repo, xray_id, keep_rank=not queue_captures)
    captures = repo.queue_captures(xray_id, env) if queue_captures else 0
    return {**result, "captures": captures}


def pair_step(
    repo: XrayRepo,
    xray_id: str,
    reader: AttrReader | None = None,
    reviewer: PairReviewer | None = None,
    classifier: FamilyClassifier | None = None,
) -> dict[str, int | str | bool | float | None]:
    """M1-03 and M1-04: the target's items against the items of the stores in the set, once enough captures
    finished. A store whose capture is still running is left out and marked; when it finishes the pairing
    stays as it is until a person runs it again. A re-run replaces the pairs: stores no longer in the set
    leave, a founder's decision on a store still in it stays.

    Stage 2: non-beverage items the rules cannot read take a founder's or a promoted learning, else one AI
    call (`reader`); the answers and the founder's C04 corrections are learned. Without a reader (no AI
    key, D70) that step is skipped with a note, nothing is learned, and the result is the rules
    alone.

    M1-12: before the pairs are saved, the AI reviews them against the checklist and the rules run again
    without what it rejected (`reviewer`, pair_review.py). Without one the rules stand and the review says
    so."""
    if repo.pair_blocker(xray_id) is not None:
        raise LoadPending()
    x = repo.load_xray(xray_id)
    own = repo.items_of_stores([x.target_store_id])
    left_out = repo.unfinished_captures(xray_id)
    pool = repo.items_of_stores([s for s in repo.compared_store_ids(xray_id) if s not in set(left_out)])
    decisions = repo.pair_decisions(xray_id)
    food = learn_food_step(repo, xray_id, own, pool, decisions, reader)
    if classifier is not None and repo.two_tiers(xray_id):
        found = classify_step_m1_13([*own, *pool], repo.item_families(), classifier, xray_id)
        repo.save_item_families(found, classifier.model)
    target, max_rounds, min_runs = repo.pair_review_params()
    review = review_pairing_m1_12(
        own,
        pool,
        x.settings,
        decisions,
        food.overrides,
        reviewer,
        repo.pair_review_learnings() if reviewer else {},
        target=target,
        max_rounds=max_rounds,
        min_runs=min_runs,
        xray_id=xray_id,
    )
    rows = review.rows
    repo.save_pairs(xray_id, rows)
    repo.save_pair_review(xray_id, review)
    repo.mark_left_out(xray_id, left_out)
    return {
        "items": len(rows),
        "revisar": sum(1 for r in rows if r.pair_status == "revisar"),
        "exclusivo": sum(1 for r in rows if r.pair_status == "exclusivo"),
        "attr_unreadable": food.unreadable if reader else len(unreadable_items([*own, *pool])),
        "attr_learned": food.from_learnings,
        "ai_items": food.ai_items,
        "ai_model": reader.model if reader else None,
        "ai_skipped": reader is None,
        "review_status": review.status,
        "review_score": review.score,
        "review_rounds": review.rounds,
        "review_rejected": review.rejected,
    }


def learn_food_step(
    repo: XrayRepo,
    xray_id: str,
    own: Sequence[Item],
    pool: Sequence[Item],
    decisions: dict[tuple[str, str], tuple[bool, str]],
    reader: AttrReader | None,
) -> FoodRun:
    """M1-04 Stage 2: founder corrections first (they win), then learnings, then the AI for the rest; saves
    what was learned. Nothing at all without a reader."""
    items = [*own, *pool]
    if reader is None:
        note = "chave de IA ausente: só regras, nada aprendido"
        log_event("m1_attr_ai_skipped", xray_id=xray_id, note=note)
        return read_food_m1_04(items, {}, None)
    learnings = repo.attr_learnings()
    # An unreadable item whose pattern the AI answered before had its attributes from the AI.
    before = {i.id for i in unreadable_items(items) if (lr := learnings.get(pattern_m1_04(i))) and lr.answers}
    taught = founder_learnings_m1_04(decisions, {i.id: i for i in items}, before)
    if taught:
        repo.save_founder_learnings(taught)
        apply_founders(learnings, taught)
    run = read_food_m1_04(items, learnings, reader, min_runs=repo.attr_learning_min_runs(), xray_id=xray_id)
    if run.answers:
        repo.save_attr_answers(xray_id, reader.model, run.answers)
    return run


def calc_step(repo: XrayRepo, xray_id: str) -> dict[str, int]:
    """M1-05 to M1-08; the X-ray becomes ready."""
    x = repo.load_xray(xray_id)
    inputs = repo.calc_inputs(xray_id)
    two_tiers = repo.two_tiers(xray_id)
    ranges = (
        family_ranges_m1_13(
            [(i.key, i.own) for i in inputs],
            repo.items_of_stores(repo.compared_store_ids(xray_id)),
            repo.item_families(),
            x.settings.min_pairs,
        )
        if two_tiers
        else {}
    )
    result = calculate(
        inputs, x.settings.reading_band, x.settings.min_pairs, two_tiers=two_tiers, family_ranges=ranges
    )
    repo.save_calc(xray_id, result)
    repo.snapshot(xray_id)
    return {"items": result.items_analyzed, "items_for_80": result.items_for_80}
