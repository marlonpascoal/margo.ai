"""The X-ray jobs of worker-collector, over a repository interface (repo.py has Postgres and memory).

    collect    C02 "Buscar vizinhança": public pages (D47), then the neighborhood (M1-01, M1-02)
    xray_pair  C03 "Confirmar N lojas": pairs (M1-03, M1-04)
    xray_calc  C04 "Calcular raio-X": parity, gap, reading, loss, Pareto (M1-05 to M1-08); status ready

Results returned to the runner are counts and ids only (02 §7).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from .fetcher import Clock, CollectorLock, PoliteFetcher, single_collector
from .ifood_public import AwaitingRecordings, ParsedStore, PublicPages
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


class XrayRepo(Protocol):
    def load_xray(self, xray_id: str) -> XrayRun: ...

    def save_public_store(self, store: ParsedStore) -> str: ...

    def mark_collected(self, xray_id: str, at: datetime) -> None: ...

    def store(self, store_id: str) -> Store: ...

    def public_stores(self) -> list[Store]: ...

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
    """M1-01 and M1-02 over the public catalog; manual C03 choices are kept."""
    x = repo.load_xray(xray_id)
    if x.collected_at is None:
        raise ValueError("the neighborhood needs a collection date")
    manual, delivers = repo.neighborhood_state(xray_id)
    delivers.update(delivers_to_target or {})
    rows = build_neighborhood(
        repo.store(x.target_store_id),
        repo.public_stores(),
        collected_at=x.collected_at,
        settings=x.settings,
        delivers_to_target=delivers,
        manual=manual,
    )
    repo.save_neighborhood(xray_id, rows)
    return {"stores": len(rows), "in_set": sum(1 for r in rows if r.included)}


def collect_step(
    repo: XrayRepo,
    xray_id: str,
    *,
    fetcher: PoliteFetcher,
    pages: PublicPages,
    lock: CollectorLock,
    clock: Clock,
) -> dict[str, int]:
    """C02: collect the target and its neighbors from public pages, then the neighborhood. Any block
    raises out of here and the job fails with its name (C03 shows the reason); nothing is retried."""
    if not pages.ready():
        raise AwaitingRecordings()
    with single_collector(lock):
        now = clock.now()
        fetcher.cache.purge(now)
        x = repo.load_xray(xray_id)
        if not x.target_url:
            raise ValueError("the X-ray has no store URL")
        target = pages.parse_store(x.target_url, fetcher.fetch(x.target_url), now)
        repo.save_public_store(target)
        store_urls: list[str] = []
        for listing in pages.neighborhood_urls(target, x.radius_km, x.categories):
            store_urls += pages.parse_listing(fetcher.fetch(listing))
        delivers: dict[str, bool | None] = {}
        for url in dict.fromkeys(store_urls):
            parsed = pages.parse_store(url, fetcher.fetch(url), now)
            delivers[repo.save_public_store(parsed)] = parsed.delivers_to_target
        repo.mark_collected(xray_id, now)
        result = neighborhood_step(repo, xray_id, delivers)
        repo.snapshot(xray_id)
    return {**result, "requests": fetcher.requests}


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
