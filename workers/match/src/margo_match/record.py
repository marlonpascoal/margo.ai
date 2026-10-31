"""Record one real Claude API answer for the drawn C11 lines (06 §6, D40). Marlon runs it; agents never do.

    ANTHROPIC_API_KEY=... uv run record-anthropic            # writes fixtures/anthropic/match-<date>.json

Sends only synthetic G-SYN line texts (SINTÉTICO) and catalog names, through the same `build_request` the
worker uses, and stores the request (no key) and the response as returned by the SDK, so the parser can be
checked against what the API really sends back.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from .ai import DEFAULT_MODEL, AiLine, ClaudeSuggester, build_request
from .matching import CatalogItem

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "anthropic"

LINES = [
    AiLine("0", "QJO PROC CHED FAT 2,27KG 160FT", "04063000", "PC"),
    AiLine("1", "MAION TEMP CASA 3KG BALDE", "21039011", "UN"),
    AiLine("2", "PAO HAMB BRIOCHE GERG C/12", "19059090", "PCT"),
]
CATALOG = [
    CatalogItem("a", "Queijo cheddar fatiado", "laticínios", "g"),
    CatalogItem("b", "Maionese (base de molho)", "molhos", "g"),
    CatalogItem("c", "Pão brioche", "padaria", "un"),
    CatalogItem("d", "Bacon em cubos", "carnes", "g"),
]


def main(argv: list[str] | None = None) -> int:
    model = (argv or sys.argv[1:] or [DEFAULT_MODEL])[0]
    suggester = ClaudeSuggester(model=model)
    request = build_request(LINES, CATALOG, model)
    response = suggester.client.messages.create(**request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"match-{date.today().isoformat()}.json"
    path.write_text(
        json.dumps({"request": request, "response": response.to_dict()}, ensure_ascii=False, indent=2) + "\n"
    )
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
