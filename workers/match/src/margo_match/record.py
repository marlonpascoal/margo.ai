"""Record one real AI answer for the drawn C11 lines (06 §6, D40, D70). Marlon runs it; agents never do.

    OPENAI_API_KEY=... uv run record-ai             # writes fixtures/ai/match-openai-<date>.json
    OPENAI_API_KEY=... uv run record-ai <model-id>
    MARGO_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... uv run record-ai

Sends only synthetic G-SYN line texts (SINTÉTICO), synthetic supplier names and unit prices, and catalog
names, through the same `build_request` and the same supplier and price helpers the worker uses, and stores
the provider, the request (no key) and the response as returned by the SDK, so the parser can be checked
against what the API really sends back.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

from margo_common import llm

from .ai import AiLine, AiSuggester, build_call, supplier_for_prompt, unit_price_text
from .matching import CatalogItem

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "ai"

LINES = [
    AiLine(
        "0",
        "QJO PROC CHED FAT 2,27KG 160FT",
        "04063000",
        "PC",
        supplier_for_prompt("90000002000183", "Laticínios Exemplo"),
        unit_price_text(23654, Decimal(2), "PC"),
    ),
    AiLine(
        "1",
        "MAION TEMP CASA 3KG BALDE",
        "21039011",
        "UN",
        supplier_for_prompt("90000007000114", "Molhos Exemplo"),
        unit_price_text(8970, Decimal(1), "UN"),
    ),
    AiLine(
        "2",
        "PAO HAMB BRIOCHE GERG C/12",
        "19059090",
        "PCT",
        supplier_for_prompt("90000006000161", "Moinho Exemplo"),
        unit_price_text(5880, Decimal(3), "PCT"),
    ),
]
CATALOG = [
    CatalogItem("a", "Queijo cheddar fatiado", "laticínios", "g"),
    CatalogItem("b", "Maionese (base de molho)", "molhos", "g"),
    CatalogItem("c", "Pão brioche", "padaria", "un"),
    CatalogItem("d", "Bacon em cubos", "carnes", "g"),
]


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    suggester = AiSuggester(model=args[0] if args else None)
    ai = suggester.ai
    request = ai.request(build_call(LINES, CATALOG))
    response = llm.send(ai.provider, ai.client, request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"match-{ai.provider}-{date.today().isoformat()}.json"
    record = {"provider": ai.provider, "request": request, "response": llm.response_dict(response)}
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
