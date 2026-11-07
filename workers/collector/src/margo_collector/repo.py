"""XrayRepo implementations: Postgres over a direct connection (local stack, MARGO_LOCAL_DB_URL) and in
memory for unit tests. The REST implementation for Maritime comes with the first deployed worker, like
margo_common's RestJobStore did for jobs."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from fractions import Fraction
from typing import Any

from .fetcher import CACHE_DAYS, CachedPage
from .ifood_public import ParsedStore
from .rules import Item, RankWeights, Store, to_numeric
from .steps import Discovered, XrayRun
from .xray import CalcInput, CalcResult, ItemRow, StoreRow, is_manual

# Memory -------------------------------------------------------------------------------------------


@dataclass
class MemoryXrayRepo:
    xrays: dict[str, XrayRun] = field(default_factory=dict)
    stores: dict[str, Store] = field(default_factory=dict)
    store_by_external: dict[str, str] = field(default_factory=dict)
    items: dict[str, Item] = field(default_factory=dict)
    hood: dict[str, list[StoreRow]] = field(default_factory=dict)
    pairs: dict[str, list[ItemRow]] = field(default_factory=dict)
    item_extra: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    calc: dict[str, CalcResult] = field(default_factory=dict)
    status: dict[str, str] = field(default_factory=dict)
    price_snapshots: dict[str, dict[str, int]] = field(default_factory=dict)
    """M1 history: xray id -> item id -> price in that run. Only added to, never rewritten."""
    discoveries: dict[str, dict[str, Discovered]] = field(default_factory=dict)
    queued: list[tuple[str, str]] = field(default_factory=list)
    extraction_on: bool = True
    blockers: dict[str, str] = field(default_factory=dict)

    def load_xray(self, xray_id: str) -> XrayRun:
        return self.xrays[xray_id]

    def save_public_store(self, store: ParsedStore) -> str:
        sid = self.store_by_external.setdefault(store.external_id, str(uuid.uuid4()))
        self.stores[sid] = Store(
            sid, store.name, store.category, store.lat, store.lng, store.open_seen_at, store.is_national_chain
        )
        for it in store.items:
            iid = f"{sid}:{it.external_item_id}"
            self.items[iid] = Item(iid, sid, it.name, it.price_cents, it.unit, it.unit_qty)  # type: ignore[arg-type]
        return sid

    def mark_collected(self, xray_id: str, at: datetime) -> None:
        self.xrays[xray_id] = replace(self.xrays[xray_id], collected_at=at)

    def store(self, store_id: str) -> Store:
        return self.stores[store_id]

    def public_stores(self, include: list[str] | None = None) -> list[Store]:
        return list(self.stores.values())

    def discovery(self, xray_id: str) -> dict[str, Discovered]:
        return self.discoveries.get(xray_id, {})

    def queue_discover(self, xray_id: str, env: str) -> str | None:
        if not self.extraction_on:
            return None
        self.queued.append(("extract_discover", xray_id))
        return f"job-{xray_id}"

    def queue_captures(self, xray_id: str, env: str) -> int:
        if not self.extraction_on:
            return 0
        x = self.xrays[xray_id]
        ids = [x.target_store_id, *self.included_store_ids(xray_id)]
        self.queued += [("extract_capture", i) for i in ids]
        return len(ids)

    def neighborhood_state(self, xray_id: str):
        rows = self.hood.get(xray_id, [])
        manual = {
            r.public_store_id: (r.included, r.exclusion_reason) for r in rows if is_manual(r.exclusion_reason)
        }
        return manual, {r.public_store_id: r.delivers_to_target for r in rows}  # type: ignore[return-value]

    def save_neighborhood(self, xray_id: str, rows: list[StoreRow], *, keep_rank: bool = False) -> None:
        old = {r.public_store_id: r for r in self.hood.get(xray_id, [])} if keep_rank else {}
        self.hood[xray_id] = [
            replace(r, capture_score=old[r.public_store_id].capture_score, capture_rank=old[r.public_store_id].capture_rank)
            if r.public_store_id in old
            else r
            for r in rows
        ]

    def rank_weights(self) -> RankWeights:
        return RankWeights()

    def included_store_ids(self, xray_id: str) -> list[str]:
        return [r.public_store_id for r in self.hood.get(xray_id, []) if r.included]

    def pair_blocker(self, xray_id: str) -> str | None:
        return self.blockers.get(xray_id)

    def items_of_stores(self, store_ids: list[str]) -> list[Item]:
        ids = set(store_ids)
        return sorted((i for i in self.items.values() if i.store_id in ids), key=lambda i: i.id)

    def pair_decisions(self, xray_id: str):
        return {
            (r.public_menu_item_id, p.public_menu_item_id): (p.accepted, p.by)
            for r in self.pairs.get(xray_id, [])
            for p in r.pairs
            if p.by is not None
        }

    def save_pairs(self, xray_id: str, rows: list[ItemRow]) -> None:
        self.pairs[xray_id] = rows

    def calc_inputs(self, xray_id: str) -> list[CalcInput]:
        out = []
        for r in self.pairs.get(xray_id, []):
            extra = self.item_extra.get((xray_id, r.public_menu_item_id), {})
            accepted = tuple(self.items[p.public_menu_item_id] for p in r.pairs if p.accepted)
            out.append(
                CalcInput(
                    r.public_menu_item_id,
                    self.items[r.public_menu_item_id],
                    accepted,
                    extra.get("weekly_units"),
                    bool(extra.get("skipped")),
                )
            )
        return out

    def save_calc(self, xray_id: str, result: CalcResult) -> None:
        self.calc[xray_id] = result
        self.status[xray_id] = "ready"

    def snapshot(self, xray_id: str) -> None:
        x = self.xrays[xray_id]
        ids = {x.target_store_id, *self.included_store_ids(xray_id)}
        run = self.price_snapshots.setdefault(xray_id, {})
        for i in self.items.values():
            if i.store_id in ids:
                run.setdefault(i.id, i.price_cents)


# Postgres -----------------------------------------------------------------------------------------


def _s(v: Any) -> str | None:
    return None if v is None else str(v)


class PostgresXrayRepo:
    """Direct connection to the local stack. Every save runs in one transaction."""

    def __init__(self, url: str) -> None:
        import psycopg
        from psycopg.rows import dict_row

        self._conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def _tx(self) -> Iterator[Any]:
        with self._conn.transaction():
            yield self._conn

    def _all(self, sql: str, args: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        return self._conn.execute(sql, args).fetchall()

    # load
    def load_xray(self, xray_id: str) -> XrayRun:
        rows = self._all(
            "select x.*, s.url as target_url from public.xray x join public.public_store s on s.id = x.target_store_id"
            " where x.id = %s",
            (xray_id,),
        )
        if not rows:
            raise LookupError("unknown X-ray")
        r = rows[0]
        return XrayRun(
            str(r["id"]),
            _s(r["account_id"]),
            str(r["target_store_id"]),
            r["target_url"],
            r["radius_km"],
            list(r["categories"]),
            dict(r["rules"] or {}),
            r["collected_at"],
        )

    def _store(self, r: dict[str, Any]) -> Store:
        return Store(
            str(r["id"]),
            r["name"],
            r["category"],
            r["lat"],
            r["lng"],
            r["last_seen_open_at"],
            r["is_national_chain"],
            r["rating_count"],
        )

    def store(self, store_id: str) -> Store:
        return self._store(self._all("select * from public.public_store where id = %s", (store_id,))[0])

    def public_stores(self, include: list[str] | None = None) -> list[Store]:
        return [
            self._store(r)
            for r in self._all(
                "select * from public.public_store where (lat is not null and lng is not null)"
                " or id = any(%s::uuid[]) order by id",
                (include or [],),
            )
        ]

    def discovery(self, xray_id: str) -> dict[str, Discovered]:
        rows = self._all("select * from public.xray_discovery(%s)", (xray_id,))
        return {str(r["public_store_id"]): Discovered(r["distance_m"], tuple(r["terms"])) for r in rows}

    def queue_discover(self, xray_id: str, env: str) -> str | None:
        r = self._all("select public.extract_queue_discover(%s, %s) as id", (xray_id, env))[0]
        return _s(r["id"])

    def queue_captures(self, xray_id: str, env: str) -> int:
        return self._all("select public.extract_queue_xray_captures(%s, %s) as n", (xray_id, env))[0]["n"]

    # collection
    def save_public_store(self, store: ParsedStore) -> str:
        with self._tx() as c:
            row = c.execute(
                "insert into public.public_store (channel, external_id, name, url, area, category, lat, lng,"
                " last_seen_open_at, is_national_chain) values ('ifood', %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " on conflict (channel, external_id) do update set name = excluded.name, url = excluded.url,"
                " area = excluded.area, category = excluded.category, lat = excluded.lat, lng = excluded.lng,"
                " last_seen_open_at = coalesce(excluded.last_seen_open_at, public.public_store.last_seen_open_at),"
                " is_national_chain = excluded.is_national_chain returning id",
                (
                    store.external_id,
                    store.name,
                    store.url,
                    store.area,
                    store.category,
                    store.lat,
                    store.lng,
                    store.open_seen_at,
                    store.is_national_chain,
                ),
            ).fetchone()
            sid = row["id"]
            for it in store.items:
                c.execute(
                    "insert into public.public_menu_item (public_store_id, external_item_id, name, description,"
                    " price_cents, unit, unit_qty, collected_at) values (%s, %s, %s, %s, %s, %s, %s, now())"
                    " on conflict (public_store_id, external_item_id) do update set name = excluded.name,"
                    " description = excluded.description, price_cents = excluded.price_cents, unit = excluded.unit,"
                    " unit_qty = excluded.unit_qty, collected_at = excluded.collected_at",
                    (sid, it.external_item_id, it.name, it.description, it.price_cents, it.unit, it.unit_qty),
                )
        return str(sid)

    def snapshot(self, xray_id: str) -> None:
        """M1 history: dated snapshots of the run and its M1-10 ranking (adds only)."""
        self._conn.execute("select app.snapshot_xray(%s)", (xray_id,))

    def mark_collected(self, xray_id: str, at: datetime) -> None:
        self._conn.execute("update public.xray set collected_at = %s where id = %s", (at, xray_id))

    # neighborhood
    def neighborhood_state(self, xray_id: str):
        rows = self._all("select * from public.xray_store where xray_id = %s", (xray_id,))
        manual = {
            str(r["public_store_id"]): (r["included"], r["exclusion_reason"])
            for r in rows
            if is_manual(r["exclusion_reason"])
        }
        return manual, {str(r["public_store_id"]): r["delivers_to_target"] for r in rows}

    def rank_weights(self) -> RankWeights:
        rows = self._all("select key, value from public.rule_param where key like 'm1.rank_weight_%%'")
        v = {r["key"]: Fraction(r["value"]) for r in rows}
        d = RankWeights()
        return RankWeights(
            v.get("m1.rank_weight_ratings", d.ratings),
            v.get("m1.rank_weight_distance", d.distance),
            v.get("m1.rank_weight_terms", d.terms),
        )

    def save_neighborhood(self, xray_id: str, rows: list[StoreRow], *, keep_rank: bool = False) -> None:
        with self._tx() as c:
            for r in rows:
                c.execute(
                    "insert into public.xray_store (xray_id, public_store_id, distance_m, delivers_to_target, included,"
                    " exclusion_reason, capture_score, capture_rank) values (%s, %s, %s, %s, %s, %s, %s, %s)"
                    " on conflict (xray_id, public_store_id) do update"
                    " set distance_m = excluded.distance_m, delivers_to_target = excluded.delivers_to_target,"
                    " included = excluded.included, exclusion_reason = excluded.exclusion_reason,"
                    " capture_score = case when %s then public.xray_store.capture_score else excluded.capture_score end,"
                    " capture_rank = case when %s then public.xray_store.capture_rank else excluded.capture_rank end",
                    (
                        xray_id,
                        r.public_store_id,
                        r.distance_m,
                        r.delivers_to_target,
                        r.included,
                        r.exclusion_reason,
                        to_numeric(r.capture_score) if r.capture_score is not None else None,
                        r.capture_rank,
                        keep_rank,
                        keep_rank,
                    ),
                )
            c.execute(
                "delete from public.xray_store where xray_id = %s and not (public_store_id = any(%s::uuid[]))",
                (xray_id, [r.public_store_id for r in rows]),
            )

    def included_store_ids(self, xray_id: str) -> list[str]:
        return [
            str(r["public_store_id"])
            for r in self._all(
                "select public_store_id from public.xray_store where xray_id = %s and included order by public_store_id",
                (xray_id,),
            )
        ]

    # pairing
    def pair_blocker(self, xray_id: str) -> str | None:
        return self._all("select public.xray_pair_blocker(%s) as b", (xray_id,))[0]["b"]

    def items_of_stores(self, store_ids: list[str]) -> list[Item]:
        rows = self._all(
            "select id, public_store_id, name, comparison_price_cents as price_cents, unit, unit_qty, taxonomy_level1,"
            " taxonomy_level2 from public.public_menu_item where public_store_id = any(%s::uuid[])"
            " and removed_at is null and comparison_price_cents > 0 order by id",
            (store_ids,),
        )
        return [
            Item(
                str(r["id"]),
                str(r["public_store_id"]),
                r["name"],
                r["price_cents"],
                r["unit"],
                r["unit_qty"],
                r["taxonomy_level1"],
                r["taxonomy_level2"],
            )
            for r in rows
        ]

    def pair_decisions(self, xray_id: str):
        rows = self._all(
            "select i.public_menu_item_id as own, p.public_menu_item_id as cand, p.accepted, p.by from public.xray_pair p"
            " join public.xray_item i on i.id = p.xray_item_id where i.xray_id = %s and p.by is not null",
            (xray_id,),
        )
        return {(str(r["own"]), str(r["cand"])): (r["accepted"], str(r["by"])) for r in rows}

    def save_pairs(self, xray_id: str, rows: list[ItemRow]) -> None:
        with self._tx() as c:
            keep_items = []
            for r in rows:
                item = c.execute(
                    "insert into public.xray_item (xray_id, public_menu_item_id, norm_unit, norm_price_cents, pair_status,"
                    " pair_note) values (%s, %s, %s, %s, %s, %s) on conflict (xray_id, public_menu_item_id) do update set"
                    " norm_unit = excluded.norm_unit, norm_price_cents = excluded.norm_price_cents,"
                    " pair_status = excluded.pair_status, pair_note = excluded.pair_note, parity_cents = null,"
                    " gap_pct = null, loss_cents = null, reading = null, pareto_rank = null, pareto_cum_share = null,"
                    " parity_full_cents = null, gap_full_pct = null, full_price_room = false"
                    " returning id",
                    (
                        xray_id,
                        r.public_menu_item_id,
                        r.norm_unit,
                        r.norm_price_cents,
                        r.pair_status,
                        r.pair_note,
                    ),
                ).fetchone()["id"]
                keep_items.append(item)
                for p in r.pairs:
                    c.execute(
                        "insert into public.xray_pair (xray_item_id, public_menu_item_id, similarity, accepted, by)"
                        " values (%s, %s, %s, %s, %s) on conflict (xray_item_id, public_menu_item_id) do update set"
                        " similarity = excluded.similarity, accepted = excluded.accepted, by = excluded.by",
                        (item, p.public_menu_item_id, to_numeric(p.similarity), p.accepted, p.by),
                    )
                c.execute(
                    "delete from public.xray_pair where xray_item_id = %s and not (public_menu_item_id = any(%s::uuid[]))",
                    (item, [p.public_menu_item_id for p in r.pairs]),
                )
            c.execute(
                "delete from public.xray_item where xray_id = %s and not (id = any(%s::uuid[]))",
                (xray_id, keep_items),
            )

    # calculation
    def calc_inputs(self, xray_id: str) -> list[CalcInput]:
        # A run keeps its prices: the snapshot when there is one, else the catalog (M1-05 comparison price). The
        # same for the full price: a null in a snapshot means current, never the catalog's original of today.
        full = (
            "case when sn.id is null then nullif(m.original_price_cents, 0) else sn.full_price_cents end"
            " as full_price_cents"
        )
        items = self._all(
            "select i.id as xray_item_id, i.weekly_units, i.skipped, m.id as item_id, m.public_store_id, m.name,"
            f" coalesce(sn.price_cents, m.comparison_price_cents) as price_cents, m.unit, m.unit_qty, {full}"
            " from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id"
            " left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id"
            " where i.xray_id = %s and m.removed_at is null order by i.id",
            (xray_id,),
        )
        pairs = self._all(
            "select p.xray_item_id, m.id, m.public_store_id, m.name, m.unit, m.unit_qty,"
            f" coalesce(sn.price_cents, m.comparison_price_cents) as price_cents, {full}"
            " from public.xray_pair p join public.public_menu_item m on m.id = p.public_menu_item_id"
            " join public.xray_item i on i.id = p.xray_item_id"
            " left join public.public_menu_item_snapshot sn on sn.xray_id = i.xray_id and sn.public_menu_item_id = m.id"
            " where i.xray_id = %s and p.accepted and m.removed_at is null order by m.id",
            (xray_id,),
        )
        accepted: dict[str, list[Item]] = {}
        for r in pairs:
            accepted.setdefault(str(r["xray_item_id"]), []).append(
                Item(
                    str(r["id"]),
                    str(r["public_store_id"]),
                    r["name"],
                    r["price_cents"],
                    r["unit"],
                    r["unit_qty"],
                    full_price_cents=r["full_price_cents"],
                )
            )
        return [
            CalcInput(
                str(r["xray_item_id"]),
                Item(
                    str(r["item_id"]),
                    str(r["public_store_id"]),
                    r["name"],
                    r["price_cents"],
                    r["unit"],
                    r["unit_qty"],
                    full_price_cents=r["full_price_cents"],
                ),
                tuple(accepted.get(str(r["xray_item_id"]), [])),
                r["weekly_units"],
                r["skipped"],
            )
            for r in items
        ]

    def save_calc(self, xray_id: str, result: CalcResult) -> None:
        with self._tx() as c:
            for r in result.rows:
                c.execute(
                    "update public.xray_item set parity_cents = %s, gap_pct = %s, loss_cents = %s, reading = %s,"
                    " pareto_rank = %s, pareto_cum_share = %s, parity_full_cents = %s, gap_full_pct = %s,"
                    " full_price_room = %s where id = %s and xray_id = %s",
                    (
                        r.parity_cents,
                        to_numeric(r.gap) if r.gap is not None else None,
                        r.loss_cents,
                        r.reading,
                        r.pareto_rank,
                        to_numeric(r.pareto_cum_share) if r.pareto_cum_share is not None else None,
                        r.parity_full_cents,
                        to_numeric(r.gap_full) if r.gap_full is not None else None,
                        r.full_price_room,
                        r.key,
                        xray_id,
                    ),
                )
            c.execute(
                "update public.xray set status = case when status = 'delivered' then status else 'ready' end"
                " where id = %s",
                (xray_id,),
            )


class PostgresPageCache:
    """D47 raw page cache in public.collector_page_cache (service role only)."""

    def __init__(self, url: str) -> None:
        import psycopg
        from psycopg.rows import dict_row

        self._conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)

    def get(self, url: str, now: datetime) -> CachedPage | None:
        r = self._conn.execute(
            "select * from public.collector_page_cache where url = %s and expires_at > %s", (url, now)
        ).fetchone()
        return CachedPage(r["url"], r["status"], bytes(r["body"]), r["fetched_at"]) if r else None

    def put(self, page: CachedPage) -> None:
        self._conn.execute(
            "insert into public.collector_page_cache (url, status, body, fetched_at, expires_at) values (%s, %s, %s, %s, %s)"
            " on conflict (url) do update set status = excluded.status, body = excluded.body,"
            " fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
            (page.url, page.status, page.body, page.fetched_at, page.fetched_at + timedelta(days=CACHE_DAYS)),
        )

    def purge(self, now: datetime) -> int:
        return self._conn.execute(
            "delete from public.collector_page_cache where expires_at <= %s", (now,)
        ).rowcount


class PostgresAdvisoryLock:
    """D47 one collector at a time, across processes: a session advisory lock."""

    KEY = 0x4D31_434F  # "M1CO"

    def __init__(self, url: str) -> None:
        import psycopg

        self._conn = psycopg.connect(url, autocommit=True)

    def try_acquire(self) -> bool:
        return bool(self._conn.execute("select pg_try_advisory_lock(%s)", (self.KEY,)).fetchone()[0])

    def release(self) -> None:
        self._conn.execute("select pg_advisory_unlock(%s)", (self.KEY,))
