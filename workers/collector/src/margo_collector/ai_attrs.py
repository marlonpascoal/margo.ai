"""M1-04 Stage 2: the attributes of the non-beverage items the rules cannot read, from the AI provider (D70),
behind the `AttrReader` interface (learning.py). Same pattern as worker-match (margo_match.ai): one
structured-output call through `margo_common.llm`, the key read by name, the model a parameter, a recorder
Marlon runs.

What goes out: the item name, its description and our category. Business menu data only, never a store, a
person or a price. The answer only fills attributes; a pair still needs them to match (`compare_food_m1_04`).

Tests use a fake reader; no test calls the API or replays invented answers (06, D40). The real client reads
the provider's key from the environment by name (Maritime env, D44); without it the step is skipped with a
note and the result is the rules alone. `fixtures/ai/README.md` has the recording command."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from margo_common import llm

from .food import BASES, EXTRAS, FLAVORS, PORTIONS, PROTEINS, FoodAttrs, attrs_from_json
from .learning import AiItem

MODEL_ENV = "MARGO_PAIR_MODEL"
"""Overrides the provider's default model (llm.DEFAULT_MODELS)."""
MAX_ITEMS = 200
"""Items per call (one call per X-ray); the rest waits for the next run."""

SYSTEM = (
    "Você lê itens de cardápio de restaurantes (lanches, porções, pratos, sobremesas, adicionais) "
    "e devolve os atributos de cada um. "
    "Use só o nome, a descrição e a categoria. "
    "base: o tipo do lanche ou da porção, uma palavra da lista, ou null se não der para saber. "
    "proteinas: as proteínas principais, da lista; "
    "num hambúrguer sem outra carne dita, bovino; num dog, salsicha. "
    "carnes: quantas carnes (hambúrgueres, ou salsichas num dog), 1 a 3. "
    "peso_g: o peso em gramas só quando escrito, senão null. "
    "porcao: pequena, media, grande, 'N pessoas', 'N fatias' ou 'N cm' só quando escrito, senão null. "
    "extras: os outros ingredientes que o nome cita, da lista. "
    "sabores: os sabores de uma sobremesa ou de uma pizza, da lista. "
    "pecas: quantas peças de um sushi ou combinado, só quando escrito. "
    "volume_ml: o volume em ml só quando escrito. "
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
                    "base": {"type": ["string", "null"], "enum": [*BASES, None]},
                    "proteinas": {"type": "array", "items": {"type": "string", "enum": list(PROTEINS)}},
                    "carnes": {"type": "integer"},
                    "peso_g": {"type": ["integer", "null"]},
                    "porcao": {"type": ["string", "null"]},
                    "extras": {"type": "array", "items": {"type": "string", "enum": list(EXTRAS)}},
                    "sabores": {"type": "array", "items": {"type": "string", "enum": list(FLAVORS)}},
                    "pecas": {"type": ["integer", "null"]},
                    "volume_ml": {"type": ["integer", "null"]},
                    "confianca": {"type": "number"},
                },
                "required": [
                    "ref",
                    "base",
                    "proteinas",
                    "carnes",
                    "peso_g",
                    "porcao",
                    "extras",
                    "sabores",
                    "pecas",
                    "volume_ml",
                    "confianca",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["itens"],
    "additionalProperties": False,
}


def build_call(items: Sequence[AiItem]) -> llm.Call:
    """Name, description and category of each item, and the word lists."""
    payload = {
        "listas": {
            "bases": list(BASES),
            "proteinas": list(PROTEINS),
            "extras": list(EXTRAS),
            "porcoes": list(PORTIONS),
        },
        "itens": [
            {"ref": i.ref, "nome": i.name, "descricao": i.description, "categoria": i.category} for i in items
        ],
    }
    return llm.Call("atributos_de_itens", SYSTEM, payload, OUTPUT_SCHEMA, 16000)


def build_request(
    items: Sequence[AiItem], model: str, provider: str = llm.DEFAULT_PROVIDER
) -> dict[str, Any]:
    """The SDK arguments (llm.build_request)."""
    return llm.build_request(provider, model, build_call(items))


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


def parse_answer(
    answer: Mapping[str, Any] | None, refs: set[str]
) -> dict[str, tuple[FoodAttrs, float | None]]:
    """The answer object to validated attributes; nothing on a refusal, a cut or a malformed answer."""
    items = answer.get("itens") if answer else None
    return validate(items, refs) if isinstance(items, list) else {}


def parse_response(
    response: Any, refs: set[str], provider: str = llm.DEFAULT_PROVIDER
) -> dict[str, tuple[FoodAttrs, float | None]]:
    """An SDK response (or its recorded dict) to validated answers."""
    return parse_answer(llm.response_json(provider, response), refs)


class AiAttrReader:
    """The real AttrReader over `margo_common.llm` (provider: MARGO_AI_PROVIDER, model: MARGO_PAIR_MODEL)."""

    def __init__(self, client: Any = None, model: str | None = None, provider: str | None = None) -> None:
        self.ai = llm.StructuredClient(client, model, provider, MODEL_ENV)
        self.model = self.ai.model

    def read(self, items: Sequence[AiItem]) -> dict[str, tuple[FoodAttrs, float | None]]:
        batch = list(items[:MAX_ITEMS])
        if not batch:
            return {}
        return parse_answer(self.ai.ask(build_call(batch)), {i.ref for i in batch})


def reader_from_env() -> AiAttrReader | None:
    """The reader when the provider's key is set; None skips the AI step (local development, tests)."""
    return AiAttrReader() if llm.key_present() else None
