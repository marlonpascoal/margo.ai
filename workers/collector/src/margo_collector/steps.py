"""The X-ray jobs of worker-collector, over a repository interface (repo.py has Postgres and memory).

    collect            C02 "Buscar vizinhança": queues the discovery for an extractor (D47b)
    xray_neighborhood  after the discovery and its captures: the neighborhood (M1-01, M1-02)
    xray_pair          C03 "Confirmar N lojas": pairs (M1-03, M1-04)
    xray_calc          C04 "Calcular raio-X": parity, gap, reading, loss, Pareto (M1-05 to M1-08), ready

Results returned to the runner are counts and ids only (02 §7).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from .ifood_public import ParsedStore
from .rules import Item, Settings, Store
from .xray import CalcInput, CalcResult, ItemRow, StoreRow, build_neighborhood, build_pairs, calculate


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

    def save_neighborhood(self, xray_id: str, rows: list[StoreRow]) -> None: ...

    def included_store_ids(self, xray_id: str) -> list[str]: ...

    def items_of_stores(self, store_ids: list[str]) -> list[Item]: ...

    def pair_decisions(self, xray_id: str) -> dict[tuple[str, str], tuple[bool, str]]: ...

    def save_pairs(self, xray_id: str, rows: list[ItemRow]) -> None: ...

    def calc_inputs(self, xray_id: str) -> list[CalcInput]: ...

    def save_calc(self, xray_id: str, result: CalcResult) -> None: ...

    def snapshot(self, xray_id: str) -> None:
        """M1 history: keep this run's stores, items and prices as a dated snapshot; never rewrites one."""
        ...


def neighborhood_step(
    repo: XrayRepo, xray_id: str, delivers_to_target: dict[str, bool | None] | None = None
) -> dict[str, int]:
    """M1-01 and M1-02 over the public catalog and the discovery copies; manual C03 choices are kept."""
    x = repo.load_xray(xray_id)
    if x.collected_at is None:
        raise ValueError("the neighborhood needs a collection date")
    manual, delivers = repo.neighborhood_state(xray_id)
    delivers.update(delivers_to_target or {})
    found = repo.discovery(xray_id)
    own = found.get(x.target_store_id)
    # M1-01: with a discovery, only what it found; other runs and seed rows nearby are no neighbors.
    discovered = set(found) - {x.target_store_id}
    stores = [s for s in repo.public_stores(list(found)) if not discovered or s.id in discovered or s.id == x.target_store_id]
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
    )
    repo.save_neighborhood(xray_id, rows)
    return {"stores": len(rows), "in_set": sum(1 for r in rows if r.included)}


def collect_step(repo: XrayRepo, xray_id: str, env: str) -> dict[str, int]:
    """C02: queues the discovery of the target for an extractor (docs/extract-api.md). The result comes back
    through /api/extract/result, which applies the copies and queues `xray_neighborhood`."""
    if repo.queue_discover(xray_id, env) is None:
        raise ExtractionOff()
    return {"queued": 1}


def neighborhood_job_step(
    repo: XrayRepo, xray_id: str, env: str, *, queue_captures: bool
) -> dict[str, int]:
    """M1-01 and M1-02 from the applied copies; on the first run, the captures of the target and the set."""
    result = neighborhood_step(repo, xray_id)
    captures = repo.queue_captures(xray_id, env) if queue_captures else 0
    return {**result, "captures": captures}


def pair_step(repo: XrayRepo, xray_id: str) -> dict[str, int]:
    """M1-03 and M1-04: the target's items against the items of the stores in the set."""
    x = repo.load_xray(xray_id)
    own = repo.items_of_stores([x.target_store_id])
    pool = repo.items_of_stores(repo.included_store_ids(xray_id))
    rows = build_pairs(own, pool, x.settings, repo.pair_decisions(xray_id))
    repo.save_pairs(xray_id, rows)
    return {"items": len(rows), "revisar": sum(1 for r in rows if r.pair_status == "revisar")}


def calc_step(repo: XrayRepo, xray_id: str) -> dict[str, int]:
    """M1-05 to M1-08; the X-ray becomes ready."""
    x = repo.load_xray(xray_id)
    result = calculate(repo.calc_inputs(xray_id), x.settings.reading_band)
    repo.save_calc(xray_id, result)
    repo.snapshot(xray_id)
    return {"items": result.items_analyzed, "items_for_80": result.items_for_80}
