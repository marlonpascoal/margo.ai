"""Record one real Claude API answer for the M1-04 Stage 2 attribute reader (D40). Marlon runs it; agents
never do.

    ANTHROPIC_API_KEY=... uv run record-anthropic-pairing          # fixtures/anthropic/pairing-<date>.json
    ANTHROPIC_API_KEY=... uv run record-anthropic-pairing <model-id>

Sends only SINTÉTICO menu items (names in the shapes the rules cannot read, no store, no price) through the
same `build_request` the worker uses, and stores the request (no key) and the response as the SDK returns it,
so `parse_response` can be checked against what the API really sends back (test_m1_04_stage2.py replays it).
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from .ai_attrs import DEFAULT_MODEL, ClaudeAttrReader, build_request
from .learning import AiItem

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "anthropic"

ITEMS = [
    AiItem(
        "0",
        "Especial da Vila",
        "Pão brioche, dois hambúrgueres de 150 g, bacon, ovo, cheddar e salada.",
        "lanches",
    ),
    AiItem(
        "1",
        "Lanche Sinfonia",
        "Pão de dog, duas salsichas, frango desfiado, milho e batata palha.",
        "lanches",
    ),
    AiItem("2", "Prato do Sítio", "Tiras de tilápia empanadas, serve 2 pessoas.", "porcoes"),
    AiItem("3", "Caseirinho", None, "lanches"),
]


def main(argv: list[str] | None = None) -> int:
    model = (argv or sys.argv[1:] or [DEFAULT_MODEL])[0]
    reader = ClaudeAttrReader(model=model)
    request = build_request(ITEMS, model)
    response = reader.client.messages.create(**request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"pairing-{date.today().isoformat()}.json"
    path.write_text(
        json.dumps({"request": request, "response": response.to_dict()}, ensure_ascii=False, indent=2) + "\n"
    )
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
