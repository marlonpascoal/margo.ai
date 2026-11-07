"""M1-04 Stage 2: the attributes of the lanches and porções the rules cannot read, from the Claude API,
behind the `AttrReader` interface (learning.py). Same pattern as worker-match (margo_match.ai): one
structured-output call, the key read by name, the model a parameter, a recorder Marlon runs.

What goes out: the item name, its description and our category. Business menu data only, never a store, a
person or a price. The answer only fills attributes; a pair still needs them to match (`compare_food_m1_04`).

Tests use a fake reader; no test calls the API or replays invented answers (06, D40). The real client reads
ANTHROPIC_API_KEY from the environment by name (Maritime env, D44); without it the step is skipped with a
note and the result is the rules alone. `fixtures/anthropic/README.md` has the recording command."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from typing import Any

from .food import EXTRAS, LANCHE_BASES, PORCAO_BASES, PORTIONS, PROTEINS, FoodAttrs, attrs_from_json
from .learning import AiItem

DEFAULT_MODEL = "claude-sonnet-5-5"
"""Configured default (param `MARGO_PAIR_MODEL` overrides it); not a branch in the logic."""
MAX_ITEMS = 200
"""Items per call (one call per X-ray); the rest waits for the next run."""

SYSTEM = (
    "Você lê itens de cardápio de lanchonetes (lanches e porções) e devolve os atributos de cada um. "
    "Use só o nome, a descrição e a categoria. "
    "base: o tipo do lanche ou da porção, uma palavra da lista, ou null se não der para saber. "
    "proteinas: as proteínas principais, da lista; "
    "num hambúrguer sem outra carne dita, bovino; num dog, salsicha. "
    "carnes: quantas carnes (hambúrgueres, ou salsichas num dog), 1 a 3. "
    "peso_g: o peso em gramas só quando escrito, senão null. "
    "porcao: pequena, media, grande ou 'N pessoas' só quando escrito, senão null. "
    "extras: os outros ingredientes que o nome cita, da lista. "
    "confianca: de 0 a 1. Não invente: o que não estiver escrito fica null ou vazio."
)

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "itens": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string"},
                    "base": {"type": ["string", "null"], "enum": [*LANCHE_BASES, *PORCAO_BASES, None]},
                    "proteinas": {"type": "array", "items": {"type": "string", "enum": list(PROTEINS)}},
                    "carnes": {"type": "integer"},
                    "peso_g": {"type": ["integer", "null"]},
                    "porcao": {"type": ["string", "null"]},
                    "extras": {"type": "array", "items": {"type": "string", "enum": list(EXTRAS)}},
                    "confianca": {"type": "number"},
                },
                "required": ["ref", "base", "proteinas", "carnes", "peso_g", "porcao", "extras", "confianca"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["itens"],
    "additionalProperties": False,
}


def build_request(items: Sequence[AiItem], model: str) -> dict[str, Any]:
    """Messages API arguments: name, description and category of each item, and the word lists."""
    payload = {
        "listas": {
            "bases": [*LANCHE_BASES, *PORCAO_BASES],
            "proteinas": list(PROTEINS),
            "extras": list(EXTRAS),
            "porcoes": list(PORTIONS),
        },
        "itens": [
            {"ref": i.ref, "nome": i.name, "descricao": i.description, "categoria": i.category} for i in items
        ],
    }
    return {
        "model": model,
        "max_tokens": 16000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        "output_config": {"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    }


def validate(items: Sequence[Mapping[str, Any]], refs: set[str]) -> dict[str, tuple[FoodAttrs, float | None]]:
    """Keep only answers for a ref we sent, one per ref, in the shape of `attrs_from_json`."""
    out: dict[str, tuple[FoodAttrs, float | None]] = {}
    for it in items:
        ref = str(it.get("ref", ""))
        if ref not in refs or ref in out:
            continue
        attrs = attrs_from_json(dict(it), "ia")
        if attrs is None:
            continue
        conf = it.get("confianca")
        confidence = min(max(float(conf), 0.0), 1.0) if isinstance(conf, int | float) else None
        out[ref] = (attrs, confidence)
    return out


def parse_response(response: Any, refs: set[str]) -> dict[str, tuple[FoodAttrs, float | None]]:
    """A Messages API response (SDK object) to validated answers; nothing on a refusal or a cut answer."""
    if getattr(response, "stop_reason", None) != "end_turn":
        return {}
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
    try:
        items = json.loads(text).get("itens", [])
    except (ValueError, AttributeError):
        return {}
    return validate(items, refs)


class ClaudeAttrReader:
    """The real AttrReader over the Anthropic SDK client (`anthropic.Anthropic().messages`)."""

    def __init__(self, client: Any = None, model: str | None = None) -> None:
        if client is None:
            import anthropic

            # ANTHROPIC_API_KEY by name only, never logged or stored, passed explicitly so a local profile is
            # never picked up by accident (no live calls outside Maritime).
            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY is not set")
            client = anthropic.Anthropic(api_key=key)
        self.client = client
        self.model = model or os.environ.get("MARGO_PAIR_MODEL") or DEFAULT_MODEL

    def read(self, items: Sequence[AiItem]) -> dict[str, tuple[FoodAttrs, float | None]]:
        batch = list(items[:MAX_ITEMS])
        if not batch:
            return {}
        response = self.client.messages.create(**build_request(batch, self.model))
        return parse_response(response, {i.ref for i in batch})


def reader_from_env() -> ClaudeAttrReader | None:
    """The reader when ANTHROPIC_API_KEY is set; None skips the AI step (local development, tests)."""
    return ClaudeAttrReader() if os.environ.get("ANTHROPIC_API_KEY") else None
