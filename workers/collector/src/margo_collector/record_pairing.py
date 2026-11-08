"""Record one real AI answer (D70) for the M1-04 Stage 2 attribute reader (D40). Marlon runs it; agents
never do.

    OPENAI_API_KEY=... uv run record-ai-pairing          # fixtures/ai/pairing-openai-<date>.json
    OPENAI_API_KEY=... uv run record-ai-pairing <model-id>
    MARGO_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... uv run record-ai-pairing

Sends only SINTÉTICO menu items (names in the shapes the rules cannot read, no store, no price) through the
same `build_request` the worker uses, and stores the provider, the request (no key) and the response as the
SDK returns it, so `parse_response` can be checked against what the API really sends back
(test_m1_04_stage2.py replays it).
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from margo_common import llm

from .ai_attrs import AiAttrReader, build_call
from .learning import AiItem

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "ai"

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
    args = argv if argv is not None else sys.argv[1:]
    ai = AiAttrReader(model=args[0] if args else None).ai
    request = ai.request(build_call(ITEMS))
    response = llm.send(ai.provider, ai.client, request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"pairing-{ai.provider}-{date.today().isoformat()}.json"
    record = {"provider": ai.provider, "request": request, "response": llm.response_dict(response)}
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
