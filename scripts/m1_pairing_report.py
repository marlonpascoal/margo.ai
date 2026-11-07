#!/usr/bin/env python3
"""M1-04 pairing scoreboard of one X-ray: counts only, never a name, and nothing written.

    MARGO_LOCAL_DB_URL=... uv run python scripts/m1_pairing_report.py <xray_id>            what is stored
    MARGO_LOCAL_DB_URL=... uv run python scripts/m1_pairing_report.py <xray_id> --dry-run  the rules run now, in memory

The session is read only (the server refuses any write), and only a local database is accepted. The stored mode audits
`xray_pair` and `xray_item` by working out each pair's attributes again; the dry run gets its pairs and parities from
`build_pairs` and `calculate`, over the items of the stores in the set, keeping founder decisions. Lanches and porções
are "pending stage 2": their pairs are only checked to be within the category.
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
from margo_collector.rules import (
    Item,
    Settings,
    item_beverage_attrs_m1_04,
    item_category_m1_04,
    item_is_combo_m1_04,
    normalize_m1_03,
)
from margo_collector.xray import CalcInput, build_pairs, calculate

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
                by_id[r.public_menu_item_id],
                tuple(by_id[p.public_menu_item_id] for p in r.pairs if p.accepted),
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
    """Which of A1 to A5 an accepted pair breaks. Every accepted pair is checked."""
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
    return out


def _example(e: Entry) -> PairView | None:
    """C04 "Exemplo de par", in the order of xray_item_view."""
    shown = [p for p in e.pairs if p.accepted or not _bev(e.own)]
    return min(shown, key=lambda p: (not p.accepted, -p.similarity, p.item.name, p.item.id), default=None)


def scoreboard(entries: Sequence[Entry], pool: Sequence[Item], settings: Settings) -> dict[str, Any]:
    """Counts only. A1 to A5 split what the rule accepted from what a founder accepted: a founder's choice stands."""
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
    misleading = sum(
        1 for e in entries if e.status == "revisar" and e.note == "poucos pares" and not any(p.similarity >= float(settings.similarity_threshold) for p in e.pairs)
    )
    cats = Counter(item_category_m1_04(e.own) or "sem_categoria" for e in entries)
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
        "",
        f"B1 bebidas em revisar com item idêntico em alguma loja: {b['stuck']}",
        f"B2 bebidas em revisar sem motivo válido: {b['no_note']}; motivos: {dict(sorted(b['notes'].items()))}",
        f"B2 revisar por poucos pares sem nenhum item parecido: {b['misleading']}",
        f"B3 itens com paridade abaixo de {min_pairs} lojas, sem revisão de fundador: {b['over_gate']}"
        f"; linhas repetidas na mesma loja, contadas uma vez: {b['dup_rows']}",
        f"B4 bebidas cujo exemplo de par não é idêntico: {b['bad_example']}",
        f"B5 pareamento aguarda: {blocker or 'nada'}; cardápios: {dict(sorted(captures.items()))}",
        "B6 rode pnpm check e os testes M1",
        "",
        f"pareados sem paridade por ter menos de {min_pairs} lojas: {b['no_parity']}",
        f"situação: {dict(sorted(b['status'].items()))}",
        f"revisar por motivo: {dict(sorted(b['review_notes'].items()))}",
        "itens por categoria: " + ", ".join(f"{c} {b['cats'][c]}" for c in (*CATEGORIES, "sem_categoria")),
        f"bebidas do alvo: {b['bev_own']}, ilegível: {b['own_unread']}",
        f"bebidas das lojas: {b['bev_pool']}, ilegível: {b['pool_unread']}",
        f"pendente estágio 2, só dentro da categoria: lanches {b['stage2']['lanches']} itens com par,"
        f" porcoes {b['stage2']['porcoes']} itens com par",
    ]
    return "\n".join(lines)


def report(url: str, xray_id: str, *, dry_run: bool) -> str:
    conn = connect(url)
    try:
        with conn.transaction():
            found = conn.execute("select * from public.xray where id::text like %s limit 2", (f"{xray_id}%",)).fetchall()
            if len(found) != 1:
                raise SystemExit("m1_pairing_report: " + ("unknown X-ray" if not found else "more than one X-ray, give more of the id"))
            x = found[0]
            settings = Settings.from_xray(x["radius_km"], x["rules"])
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


def main(argv: list[str]) -> int:
    args = [a for a in argv if a != "--dry-run"]
    url = os.environ.get("MARGO_LOCAL_DB_URL")
    if len(args) != 1 or not url:
        print("uso: MARGO_LOCAL_DB_URL=... m1_pairing_report.py <xray_id> [--dry-run]", file=sys.stderr)
        return 2
    print(report(url, args[0], dry_run="--dry-run" in argv))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
