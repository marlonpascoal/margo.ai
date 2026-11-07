#!/usr/bin/env python3
"""M1-04 pairing scoreboard of one X-ray: counts only, never a name, and nothing written.

    MARGO_LOCAL_DB_URL=... uv run python scripts/m1_pairing_report.py <xray_id>            what is stored
    MARGO_LOCAL_DB_URL=... uv run python scripts/m1_pairing_report.py <xray_id> --dry-run  the rules run now, in memory
    MARGO_LOCAL_DB_URL=... uv run python scripts/m1_pairing_report.py <xray_id> --exclusives  exclusives by name floor,
                                                                             over every lanche and porção of the set
    MARGO_LOCAL_DB_URL=... uv run python scripts/m1_pairing_report.py --learnings          what the AI taught (M1-04)

The session is read only (the server refuses any write), and only a local database is accepted. The stored mode audits
`xray_pair` and `xray_item` by working out each pair's attributes again; the dry run gets its pairs and parities from
`build_pairs` and `calculate`, over the items of the stores in the set, keeping founder decisions, by the rules alone
(no AI, no learnings). Lanches and porções are checked by their Stage 2 attributes (A6 to A8, B7).

`--learnings` lists the M1-04 Stage 2 learnings as counts by status and, for each pattern, its category, the hints and
the name tokens that are words of the rule lists; any other token (a store's own word) prints as "*".
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from margo_collector.attributes import (
    BEVERAGE_NOTES,
    CATEGORIES,
    compare_beverages,
    quantity_m1_04,
)
from margo_collector.food import (
    EXCLUSIVE_NOTE,
    compare_food_m1_04,
    food_attrs_m1_04,
    signature_hint,
    unreadable_food_m1_04,
    vocabulary_word,
)
from margo_collector.learning import DEFAULT_MIN_RUNS, Learning, Pattern
from margo_collector.rules import (
    Item,
    Settings,
    SizeDefaults,
    is_food_m1_04,
    item_category_m1_04,
    item_food_attrs_m1_04,
    item_is_combo_m1_04,
    name_tokens,
    normalize_m1_03,
    similarity_m1_04,
    size_defaults_m1_04,
)
from margo_collector.rules import (
    item_beverage_attrs_m1_04 as _beverage_attrs,
)
from margo_collector.xray import CalcInput, build_pairs, calculate, presumed_m1_04

SIZES: SizeDefaults | None = None
"""M1-04 default sizes of the X-ray being audited (`scoreboard` sets them): a default is a size like any other."""


def item_beverage_attrs_m1_04(item: Item) -> Any:
    return _beverage_attrs(item, SIZES)

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
ITEM_COLUMNS = (
    "m.id, m.public_store_id, m.name, m.description, m.category, m.comparison_price_cents as price_cents, m.unit,"
    " m.unit_qty, m.taxonomy_level1, m.taxonomy_level2,"
    " (select s.qty from app.size_from_name_m1_03(m.name) s where s.unit = 'ml') as size_ml"
)


@dataclass(frozen=True)
class PairView:
    item: Item
    accepted: bool
    by: str | None
    similarity: float


@dataclass(frozen=True)
class Entry:
    own: Item
    status: str
    note: str | None
    pairs: tuple[PairView, ...]
    parity_cents: int | None
    reviewed: bool
    skipped: bool


def connect(url: str) -> Any:
    import psycopg
    from psycopg.rows import dict_row

    host = urlparse(url).hostname
    if host not in LOCAL_HOSTS:
        raise SystemExit("m1_pairing_report: only a local database")
    conn = psycopg.connect(url, row_factory=dict_row, options="-c default_transaction_read_only=on")
    conn.read_only = True
    return conn


def _item(r: dict[str, Any]) -> Item:
    return Item(
        str(r["id"]),
        str(r["public_store_id"]),
        r["name"],
        r["price_cents"],
        r["unit"],
        r["unit_qty"],
        r["taxonomy_level1"],
        r["taxonomy_level2"],
        section=r["category"],
        description=r["description"],
        size_from_name_ml=r["size_ml"],
    )


def load_stores(conn: Any, x: dict[str, Any]) -> list[Item]:
    """M1-04's pool: the items on sale in the stores of the set, as PostgresXrayRepo.items_of_stores."""
    rows = conn.execute(
        f"select {ITEM_COLUMNS} from public.public_menu_item m"
        " join public.xray_store xs on xs.public_store_id = m.public_store_id and xs.xray_id = %s and xs.included"
        " where m.removed_at is null and m.comparison_price_cents > 0 and not exists ("
        " select 1 from public.xray_capture_states(%s) s where s.public_store_id = m.public_store_id"
        " and s.state = 'missing' and not s.is_target) order by m.id",
        (x["id"], x["id"]),
    ).fetchall()
    return [_item(r) for r in rows]


def load_own(conn: Any, x: dict[str, Any]) -> list[Item]:
    rows = conn.execute(
        f"select {ITEM_COLUMNS} from public.public_menu_item m where m.public_store_id = %s"
        " and m.removed_at is null and m.comparison_price_cents > 0 order by m.id",
        (x["target_store_id"],),
    ).fetchall()
    return [_item(r) for r in rows]


def stored_entries(conn: Any, x: dict[str, Any]) -> list[Entry]:
    pairs: dict[str, list[PairView]] = {}
    for r in conn.execute(
        f"select p.xray_item_id, p.accepted, p.by, p.similarity, {ITEM_COLUMNS} from public.xray_pair p"
        " join public.xray_item i on i.id = p.xray_item_id"
        " join public.public_menu_item m on m.id = p.public_menu_item_id where i.xray_id = %s",
        (x["id"],),
    ).fetchall():
        pairs.setdefault(str(r["xray_item_id"]), []).append(PairView(_item(r), r["accepted"], r["by"], float(r["similarity"])))
    return [
        Entry(
            _item(r),
            r["pair_status"],
            r["pair_note"],
            tuple(pairs.get(str(r["item_id"]), ())),
            r["parity_cents"],
            r["reviewed_by"] is not None,
            r["skipped"],
        )
        for r in conn.execute(
            f"select i.id as item_id, i.pair_status, i.pair_note, i.parity_cents, i.reviewed_by, i.skipped, {ITEM_COLUMNS}"
            " from public.xray_item i join public.public_menu_item m on m.id = i.public_menu_item_id where i.xray_id = %s",
            (x["id"],),
        ).fetchall()
    ]


def dry_run_entries(conn: Any, x: dict[str, Any], own: Sequence[Item], pool: Sequence[Item], settings: Settings) -> list[Entry]:
    decided = {
        (str(r["own"]), str(r["cand"])): (r["accepted"], str(r["by"]))
        for r in conn.execute(
            "select i.public_menu_item_id as own, p.public_menu_item_id as cand, p.accepted, p.by from public.xray_pair p"
            " join public.xray_item i on i.id = p.xray_item_id where i.xray_id = %s and p.by is not null",
            (x["id"],),
        ).fetchall()
    }
    state = {
        str(r["public_menu_item_id"]): r
        for r in conn.execute(
            "select public_menu_item_id, reviewed_by, skipped, weekly_units from public.xray_item where xray_id = %s", (x["id"],)
        ).fetchall()
    }
    rows = build_pairs(own, pool, settings, decided)
    by_id = {i.id: i for i in [*own, *pool]}
    inputs = []
    for r in rows:
        st = state.get(r.public_menu_item_id, {})
        inputs.append(
            CalcInput(
                r.public_menu_item_id,
                presumed_m1_04(by_id[r.public_menu_item_id], r.size_presumed_ml),
                tuple(presumed_m1_04(by_id[p.public_menu_item_id], p.size_presumed_ml) for p in r.pairs if p.accepted),
                st.get("weekly_units"),
                bool(st.get("skipped")),
                st.get("reviewed_by") is not None,
            )
        )
    parity = {c.key: c.parity_cents for c in calculate(inputs, settings.reading_band, settings.min_pairs).rows}
    return [
        Entry(
            by_id[r.public_menu_item_id],
            r.pair_status,
            r.pair_note,
            tuple(PairView(by_id[p.public_menu_item_id], p.accepted, p.by, float(p.similarity)) for p in r.pairs),
            parity[r.public_menu_item_id],
            state.get(r.public_menu_item_id, {}).get("reviewed_by") is not None,
            bool(state.get(r.public_menu_item_id, {}).get("skipped")),
        )
        for r in rows
    ]


def _bev(i: Item) -> bool:
    return item_category_m1_04(i) == "bebidas" and not item_is_combo_m1_04(i)


def _violations(own: Item, c: Item) -> set[str]:
    """Which of A1 to A8 an accepted pair breaks. Every accepted pair is checked; A6 to A8 by the rule's attributes."""
    out = set()
    if item_is_combo_m1_04(own) != item_is_combo_m1_04(c):
        out.add("A4")
    if quantity_m1_04(own.name) != quantity_m1_04(c.name):
        out.add("A5")
    if item_category_m1_04(own) != item_category_m1_04(c):
        out.add("A3")
    if _bev(own) and _bev(c):
        a, b = item_beverage_attrs_m1_04(own), item_beverage_attrs_m1_04(c)
        if a.size_ml is None or a.size_ml != b.size_ml:
            out.add("A1")
        if (a.type, a.brand, a.flavor, a.variant) != (b.type, b.brand, b.flavor, b.variant) or a.type is None:
            out.add("A2")
    if is_food_m1_04(own) and is_food_m1_04(c):
        fa, fb = item_food_attrs_m1_04(own), item_food_attrs_m1_04(c)
        if fa.proteins != fb.proteins or not fa.proteins and item_category_m1_04(own) == "lanches":
            out.add("A6")
        if fa.patties != fb.patties:
            out.add("A7")
        if normalize_m1_03(own).unit != "100g" and (
            (fa.weight_g is not None and fb.weight_g is not None and fa.weight_g != fb.weight_g)
            or (fa.portion is not None and fb.portion is not None and fa.portion != fb.portion)
        ):
            out.add("A8")
    return out


def _same_food(own: Item, c: Item, threshold: float) -> bool:
    """B7: an item elsewhere identical to `own`: same category, quantity and unit, the same Stage 2 attributes by the
    rule, and a name at or above the similarity threshold (the Stage 1 "same name")."""
    if c.store_id == own.store_id or not is_food_m1_04(c) or item_category_m1_04(c) != item_category_m1_04(own):
        return False
    if quantity_m1_04(c.name) != quantity_m1_04(own.name) or normalize_m1_03(c).unit != normalize_m1_03(own).unit:
        return False
    a, b = item_food_attrs_m1_04(own), item_food_attrs_m1_04(c)
    if unreadable_food_m1_04(b, item_category_m1_04(c)) is not None:
        return False
    by_weight = normalize_m1_03(own).unit == "100g"
    return compare_food_m1_04(a, b, by_weight=by_weight) == "identical" and float(similarity_m1_04(own.name, c.name)) >= threshold


def _example(e: Entry) -> PairView | None:
    """C04 "Exemplo de par", in the order of xray_item_view."""
    shown = [p for p in e.pairs if p.accepted or not _bev(e.own)]
    return min(shown, key=lambda p: (not p.accepted, -p.similarity, p.item.name, p.item.id), default=None)


def scoreboard(entries: Sequence[Entry], pool: Sequence[Item], settings: Settings) -> dict[str, Any]:
    """Counts only. A1 to A8 split what the rule accepted from what a founder accepted: a founder's choice stands."""
    global SIZES
    SIZES = size_defaults_m1_04([*pool, *(e.own for e in entries)], settings)
    presumed_pairs = sum(
        1
        for e in entries
        for p in e.pairs
        if p.accepted and _bev(e.own) and (item_beverage_attrs_m1_04(e.own).size_presumed or item_beverage_attrs_m1_04(p.item).size_presumed)
    )
    resolved = sum(
        1 for e in entries if _bev(e.own) and _beverage_attrs(e.own).size_ml is None and item_beverage_attrs_m1_04(e.own).size_ml is not None
    )
    pool_resolved = sum(
        1 for i in pool if _bev(i) and _beverage_attrs(i).size_ml is None and item_beverage_attrs_m1_04(i).size_ml is not None
    )
    by_rule: Counter[str] = Counter()
    by_founder: Counter[str] = Counter()
    for e in entries:
        for p in e.pairs:
            if p.accepted:
                for v in _violations(e.own, p.item):
                    (by_founder if p.by else by_rule)[v] += 1
    bevs_pool = [i for i in pool if _bev(i)]
    bev_entries = [e for e in entries if _bev(e.own)]
    stuck = no_note = bad_example = over_gate = no_parity = dup_rows = 0
    notes: Counter[str] = Counter()
    for e in bev_entries:
        attrs = item_beverage_attrs_m1_04(e.own)
        rejected = {p.item.id for p in e.pairs if p.by and not p.accepted}
        identical = any(
            c.store_id != e.own.store_id
            and c.id not in rejected
            and normalize_m1_03(c).unit == normalize_m1_03(e.own).unit
            and compare_beverages(attrs, item_beverage_attrs_m1_04(c)) == "identical"
            for c in bevs_pool
        )
        if e.status == "revisar":
            notes[e.note or "sem motivo"] += 1
            stuck += identical
            no_note += e.note not in BEVERAGE_NOTES
    for e in entries:
        accepted = [p for p in e.pairs if p.accepted]
        stores = {p.item.store_id for p in accepted}
        dup_rows += len(accepted) - len(stores)
        if e.parity_cents is not None and not e.reviewed and len(stores) < settings.min_pairs:
            over_gate += 1
        if e.parity_cents is None and accepted and not e.skipped and e.status != "revisar":
            no_parity += 1
        ex = _example(e)
        if ex is not None and _bev(e.own) and not ex.by:
            bad_example += compare_beverages(item_beverage_attrs_m1_04(e.own), item_beverage_attrs_m1_04(ex.item)) != "identical"
    def has_like(e: Entry) -> bool:
        """B2: "poucos pares" needs some store with the same item: a similar name, or for lanches and porções the
        same attributes (Stage 2)."""
        if is_food_m1_04(e.own):
            return any(_same_food(e.own, p.item, float(settings.attribute_floor)) for p in e.pairs)
        return any(p.similarity >= float(settings.similarity_threshold) for p in e.pairs)

    misleading = sum(1 for e in entries if e.status == "revisar" and e.note == "poucos pares" and not has_like(e))
    cats = Counter(item_category_m1_04(e.own) or "sem_categoria" for e in entries)
    food_pool = [i for i in pool if is_food_m1_04(i)]
    exclusives = [e for e in entries if e.status == "exclusivo"]
    b7 = sum(1 for e in exclusives if any(_same_food(e.own, c, float(settings.similarity_threshold)) for c in food_pool))
    unread_own = Counter(
        r for e in entries if is_food_m1_04(e.own) and (r := unreadable_food_m1_04(item_food_attrs_m1_04(e.own), item_category_m1_04(e.own)))
    )
    unread_pool = Counter(r for i in food_pool if (r := unreadable_food_m1_04(item_food_attrs_m1_04(i), item_category_m1_04(i))))
    pool_attr = [item_beverage_attrs_m1_04(i) for i in bevs_pool]
    own_attr = [item_beverage_attrs_m1_04(e.own) for e in bev_entries]

    def unread(attrs: list[Any]) -> dict[str, int]:
        return {
            "tipo": sum(1 for a in attrs if a.type is None),
            "tamanho": sum(1 for a in attrs if a.size_ml is None),
            "marca": sum(1 for a in attrs if a.brand is None),
            "sabor": sum(1 for a in attrs if a.flavor is None),
        }

    return {
        "by_rule": by_rule,
        "by_founder": by_founder,
        "stuck": stuck,
        "no_note": no_note,
        "misleading": misleading,
        "notes": notes,
        "over_gate": over_gate,
        "no_parity": no_parity,
        "dup_rows": dup_rows,
        "bad_example": bad_example,
        "cats": cats,
        "status": Counter(e.status for e in entries),
        "review_notes": Counter(e.note or "sem motivo" for e in entries if e.status == "revisar"),
        "bev_own": len(bev_entries),
        "bev_pool": len(bevs_pool),
        "own_unread": unread(own_attr),
        "pool_unread": unread(pool_attr),
        "stage2": {
            c: (sum(1 for e in entries if item_category_m1_04(e.own) == c and any(p.accepted for p in e.pairs)))
            for c in ("lanches", "porcoes")
        },
        "presumed_pairs": presumed_pairs,
        "size_resolved": resolved,
        "size_resolved_pool": pool_resolved,
        "derived_sizes": dict(sorted(SIZES.derived.items())),
        "exclusives": len(exclusives),
        "exclusives_hint": sum(1 for e in exclusives if signature_hint(e.own.name)),
        "exclusives_founder": sum(1 for e in exclusives if any(p.accepted for p in e.pairs)),
        "b7": b7,
        "unread_own": unread_own,
        "unread_pool": unread_pool,
        "food_pool": len(food_pool),
    }


def render(b: dict[str, Any], *, mode: str, xray: str, stores: dict[str, int], blocker: str | None, captures: Counter[str], min_pairs: int) -> str:
    def a(code: str, what: str) -> str:
        return f"{code} {what}: {b['by_rule'][code]} pela regra, {b['by_founder'][code]} por fundador"

    lines = [
        f"M1-04 placar, {mode}, raio-X {xray[:8]}",
        f"lojas no conjunto: {stores['in_set']}, com itens: {stores['with_items']}",
        "",
        a("A1", "bebida com outro tamanho"),
        a("A2", "bebida com outra marca, sabor ou variante"),
        a("A3", "pares entre categorias"),
        a("A4", "combo com item único"),
        a("A5", "quantidade com item único"),
        a("A6", "lanche ou porção com outra proteína"),
        a("A7", "simples com duplo ou triplo"),
        a("A8", "outro peso ou tamanho de porção escrito"),
        "",
        f"B1 bebidas em revisar com item idêntico em alguma loja: {b['stuck']}",
        f"B2 bebidas em revisar sem motivo válido: {b['no_note']}; motivos: {dict(sorted(b['notes'].items()))}",
        f"B2 revisar por poucos pares sem nenhum item parecido: {b['misleading']}",
        f"B3 itens com paridade abaixo de {min_pairs} lojas, sem revisão de fundador: {b['over_gate']}"
        f"; linhas repetidas na mesma loja, contadas uma vez: {b['dup_rows']}",
        f"B4 bebidas cujo exemplo de par não é idêntico: {b['bad_example']}",
        f"pares com tamanho presumido: {b['presumed_pairs']}; tamanho ilegível resolvido pelo padrão: alvo"
        f" {b['size_resolved']}, lojas {b['size_resolved_pool']}; padrões por marca e embalagem: {b['derived_sizes']}",
        f"B7 exclusivos com item idêntico em alguma loja: {b['b7']}",
        f"B5 pareamento aguarda: {blocker or 'nada'}; cardápios: {dict(sorted(captures.items()))}",
        "B6 rode pnpm check e os testes M1",
        "",
        f"pareados sem paridade por ter menos de {min_pairs} lojas: {b['no_parity']}",
        f"situação: {dict(sorted(b['status'].items()))}",
        f"revisar por motivo: {dict(sorted(b['review_notes'].items()))}",
        "itens por categoria: " + ", ".join(f"{c} {b['cats'][c]}" for c in (*CATEGORIES, "sem_categoria")),
        f"bebidas do alvo: {b['bev_own']}, ilegível: {b['own_unread']}",
        f"bebidas das lojas: {b['bev_pool']}, ilegível: {b['pool_unread']}",
        f"estágio 2: lanches {b['stage2']['lanches']} itens com par, porcoes {b['stage2']['porcoes']} itens com par",
        f"{EXCLUSIVE_NOTE}: {b['exclusives']} (com palavra de assinatura: {b['exclusives_hint']},"
        f" pareados por fundador: {b['exclusives_founder']})",
        f"precisam de IA (regra não lê): alvo {dict(sorted(b['unread_own'].items()))};"
        f" lojas {dict(sorted(b['unread_pool'].items()))} de {b['food_pool']} lanches e porções",
    ]
    return "\n".join(lines)


def sized(item: Item) -> Item:
    """M1-03 for a beverage that takes a default size."""
    from margo_collector.rules import sized_item_m1_04

    return sized_item_m1_04(item, SIZES)


def settings_of(conn: Any, x: dict[str, Any]) -> Settings:
    """The X-ray's settings with the M1-04 default sizes from rule_param, as PostgresXrayRepo.load_xray."""
    v = {r["key"]: r["value"] for r in conn.execute("select key, value from public.rule_param where key like 'm1.default\\_%%'").fetchall()}
    rules: dict[str, Any] = {}
    sizes = {k.removeprefix("m1.default_ml."): int(n) for k, n in v.items() if k.startswith("m1.default_ml.")}
    if sizes:
        rules["default_sizes"] = sizes
    if "m1.default_size_min_rows" in v:
        rules["default_size_min_rows"] = int(v["m1.default_size_min_rows"])
    if "m1.default_size_min_share" in v:
        rules["default_size_min_share"] = str(v["m1.default_size_min_share"])
    return Settings.from_xray(x["radius_km"], {**rules, **dict(x["rules"] or {})})


def _xray(conn: Any, xray_id: str) -> dict[str, Any]:
    found = conn.execute("select * from public.xray where id::text like %s limit 2", (f"{xray_id}%",)).fetchall()
    if len(found) != 1:
        raise SystemExit("m1_pairing_report: " + ("unknown X-ray" if not found else "more than one X-ray, give more of the id"))
    return found[0]


def report(url: str, xray_id: str, *, dry_run: bool) -> str:
    conn = connect(url)
    try:
        with conn.transaction():
            x = _xray(conn, xray_id)
            settings = settings_of(conn, x)
            pool = load_stores(conn, x)
            own = load_own(conn, x)
            entries = dry_run_entries(conn, x, own, pool, settings) if dry_run else stored_entries(conn, x)
            in_set = conn.execute(
                "select count(*) as n from public.xray_store where xray_id = %s and included", (x["id"],)
            ).fetchone()["n"]
            blocker = conn.execute("select public.xray_pair_blocker(%s) as b", (x["id"],)).fetchone()["b"]
            captures = Counter(
                r["state"] for r in conn.execute("select state from public.xray_capture_states(%s)", (x["id"],)).fetchall()
            )
    finally:
        conn.close()
    return render(
        scoreboard(entries, pool, settings),
        mode="dry-run" if dry_run else "gravado",
        xray=str(x["id"]),
        stores={"in_set": in_set, "with_items": len({i.store_id for i in pool})},
        blocker=blocker,
        captures=captures,
        min_pairs=settings.min_pairs,
    )


FLOORS = (0.0, 0.01, 0.25, 0.34, 0.5, 0.6)


def exclusives_by_floor(pool: Sequence[Item], min_pairs: int, threshold: float) -> list[dict[str, int]]:
    """Every single lanche and porção of the set, each as if it were the target: how many would be exclusive at each
    name floor (`attribute_floor`), with B7 at that floor and the signature hint. Counts only."""
    items = [i for i in pool if is_food_m1_04(i)]
    info = {}
    for i in items:
        c = item_category_m1_04(i)
        a = food_attrs_m1_04(i.name, i.description, c)
        info[i.id] = (c, a, unreadable_food_m1_04(a, c), quantity_m1_04(i.name), normalize_m1_03(i).unit, name_tokens(i.name))
    blocks: dict[tuple[Any, ...], list[Item]] = {}
    for i in items:
        c, a, r, q, u, _ = info[i.id]
        if r is None:
            blocks.setdefault((c, a.proteins, a.patties, q, u), []).append(i)

    def dice(x: frozenset[str], y: frozenset[str]) -> float:
        return 2 * len(x & y) / (len(x) + len(y)) if x and y else 0.0

    rows = [dict(floor=int(f * 100), auto=0, poucos=0, exclusivo=0, b7=0, assinatura=0) for f in FLOORS]
    for i in items:
        c, a, r, q, u, t = info[i.id]
        if r is not None:
            continue
        best: dict[str, float] = {}
        for j in blocks[(c, a.proteins, a.patties, q, u)]:
            if j.store_id != i.store_id and compare_food_m1_04(a, info[j.id][1], by_weight=u == "100g") == "identical":
                best[j.store_id] = max(best.get(j.store_id, -1.0), dice(t, info[j.id][5]))
        top = max(best.values(), default=-1.0)
        for f, row in zip(FLOORS, rows, strict=True):
            n = sum(1 for v in best.values() if v >= f)
            kind = "exclusivo" if n == 0 else "poucos" if n < min_pairs else "auto"
            row[kind] += 1
            if kind == "exclusivo":
                row["b7"] += top >= threshold
                row["assinatura"] += signature_hint(i.name)
    return rows


def exclusives_report(url: str, xray_id: str) -> str:
    conn = connect(url)
    try:
        with conn.transaction():
            x = _xray(conn, xray_id)
            settings = settings_of(conn, x)
            pool = load_stores(conn, x) + load_own(conn, x)
    finally:
        conn.close()
    lines = [f"M1-04 exclusivos por piso de nome, raio-X {str(x['id'])[:8]}, todos os lanches e porções do conjunto"]
    lines += [
        f"piso {r['floor']}%: pareado {r['auto']}, poucos pares {r['poucos']}, exclusivo {r['exclusivo']}"
        f" (B7 {r['b7']}, palavra de assinatura {r['assinatura']})"
        for r in exclusives_by_floor(pool, settings.min_pairs, float(settings.similarity_threshold))
    ]
    return "\n".join(lines)


def learning_lines(learnings: Sequence[Learning], min_runs: int) -> list[str]:
    """Counts by status, then one line per pattern with only the rule-list words of its name."""
    by = Counter(lr.status(min_runs) for lr in learnings)
    lines = [
        f"M1-04 aprendizados: {len(learnings)} padrões; promovidos {by['promovido']}, pendentes {by['pendente']},"
        f" disputados {by['disputado']}, de fundador {by['fundador']} (promove com {min_runs} rodadas iguais)"
    ]
    for status in ("promovido", "fundador", "disputado", "pendente"):
        for lr in sorted((lr for lr in learnings if lr.status(min_runs) == status), key=lambda lr: (-lr.items_seen, lr.pattern)):
            p: Pattern = lr.pattern
            words = " ".join(t if vocabulary_word(t) else "*" for t in p.tokens)
            answers = len({str(sorted(a.items())) for a in lr.answers.values()})
            lines.append(
                f"  {status}: {p.category} [{words}] dicas {list(p.hints)}; rodadas {len(lr.answers)},"
                f" respostas diferentes {answers}, itens vistos {lr.items_seen}"
            )
    return lines


def learnings_report(url: str) -> str:
    conn = connect(url)
    try:
        with conn.transaction():
            rows = conn.execute(
                "select l.category, l.tokens, l.hints, l.founder_attrs, l.founder_disputed_at, l.items_seen,"
                " coalesce(jsonb_object_agg(r.xray_id::text, r.attrs) filter (where r.xray_id is not null), '{}') as answers"
                " from public.m1_attr_learning l left join public.m1_attr_learning_run r on r.learning_id = l.id group by l.id"
            ).fetchall()
            param = conn.execute("select value from public.rule_param where key = 'm1.attr_learning_min_runs'").fetchone()
    finally:
        conn.close()
    learnings = [
        Learning(
            Pattern(r["category"], tuple(r["tokens"]), tuple(r["hints"])),
            dict(r["answers"]),
            r["founder_attrs"],
            r["founder_disputed_at"] is not None,
            r["items_seen"],
        )
        for r in rows
    ]
    return "\n".join(learning_lines(learnings, int(param["value"]) if param else DEFAULT_MIN_RUNS))


def main(argv: list[str]) -> int:
    flags = {"--dry-run", "--exclusives", "--learnings"}
    args = [a for a in argv if a not in flags]
    url = os.environ.get("MARGO_LOCAL_DB_URL")
    if url and "--learnings" in argv and not args:
        print(learnings_report(url))
        return 0
    if len(args) != 1 or not url:
        print("uso: MARGO_LOCAL_DB_URL=... m1_pairing_report.py <xray_id> [--dry-run | --exclusives] | --learnings", file=sys.stderr)
        return 2
    if "--exclusives" in argv:
        print(exclusives_report(url, args[0]))
        return 0
    print(report(url, args[0], dry_run="--dry-run" in argv))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
