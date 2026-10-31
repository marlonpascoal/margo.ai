"""D14 step 3: ingredient suggestions from the Claude API (06 §6), behind the `Suggester` interface.

Only what a fiscal item line says goes out: description, NCM and unit, plus the catalog names. Never the
restaurant, its CNPJ, the supplier or any person (06 §6, D14; supplier name and price are left out too, the
most conservative reading). The answer is a suggestion with a confidence; it is stored as `suggested` and
counts in no cost until a founder confirms it in C11 (D02).

Tests use a fake `Suggester`; no test calls the API or replays invented responses (06, D40). The real client
reads ANTHROPIC_API_KEY from the environment by name (Maritime env, D44). `fixtures/anthropic/README.md`
has the recording command Marlon runs.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from .matching import CatalogItem

DEFAULT_MODEL = "claude-sonnet-5-5"
"""Configured default (param `MARGO_MATCH_MODEL` overrides it); not a branch in the logic."""
BATCH_SIZE = 25

SYSTEM = (
    "Você mapeia itens de notas fiscais de compra de restaurantes para insumos de um catálogo. "
    "Para cada item, escolha o insumo do catálogo que é o mesmo produto, ou nenhum quando não houver. "
    "Use exatamente o nome do catálogo. A confiança vai de 0 a 1. "
    "Quando a descrição disser o tamanho da embalagem, informe quantas unidades base do insumo "
    "(g, ml ou un) cabem em uma unidade da nota; senão, null."
)

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string"},
                    "ingredient": {"type": ["string", "null"]},
                    "confidence": {"type": "number"},
                    "base_units_per_invoice_unit": {"type": ["number", "null"]},
                },
                "required": ["ref", "ingredient", "confidence", "base_units_per_invoice_unit"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class AiLine:
    """One distinct line text sent to the model; `ref` is a local index, never a database id."""

    ref: str
    description: str
    ncm: str | None
    unit: str


@dataclass(frozen=True)
class Suggestion:
    ref: str
    ingredient_id: str
    confidence: Decimal
    conversion_factor: Decimal | None


class Suggester(Protocol):
    def suggest(self, lines: Sequence[AiLine], catalog: Sequence[CatalogItem]) -> list[Suggestion]: ...


def build_request(lines: Sequence[AiLine], catalog: Sequence[CatalogItem], model: str) -> dict[str, Any]:
    """Messages API arguments. Only line text, NCM, unit and catalog names (06 §6)."""
    payload = {
        "catalogo": [{"nome": c.name, "categoria": c.category, "unidade_base": c.base_unit} for c in catalog],
        "itens": [
            {"ref": li.ref, "descricao": li.description, "ncm": li.ncm, "unidade": li.unit} for li in lines
        ],
    }
    return {
        "model": model,
        "max_tokens": 16000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        "output_config": {"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    }


def validate(
    items: Sequence[Mapping[str, Any]], refs: set[str], catalog: Sequence[CatalogItem]
) -> list[Suggestion]:
    """Keep only suggestions for a ref we sent, naming a catalog ingredient exactly, one per ref."""
    by_name = {c.name: c for c in catalog}
    out: dict[str, Suggestion] = {}
    for it in items:
        ref, name = str(it.get("ref", "")), it.get("ingredient")
        if ref not in refs or ref in out or not isinstance(name, str) or name not in by_name:
            continue
        try:
            conf = min(max(Decimal(str(it.get("confidence", 0))), Decimal(0)), Decimal(1))
        except ArithmeticError:
            continue
        conv_raw = it.get("base_units_per_invoice_unit")
        conv: Decimal | None = None
        if isinstance(conv_raw, int | float) and conv_raw > 0:
            conv = Decimal(str(conv_raw))
        out[ref] = Suggestion(ref, by_name[name].id, conf.quantize(Decimal("0.0001")), conv)
    return list(out.values())


class ClaudeSuggester:
    """The real Suggester over the Anthropic SDK client (`anthropic.Anthropic().messages`)."""

    def __init__(self, client: Any = None, model: str | None = None) -> None:
        if client is None:
            import anthropic

            # ANTHROPIC_API_KEY by name only; never logged or stored.
            client = anthropic.Anthropic()
        self.client = client
        self.model = model or os.environ.get("MARGO_MATCH_MODEL") or DEFAULT_MODEL

    def suggest(self, lines: Sequence[AiLine], catalog: Sequence[CatalogItem]) -> list[Suggestion]:
        out: list[Suggestion] = []
        for i in range(0, len(lines), BATCH_SIZE):
            batch = list(lines[i : i + BATCH_SIZE])
            response = self.client.messages.create(**build_request(batch, catalog, self.model))
            if response.stop_reason != "end_turn":
                continue  # refusal or cut off: no suggestion; the lines stay without a pair
            text = next((b.text for b in response.content if b.type == "text"), "")
            try:
                items = json.loads(text).get("suggestions", [])
            except (ValueError, AttributeError):
                continue
            out.extend(validate(items, {li.ref for li in batch}, catalog))
        return out
