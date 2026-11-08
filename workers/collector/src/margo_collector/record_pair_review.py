"""Record real AI answers (D70) for the M1-12 pair review (D40). Marlon runs it; agents never do.

    OPENAI_API_KEY=... uv run record-ai-pair-review              # the labeled SINTÉTICO pairs
    OPENAI_API_KEY=... uv run record-ai-pair-review <model-id>   # another model
    uv run score-ai-pair-review                                  # score every recording, offline
"""

from __future__ import annotations

import json
import sys
from datetime import date

from margo_common import llm

from .pair_review import PROMPT_VERSION, AiPairReviewer, build_call
from .pair_review_eval import LABELED, OUT


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not llm.key_present():
        print("sem chave de IA no ambiente")
        return 1
    reviewer = AiPairReviewer(model=args[0] if args else None)
    request = reviewer.ai.request(build_call([p for p, _ in LABELED]))
    response = llm.send(reviewer.ai.provider, reviewer.ai.client, request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"pair-review-{reviewer.ai.provider}-{date.today().isoformat()}.json"
    record = {
        "provider": reviewer.ai.provider,
        "prompt_version": PROMPT_VERSION,
        "request": request,
        "response": llm.response_dict(response),
    }
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(path)
    return 0
