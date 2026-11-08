"""Record real AI answers (D70) for P23 "Oportunidades" (D40). Marlon runs it; agents never do.

    OPENAI_API_KEY=... uv run record-ai-opportunities                     # the base run
    OPENAI_API_KEY=... uv run record-ai-opportunities --all               # every scenario in opportunity_eval
    OPENAI_API_KEY=... uv run record-ai-opportunities --all <model-id>    # another model
    OPENAI_API_KEY=... uv run record-ai-opportunities --scenario poucas_lojas
    MARGO_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... uv run record-ai-opportunities --all
    uv run score-ai-opportunities                                         # score every recording, offline

Sends the facts of SINTÉTICO runs (no store name, no person) through the same `build_facts` and `build_request` the
worker uses, and stores the provider, the scenario, the prompt version, the request (no key) and the response as the
SDK returns it, in fixtures/ai/opportunities-<provider>-<scenario>-<date>.json, so `parse_response`, the number check
and the scorer (opportunity_eval) can be run against what the API really sends back.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from margo_common import llm

from .opportunities import PROMPT_VERSION, AiOpportunityWriter, build_call, build_facts
from .opportunity_eval import BASE_POSITIONS, BASE_RESULT, OUT, SCENARIOS

RESULT, POSITIONS = BASE_RESULT, BASE_POSITIONS
"""The base run, as the tests and the first recording use it."""


def record(ai: Any, scenario: str) -> Path:
    """One call for one scenario, written next to the other recordings."""
    result, positions = SCENARIOS[scenario]
    request = ai.request(build_call(build_facts(result, positions)))
    response = llm.send(ai.provider, ai.client, request)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"opportunities-{ai.provider}-{scenario}-{date.today().isoformat()}.json"
    rec = {
        "provider": ai.provider,
        "scenario": scenario,
        "prompt_version": PROMPT_VERSION,
        "request": request,
        "response": llm.response_dict(response),
    }
    path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    return path


def parse_args(args: list[str]) -> tuple[list[str], str | None]:
    """`[--all | --scenario <name>] [model-id]` to the scenarios to record and the model (None: the default)."""
    scenarios, model, rest = ["base"], None, list(args)
    while rest:
        a = rest.pop(0)
        if a == "--all":
            scenarios = list(SCENARIOS)
        elif a == "--scenario":
            name = rest.pop(0) if rest else ""
            if name not in SCENARIOS:
                raise SystemExit(f"unknown scenario {name!r}; one of: {', '.join(SCENARIOS)}")
            scenarios = [name]
        else:
            model = a
    return scenarios, model


def main(argv: list[str] | None = None) -> int:
    scenarios, model = parse_args(argv if argv is not None else sys.argv[1:])
    ai = AiOpportunityWriter(model=model).ai
    for scenario in scenarios:
        print(record(ai, scenario))
    return 0


if __name__ == "__main__":
    sys.exit(main())
