"""Offline evaluation of P23 "Oportunidades" (D68, D70): SINTÉTICO runs of different shapes, and a deterministic scorer
for recorded answers. Marlon records one answer per scenario (`uv run record-ai-opportunities --all`); anyone scores the
recordings offline (`uv run score-ai-opportunities`), so prompt versions and models are compared without an API call.

Every item name is SINTÉTICO; no store name, no person.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from decimal import Decimal
from pathlib import Path
from typing import Any

from .opportunities import LEVERS, LONG_DASH, MAX_OPPORTUNITIES, Facts, build_facts, check_all, parse_response

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "ai"
BAND = 0.1

# Scenarios -----------------------------------------------------------------------------------------------------------


def item(
    run: int, n: int, name: str, group: str, own: int, parity: int, low: int, high: int, stores: int,
    reading: str | None = None,
) -> dict[str, Any]:
    """One compared item as monitor_result carries it; the M1-07 reading from the gap when not given."""
    gap = round((own - parity) / parity, 4)
    if reading is None:
        reading = "nao_mexer" if gap >= BAND else ("pode_subir" if gap <= -BAND else "na_media")
    return {
        "item_id": f"00000000-0000-4000-8{run:03d}-{n:012d}",
        "name": name,
        "group": group,
        "own_cents": own,
        "parity_cents": parity,
        "low_cents": low,
        "high_cents": high,
        "gap_pct": gap,
        "reading": reading,
        "stores": stores,
    }


def run_of(
    items: list[dict[str, Any]], *, stores_compared: int, only_yours: int = 0, rank: int | None = None,
    stores_ranked: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """A ready own run (RESULT, POSITIONS) whose counts follow from its items: M1-07 readings, M1-12 v3 scores (a
    category with fewer than 5 items has none), price_gap_per_sale_cents over the `pode_subir` items."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        groups.setdefault(it["group"], []).append(it)

    def count(rows: list[dict[str, Any]], reading: str) -> int:
        return sum(1 for r in rows if r["reading"] == reading)

    def aligned(rows: list[dict[str, Any]]) -> int:
        return round(100 * count(rows, "na_media") / len(rows))

    by_category = [
        {
            "group": g,
            "items": len(rows),
            "items_compared": len(rows),
            "can_go_up": count(rows, "pode_subir"),
            "leave_alone": count(rows, "nao_mexer"),
            "at_average": count(rows, "na_media"),
            "price_gap_per_sale_cents": sum(r["parity_cents"] - r["own_cents"] for r in rows if r["reading"] == "pode_subir"),
        }
        for g, rows in groups.items()
    ]
    result = {
        "status": "ready",
        "target_kind": "own",
        "radius_km": 3,
        "reading_band": BAND,
        "stores_compared": stores_compared,
        "items_total": len(items) + only_yours,
        "items_analyzed": len(items),
        "below": count(items, "pode_subir"),
        "above": count(items, "nao_mexer"),
        "only_yours": only_yours,
        "position": {"rank": rank, "stores_ranked": stores_ranked} if rank else None,
        "items": items,
        "by_category": by_category,
    }
    positions = {
        "score": {"score": aligned(items), "items": len(items)},
        "by_category": [{"group": g, "score": {"score": aligned(rows)}} for g, rows in groups.items() if len(rows) >= 5],
    }
    return result, positions


BASE_ITEMS = [
    item(0, 1, "X-Burger Sintético", "lanches", 2400, 2900, 2500, 3400, 9, "pode_subir"),
    item(0, 2, "X-Salada Sintético", "lanches", 2600, 3000, 2600, 3500, 8, "pode_subir"),
    item(0, 3, "X-Bacon Sintético", "lanches", 3200, 3250, 2800, 3700, 10, "na_media"),
    item(0, 4, "Batata Frita Sintética 400 g", "porcoes", 3900, 3200, 2600, 3800, 7, "nao_mexer"),
    item(0, 5, "Pudim Sintético", "sobremesas", 1200, 1250, 900, 1600, 5, "na_media"),
    item(0, 6, "Refrigerante Sintético 350 ml", "bebidas", 700, 650, 550, 800, 11, "na_media"),
]
"""The first recorded run (record_opportunities.RESULT); ids 00000000-0000-4000-8000-00000000000n."""

BASE_RESULT: dict[str, Any] = {
    "status": "ready",
    "target_kind": "own",
    "radius_km": 3,
    "reading_band": 0.1,
    "stores_compared": 14,
    "items_total": 9,
    "items_analyzed": 6,
    "below": 2,
    "above": 1,
    "only_yours": 2,
    "position": {"rank": 4, "stores_ranked": 12, "price_index": 0.97, "items_compared": 6},
    "items": BASE_ITEMS,
    "by_category": [
        {"group": "lanches", "items": 4, "items_compared": 3, "can_go_up": 2, "leave_alone": 0, "at_average": 1,
         "price_gap_per_sale_cents": 900},
        {"group": "porcoes", "items": 1, "items_compared": 1, "can_go_up": 0, "leave_alone": 1, "at_average": 0,
         "price_gap_per_sale_cents": 0},
        {"group": "sobremesas", "items": 2, "items_compared": 1, "can_go_up": 0, "leave_alone": 0, "at_average": 1,
         "price_gap_per_sale_cents": 0},
        {"group": "bebidas", "items": 2, "items_compared": 1, "can_go_up": 0, "leave_alone": 0, "at_average": 1,
         "price_gap_per_sale_cents": 0},
    ],
}
BASE_POSITIONS: dict[str, Any] = {
    "score": {"score": 50, "items": 6},
    "by_category": [{"group": "lanches", "score": None, "position": {"rank": 3, "stores_ranked": 9}}],
}

MUITOS_PODE_SUBIR = run_of(
    [
        item(1, 1, "X-Burger Sintético", "lanches", 2200, 2790, 2400, 3300, 10),
        item(1, 2, "X-Salada Sintético", "lanches", 2400, 2990, 2600, 3500, 9),
        item(1, 3, "X-Bacon Sintético", "lanches", 2700, 3290, 2900, 3900, 11),
        item(1, 4, "X-Tudo Sintético", "lanches", 3200, 4190, 3600, 4900, 8),
        item(1, 5, "X-Egg Sintético", "lanches", 2600, 2750, 2300, 3200, 9),
        item(1, 6, "Prato Feito Sintético", "pratos", 2500, 3200, 2700, 3900, 7),
        item(1, 7, "Parmegiana Sintética", "pratos", 3900, 4800, 4100, 5900, 6),
        item(1, 8, "Strogonoff Sintético", "pratos", 3400, 3600, 3000, 4200, 6),
        item(1, 9, "Refrigerante Lata Sintético 350 ml", "bebidas", 600, 650, 550, 750, 12),
    ],
    stores_compared=15, only_yours=3, rank=2, stores_ranked=13,
)
"""Most of the menu below the middle, firm comparisons: which to test first, the category view, one at a time."""

MAIORIA_NAO_MEXER = run_of(
    [
        item(2, 1, "X-Burger Sintético", "lanches", 3290, 2790, 2400, 3300, 10),
        item(2, 2, "X-Salada Sintético", "lanches", 3490, 2990, 2600, 3500, 9),
        item(2, 3, "X-Bacon Sintético", "lanches", 3990, 3290, 2900, 3900, 11),
        item(2, 4, "X-Frango Sintético", "lanches", 3100, 2950, 2500, 3400, 8),
        item(2, 5, "Batata Frita Sintética 300 g", "porcoes", 2990, 2400, 1900, 2900, 9),
        item(2, 6, "Anéis de Cebola Sintéticos 200 g", "porcoes", 2600, 2900, 2200, 3300, 6),
        item(2, 7, "Milkshake Sintético 400 ml", "sobremesas", 2200, 1800, 1500, 2400, 7),
    ],
    stores_compared=13, rank=11, stores_ranked=12,
)
"""Most items above the middle: rever_custo with the money-free framing, where to keep, the one item below."""

POUCAS_LOJAS = run_of(
    [
        item(3, 1, "Hambúrguer Artesanal Sintético", "lanches", 3800, 4500, 4200, 4900, 3),
        item(3, 2, "Hambúrguer Duplo Sintético", "lanches", 4600, 4300, 4300, 4300, 1),
        item(3, 3, "Batata Rústica Sintética", "porcoes", 2800, 2900, 2500, 3300, 4),
        item(3, 4, "Brownie Sintético", "sobremesas", 1500, 1200, 1000, 1400, 2),
        item(3, 5, "Suco Natural Sintético 500 ml", "bebidas", 1100, 1000, 900, 1100, 3),
    ],
    stores_compared=4, only_yours=6,
)
"""Few stores everywhere: acompanhar, the caveat on every item, more stores make the read firmer."""

PORCAO_ESPALHADA = run_of(
    [
        item(4, 1, "Isca de Peixe Sintética", "porcoes", 5500, 8200, 3900, 11900, 8),
        item(4, 2, "Batata Frita Sintética", "porcoes", 3000, 4200, 2200, 9000, 9),
        item(4, 3, "Calabresa Acebolada Sintética 500 g", "porcoes", 4200, 4400, 3800, 5200, 7),
        item(4, 4, "Frango a Passarinho Sintético", "porcoes", 6900, 5200, 3400, 8800, 6),
        item(4, 5, "Chopp Sintético 300 ml", "bebidas", 1200, 1100, 900, 1400, 8),
        item(4, 6, "Caipirinha Sintética", "bebidas", 1800, 1900, 1500, 2400, 7),
    ],
    stores_compared=11, only_yours=1, rank=5, stores_ranked=10,
)
"""Portions with widely spread neighbor prices: say both, sizes may differ and the face price still shows the gap."""

BEBIDAS_POUCO_ACIMA = run_of(
    [
        item(5, 1, "Refrigerante Cola Lata Sintético 350 ml", "bebidas", 890, 800, 600, 1000, 12),
        item(5, 2, "Refrigerante Laranja Lata Sintético 350 ml", "bebidas", 890, 800, 650, 950, 10),
        item(5, 3, "Água Sintética 500 ml", "bebidas", 500, 400, 300, 600, 11),
        item(5, 4, "Suco de Laranja Sintético 500 ml", "bebidas", 1200, 1150, 900, 1400, 8),
        item(5, 5, "Bacon Extra Sintético", "adicionais", 600, 500, 400, 800, 7),
        item(5, 6, "Cheddar Extra Sintético", "adicionais", 400, 450, 300, 600, 6),
        item(5, 7, "X-Burger Sintético", "lanches", 2890, 2900, 2500, 3400, 10),
        item(5, 8, "X-Salada Sintético", "lanches", 3090, 3000, 2600, 3500, 9),
        item(5, 9, "X-Bacon Sintético", "lanches", 3290, 3350, 2800, 3900, 10),
    ],
    stores_compared=14, only_yours=2, rank=6, stores_ranked=13,
)
"""Beverages and add-ons slightly above, burgers in the band: a price point read, not a cost review."""

SCENARIOS: dict[str, tuple[Mapping[str, Any], Mapping[str, Any]]] = {
    "base": (BASE_RESULT, BASE_POSITIONS),
    "muitos_pode_subir": MUITOS_PODE_SUBIR,
    "maioria_nao_mexer": MAIORIA_NAO_MEXER,
    "poucas_lojas": POUCAS_LOJAS,
    "porcao_espalhada": PORCAO_ESPALHADA,
    "bebidas_pouco_acima": BEBIDAS_POUCO_ACIMA,
}
"""Every SINTÉTICO run the recorder sends; the name goes into the recording's file name and its `scenario` key."""


# Scorer --------------------------------------------------------------------------------------------------------------

FORBIDDEN_ANY = re.compile(r"\b(lucr\w*|marge[mn]\w*|ganh\w*|profit\w*)", re.IGNORECASE)
CAVEAT = re.compile(r"(mais lojas|poucas lojas|tamanho|porç|peso|espalhad|diferente)", re.IGNORECASE)
"""Words that carry the weak-comparison caveat (Marlon, 08/nov): sizes or portions may differ, or more stores."""
SELLS_LESS = re.compile(r"vend\w* menos", re.IGNORECASE)
COST = re.compile(r"\bcusto", re.IGNORECASE)
SENTENCE_END = re.compile(r"[.!?](?:\s|$)")
MAX_TITLE = 70
MAX_SENTENCES = 2


def _sentences(text: str) -> int:
    return max(1, len(SENTENCE_END.findall(text.strip())))


def score_answer(raw: Sequence[Any], facts: Facts) -> dict[str, Any]:
    """One recorded answer against its run's facts: the check's pass rate, the lever spread, and the prompt's own
    rules a check does not enforce (count, length, caveat on weak comparisons, money-free framing). `ok` when every
    rule holds."""
    kept, dropped = check_all(raw, facts)
    texts = [f"{a.get('title', '')}\n{a.get('why', '')}" for a in raw if isinstance(a, Mapping)]
    strength = {i["id"]: i["comparacao"] for i in facts.prompt.get("itens", [])}
    levers = Counter(k["lever"] for k in kept)
    cited = Counter(i for k in kept for i in k["item_ids"])
    issues = {
        "count_out_of_range": not (3 <= len(raw) <= MAX_OPPORTUNITIES),
        "forbidden_words": sum(1 for t in texts if FORBIDDEN_ANY.search(t)),
        "long_dash": sum(1 for t in texts if LONG_DASH in t),
        "title_too_long": sum(1 for k in kept if len(k["title"]) > MAX_TITLE),
        "why_too_long": sum(1 for k in kept if _sentences(k["why"]) > MAX_SENTENCES),
        "caveat_missing": sum(
            1
            for k in kept
            if any(strength.get(i) != "firme" for i in k["item_ids"]) and not CAVEAT.search(f"{k['title']} {k['why']}")
        ),
        "raise_without_sells_less": sum(1 for k in kept if k["lever"] == "subir_preco" and not SELLS_LESS.search(k["why"])),
        "cost_lever_without_cost": sum(1 for k in kept if k["lever"] == "rever_custo" and not COST.search(k["why"])),
        "item_repeated": sum(1 for n in cited.values() if n > 1),
    }
    pass_rate = Decimal(len(kept)) / Decimal(len(raw)) if raw else Decimal(0)
    return {
        "answers": len(raw),
        "kept": len(kept),
        "dropped": dropped,
        "pass_rate": float(round(pass_rate, 2)),
        "levers": {lv: levers[lv] for lv in LEVERS if levers[lv]},
        "lever_spread": len(levers),
        "issues": {k: v for k, v in issues.items() if v},
        "ok": bool(raw) and dropped == 0 and not any(issues.values()),
    }


def score_recording(record: Mapping[str, Any]) -> dict[str, Any]:
    """A recording made by record_opportunities, scored against the facts of its scenario (`base` when absent)."""
    scenario = record.get("scenario") or "base"
    result, positions = SCENARIOS[scenario]
    raw = parse_response(record["response"], record["provider"])
    request = record.get("request") or {}
    return {
        "scenario": scenario,
        "prompt_version": record.get("prompt_version"),
        "provider": record["provider"],
        "model": request.get("model"),
        **score_answer(raw, build_facts(result, positions)),
    }


def main(argv: list[str] | None = None) -> int:
    """`uv run score-ai-opportunities [file ...]`: one line per recording (default: every fixtures/ai/opportunities-*),
    then the share of recordings that pass every rule, per prompt version and model."""
    args = argv if argv is not None else sys.argv[1:]
    paths = [Path(a) for a in args] or sorted(OUT.glob("opportunities-*.json"))
    totals: dict[tuple[Any, Any], list[bool]] = {}
    for path in paths:
        s = score_recording(json.loads(path.read_text()))
        totals.setdefault((s["prompt_version"], s["model"]), []).append(s["ok"])
        print(
            f"{path.name}  {s['scenario']}  {s['prompt_version']}  {s['model']}  pass={s['pass_rate']}  "
            f"levers={s['levers']}  issues={s['issues'] or '-'}  {'OK' if s['ok'] else 'FAIL'}"
        )
    for (pv, model), oks in totals.items():
        print(f"{pv}  {model}: {sum(oks)} of {len(oks)} recordings pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
