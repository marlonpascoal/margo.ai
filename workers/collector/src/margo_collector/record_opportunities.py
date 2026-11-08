"""Record one real AI answer (D70) for P23 "Oportunidades" (D40). Marlon runs it; agents never do.

    OPENAI_API_KEY=... uv run record-ai-opportunities          # fixtures/ai/opportunities-openai-<date>.json
    OPENAI_API_KEY=... uv run record-ai-opportunities <model-id>
    MARGO_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... uv run record-ai-opportunities

Sends the facts of one SINTÉTICO run (no store name, no person) through the same `build_facts` and `build_request` the
worker uses, and stores the provider, the request (no key) and the response as the SDK returns it, so `parse_response` and the
number check can be tested against what the API really sends back (test_b01_opportunities.py replays it).
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from margo_common import llm

from .opportunities import AiOpportunityWriter, build_call, build_facts

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "ai"


def _item(n: int, name: str, group: str, own: int, parity: int, low: int, high: int, reading: str, stores: int) -> dict[str, Any]:
    return {
        "item_id": f"00000000-0000-4000-8000-{n:012d}",
        "name": name,
        "group": group,
        "own_cents": own,
        "parity_cents": parity,
        "low_cents": low,
        "high_cents": high,
        "gap_pct": round((own - parity) / parity, 4),
        "reading": reading,
        "stores": stores,
    }


ITEMS = [
    _item(1, "X-Burger Sintético", "lanches", 2400, 2900, 2500, 3400, "pode_subir", 9),
    _item(2, "X-Salada Sintético", "lanches", 2600, 3000, 2600, 3500, "pode_subir", 8),
    _item(3, "X-Bacon Sintético", "lanches", 3200, 3250, 2800, 3700, "na_media", 10),
    _item(4, "Batata Frita Sintética 400 g", "porcoes", 3900, 3200, 2600, 3800, "nao_mexer", 7),
    _item(5, "Pudim Sintético", "sobremesas", 1200, 1250, 900, 1600, "na_media", 5),
    _item(6, "Refrigerante Sintético 350 ml", "bebidas", 700, 650, 550, 800, "na_media", 11),
]

RESULT: dict[str, Any] = {
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
    "items": ITEMS,
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
POSITIONS: dict[str, Any] = {
    "score": {"score": 50, "items": 6},
    "by_category": [{"group": "lanches", "score": None, "position": {"rank": 3, "stores_ranked": 9}}],
}


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    ai = AiOpportunityWriter(model=args[0] if args else None).ai
    request = ai.request(build_call(build_facts(RESULT, POSITIONS)))
    response = llm.send(ai.provider, ai.client, request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"opportunities-{ai.provider}-{date.today().isoformat()}.json"
    record = {"provider": ai.provider, "request": request, "response": llm.response_dict(response)}
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
