"""D14 step 3: ingredient suggestions from the Claude API (06 §6), behind the `Suggester` interface.

What goes out (06 §6, D14; Marlon, 31/out): the supplier name, the item description, NCM and unit, and the
unit price, plus the catalog names. The supplier name only when the issuer is a company (14-digit CNPJ) and
the name carries no CPF (an MEI name is a person's name); an individual (CPF) issuer goes with no supplier
name. Never the restaurant, any CNPJ or CPF, or a person. The answer is a suggestion with a confidence; it is
stored as `suggested` and counts in no cost until a founder confirms it in C11 (D02).

Tests use a fake `Suggester`; no test calls the API or replays invented responses (06, D40). The real client
reads ANTHROPIC_API_KEY from the environment by name (Maritime env, D44). `fixtures/anthropic/README.md`
has the recording command Marlon runs.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any, Protocol

from .matching import CatalogItem

DEFAULT_MODEL = "claude-sonnet-5-5"
"""Configured default (param `MARGO_MATCH_MODEL` overrides it); not a branch in the logic."""
BATCH_SIZE = 25

SYSTEM = (
    "Você mapeia itens de notas fiscais de compra de restaurantes para insumos de um catálogo. "
    "Para cada item, escolha o insumo do catálogo que é o mesmo produto, ou nenhum quando não houver. "
    "O fornecedor e o preço unitário (em reais, por unidade da nota) ajudam a reconhecer o produto. "
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
    """One distinct line text sent to the model; `ref` is a local index, never a database id.

    `supplier` comes from `supplier_for_prompt`, `unit_price` from `unit_price_text`; None sends null."""

    ref: str
    description: str
    ncm: str | None
    unit: str
    supplier: str | None = None
    unit_price: str | None = None


_CPF_IN_TEXT = re.compile(r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}")


def supplier_for_prompt(issuer_cnpj: str | None, issuer_name: str | None) -> str | None:
    """D14: the supplier name sent to the model, or None. Only a company issuer (14-digit CNPJ) whose name has
    no CPF in it (MEI names are a person's name followed by the CPF); a CPF issuer is a person: no name."""
    if not issuer_cnpj or not re.fullmatch(r"\d{14}", issuer_cnpj):
        return None
    name = " ".join((issuer_name or "").split())
    if not name or _CPF_IN_TEXT.search(name) or re.search(r"\d{11,}", re.sub(r"[.\-/ ]", "", name)):
        return None
    return name


def unit_price_text(total_cents: int | None, qty: Decimal | None, unit: str) -> str | None:
    """D14: the line's unit price in reais as a decimal string with the invoice unit, "118.27 R$/PC".

    Derived from integer centavos as total_cents / qty (not the rounded unit_price_cents), kept to four
    decimals of reais when it is not a whole centavo, never fewer than two."""
    if total_cents is None or qty is None or qty <= 0:
        return None
    reais = (Decimal(total_cents) / Decimal(qty) / 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_EVEN)
    if reais == reais.quantize(Decimal("0.01")):
        reais = reais.quantize(Decimal("0.01"))
    return f"{reais} R$/{unit}"


@dataclass(frozen=True)
class Suggestion:
    ref: str
    ingredient_id: str
    confidence: Decimal
    conversion_factor: Decimal | None


class Suggester(Protocol):
    def suggest(self, lines: Sequence[AiLine], catalog: Sequence[CatalogItem]) -> list[Suggestion]: ...


def build_request(lines: Sequence[AiLine], catalog: Sequence[CatalogItem], model: str) -> dict[str, Any]:
    """Messages API arguments: supplier name, line text, NCM, unit, unit price and catalog names (06 §6)."""
    payload = {
        "catalogo": [{"nome": c.name, "categoria": c.category, "unidade_base": c.base_unit} for c in catalog],
        "itens": [
            {
                "ref": li.ref,
                "descricao": li.description,
                "ncm": li.ncm,
                "unidade": li.unit,
                "fornecedor": li.supplier,
                "preco_unitario": li.unit_price,
            }
            for li in lines
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

            # ANTHROPIC_API_KEY by name only, never logged or stored. Passed explicitly so a local
            # `ant auth login` profile is never picked up by accident (no live calls outside Maritime).
            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY is not set")
            client = anthropic.Anthropic(api_key=key)
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
