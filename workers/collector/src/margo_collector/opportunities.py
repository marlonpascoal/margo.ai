"""P23 "Oportunidades" (Marlon, 08/nov): after a run is calculated, one Claude API call reads the run's deterministic
facts (M1-05 to M1-12, as monitor_result and monitor_positions show them) and writes 3 to 5 prioritized opportunities,
each with a short "why". The AI only words and orders them; a deterministic check is the guardrail:

- every number in the title or the why exists in the facts (R$ values among the money, % among the percentages, a
  plain number among any of them, the numbers in item names, or the count of the items the opportunity cites);
- no "lucro", "margem", "ganho" or "profit" (no cost data: never money gained), and no long dash;
- the items cited are items of this run that were sent; the lever is one of LEVERS.

Answers that fail are dropped and counted. Same client pattern as ai_attrs (the M1-04 Stage 2 reader): the key read by
name, the model a parameter (MARGO_OPPORTUNITIES_MODEL), skipped without ANTHROPIC_API_KEY, a recorder Marlon runs
(record_opportunities). What goes out: the run's item names, categories, prices and counts. No store name, no person.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

from margo_common.log import log_event

DEFAULT_MODEL = "claude-sonnet-5-5"
"""Configured default (param `MARGO_OPPORTUNITIES_MODEL` overrides it); not a branch in the logic."""
PROMPT_VERSION = "oportunidades.v1"
MAX_ITEMS = 80
"""Compared items sent per run, in the result's order (pode_subir first, largest gap first)."""
MAX_OPPORTUNITIES = 5
LEVERS = ("subir_preco", "manter", "rever_custo", "acompanhar")

SYSTEM = (
    "Você ajuda o dono de um restaurante a ler o raio-X de preços do cardápio dele no iFood. "
    "O raio-X compara o preço de cada item com o de itens iguais das lojas vizinhas. "
    "O meio da vizinhança é a mediana dos preços dos vizinhos. "
    "Leitura de cada item, com a faixa_da_media_pct dos fatos: pode_subir (abaixo do meio por mais que a faixa), "
    "na_media (dentro da faixa), nao_mexer (acima do meio por mais que a faixa). "
    "Escreva de 3 a 5 oportunidades, da mais importante para a menos importante, em português do Brasil, "
    "frases curtas e simples, como quem explica para alguém que não é da área. "
    "Cada oportunidade tem: title (até 70 caracteres), why (até 2 frases curtas explicando o porquê), "
    "item_ids (os ids dos itens citados, da lista de fatos) e lever, uma destas: "
    "subir_preco (o item está abaixo do meio: subir o preço aumenta o que entra por venda, mas pode vender menos), "
    "manter (o preço está alinhado com a vizinhança: não mexer agora), "
    "rever_custo (o item está acima do meio: baixar o preço pode vender mais, mas só vale a pena sabendo o custo), "
    "acompanhar (vale olhar de novo no próximo raio-X). "
    "Regras: use só números que aparecem nos fatos, escritos como nos fatos (R$ 32,00, 12%). "
    "Não faça contas, não some, não arredonde, não invente números. "
    "O custo dos itens é desconhecido: nunca fale em lucro, margem ou ganho. "
    "Ao sugerir subir, diga que pode vender menos; ao sugerir equilibrar um preço alto, diga que pode vender mais. "
    "Não use travessão. Não cite nomes de lojas."
)

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "oportunidades": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "why": {"type": "string"},
                    "item_ids": {"type": "array", "items": {"type": "string"}},
                    "lever": {"type": "string", "enum": list(LEVERS)},
                },
                "required": ["title", "why", "item_ids", "lever"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["oportunidades"],
    "additionalProperties": False,
}

GROUP_LABEL = {
    "bebidas": "Bebidas",
    "lanches": "Lanches",
    "porcoes": "Porções",
    "pratos": "Pratos",
    "sobremesas": "Sobremesas",
    "adicionais": "Adicionais",
    "sem_categoria": "Sem categoria",
    "so_seus": "Só seus",
}
"""As apps/web/lib/monitor/rules.ts GROUP_LABEL."""

# Formats -----------------------------------------------------------------------------------------------------------


def round_half_away(x: Decimal) -> int:
    """Like the web's gapLabel and margo_collector.rules: half away from zero."""
    q = abs(x).to_integral_value(rounding="ROUND_HALF_UP")
    return int(q) if x >= 0 else -int(q)


def brl(cents: int) -> str:
    """Centavos as Brazilian reais, as the screens show them: "R$ 32,00", "R$ 1.490,00"."""
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(int(cents)), 100)
    return f"{sign}R$ {whole:,}".replace(",", ".") + f",{frac:02d}"


def pct(fraction: Any) -> int:
    """A fraction (0.12) as the whole percent the screens show (12), half away from zero."""
    return round_half_away(Decimal(str(fraction)) * 100)


# Facts ---------------------------------------------------------------------------------------------------------------


@dataclass
class Facts:
    """What the prompt receives (`prompt`, Portuguese keys, money in reais) and what the check accepts."""

    prompt: dict[str, Any]
    item_ids: set[str] = field(default_factory=set)
    money: set[Decimal] = field(default_factory=set)
    """Reais values (centavos / 100), absolute."""
    percents: set[Decimal] = field(default_factory=set)
    plain: set[Decimal] = field(default_factory=set)
    """Counts, ranks, km, and the numbers written in item names and categories."""

    def hash(self) -> str:
        return hashlib.sha256(json.dumps(self.prompt, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    def any_number(self) -> set[Decimal]:
        return self.money | self.percents | self.plain


def _cents(f: Facts, cents: Any) -> str | None:
    if cents is None:
        return None
    f.money.add(abs(Decimal(int(cents)) / 100))
    return brl(int(cents))


def _pct(f: Facts, fraction: Any) -> int | None:
    if fraction is None:
        return None
    p = pct(fraction)
    f.percents.add(Decimal(abs(p)))
    return p


def _whole_pct(f: Facts, value: Any) -> int | None:
    if value is None:
        return None
    f.percents.add(Decimal(abs(int(value))))
    return int(value)


def _count(f: Facts, n: Any) -> Any:
    if n is not None:
        f.plain.add(abs(Decimal(str(n))))
    return n


def _words(f: Facts, text: str | None) -> str | None:
    for m in NUMBER.finditer(text or ""):
        f.plain.add(_value(m))
    return text


def build_facts(result: Mapping[str, Any], positions: Mapping[str, Any] | None) -> Facts:
    """M1-05 to M1-12 of one run, from monitor_result and monitor_positions, in the shape the prompt reads.

    Per compared item: name, category group, own price, parity (meio), low and high of the neighbors, gap % (M1-06),
    reading (M1-07), stores, and the price difference to the middle. Per category: counts, % of items aligned (M1-12 v3)
    and position (M1-10 per category). The store position (M1-10), the menu % aligned and the only-yours count."""
    f = Facts(prompt={})
    positions = positions or {}
    score = positions.get("score") or {}
    pos = result.get("position") or positions.get("store_position")
    cat_pos = {c.get("group"): c for c in positions.get("by_category") or []}

    categories = []
    for c in result.get("by_category") or []:
        group = c.get("group")
        p = cat_pos.get(group) or {}
        s, rank = p.get("score") or {}, p.get("position") or {}
        categories.append(
            {
                "grupo": _words(f, GROUP_LABEL.get(group, group)),
                "itens": _count(f, c.get("items")),
                "comparados": _count(f, c.get("items_compared")),
                "pode_subir": _count(f, c.get("can_go_up")),
                "na_media": _count(f, c.get("at_average")),
                "nao_mexer": _count(f, c.get("leave_alone")),
                "itens_alinhados_pct": _whole_pct(f, s.get("score")),
                "diferenca_por_venda_dos_que_podem_subir": _cents(f, c.get("price_gap_per_sale_cents")),
                "posicao_na_categoria": _count(f, rank.get("rank")),
                "lojas_na_categoria": _count(f, rank.get("stores_ranked")),
            }
        )

    items = []
    for it in list(result.get("items") or [])[:MAX_ITEMS]:
        iid = str(it["item_id"])
        f.item_ids.add(iid)
        own, parity = it.get("own_cents"), it.get("parity_cents")
        gap = _pct(f, it.get("gap_pct"))
        items.append(
            {
                "id": iid,
                "nome": _words(f, it.get("name")),
                "grupo": GROUP_LABEL.get(it.get("group"), it.get("group")),
                "seu_preco": _cents(f, own),
                "meio_da_vizinhanca": _cents(f, parity),
                "vizinhos_de": _cents(f, it.get("low_cents")),
                "vizinhos_ate": _cents(f, it.get("high_cents")),
                "diferenca_pct": gap,
                "em_relacao_ao_meio": "no meio" if not gap else ("abaixo" if gap < 0 else "acima"),
                "diferenca_para_o_meio": _cents(f, None if own is None or parity is None else abs(parity - own)),
                "leitura": it.get("reading"),
                "lojas": _count(f, it.get("stores")),
            }
        )

    f.prompt = {
        "raio_km": _count(f, result.get("radius_km")),
        "faixa_da_media_pct": _pct(f, result.get("reading_band", 0.1)),
        "lojas_comparadas": _count(f, result.get("stores_compared")),
        "itens_no_cardapio": _count(f, result.get("items_total")),
        "itens_comparados": _count(f, result.get("items_analyzed")),
        "itens_abaixo_do_meio": _count(f, result.get("below")),
        "itens_acima_do_meio": _count(f, result.get("above")),
        "itens_so_seus": _count(f, result.get("only_yours")),
        "itens_alinhados_pct": _whole_pct(f, score.get("score")),
        "posicao_da_loja": _count(f, pos.get("rank")) if pos else None,
        "lojas_no_ranking": _count(f, pos.get("stores_ranked")) if pos else None,
        "categorias": categories,
        "itens": items,
    }
    return f


# Check -------------------------------------------------------------------------------------------------------------

NUMBER = re.compile(r"(R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\s*%)?")
"""A number as written in pt-BR: optional "R$", thousands with dots, decimals after a comma, optional "%"."""
FORBIDDEN = re.compile(r"\b(lucr\w*|marge[mn]\w*|ganh\w*|profit\w*)", re.IGNORECASE)
LONG_DASH = "—"


def _value(m: re.Match[str]) -> Decimal:
    whole = m.group(2).replace(".", "")
    return Decimal(f"{whole}.{m.group(3)}") if m.group(3) else Decimal(whole)


def numbers_ok(text: str, facts: Facts, extra: frozenset[Decimal] = frozenset()) -> bool:
    """Every number in the text exists in the facts: R$ among the money, % among the percentages, else any."""
    for m in NUMBER.finditer(text):
        v = _value(m)
        if m.group(1):
            pool = facts.money
        elif m.group(4):
            pool = facts.percents
        else:
            pool = facts.any_number() | extra
        if v not in pool:
            return False
    return True


def check_opportunity(op: Any, facts: Facts) -> dict[str, Any] | None:
    """One answer kept in the stored shape {title, why, item_ids, lever}, or None when it fails the check."""
    if not isinstance(op, Mapping):
        return None
    title, why, lever, ids = op.get("title"), op.get("why"), op.get("lever"), op.get("item_ids")
    if not isinstance(title, str) or not isinstance(why, str) or not title.strip() or not why.strip():
        return None
    if lever not in LEVERS or not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        return None
    item_ids = list(dict.fromkeys(ids))
    if any(i not in facts.item_ids for i in item_ids):
        return None
    text = f"{title}\n{why}"
    if LONG_DASH in text or FORBIDDEN.search(text):
        return None
    if not numbers_ok(text, facts, frozenset({Decimal(len(item_ids))})):
        return None
    return {"title": title.strip(), "why": why.strip(), "item_ids": item_ids, "lever": lever}


def check_all(answers: Sequence[Any], facts: Facts) -> tuple[list[dict[str, Any]], int]:
    """The valid answers in the AI's order, at most MAX_OPPORTUNITIES, and how many were dropped."""
    kept = [k for k in (check_opportunity(a, facts) for a in answers) if k is not None]
    return kept[:MAX_OPPORTUNITIES], len(answers) - min(len(kept), MAX_OPPORTUNITIES)


# Claude API ----------------------------------------------------------------------------------------------------------


def build_request(facts: Facts, model: str) -> dict[str, Any]:
    """Messages API arguments: the system rules and the run's facts as JSON."""
    return {
        "model": model,
        "max_tokens": 4000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": json.dumps({"fatos": facts.prompt}, ensure_ascii=False)}],
        "output_config": {"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    }


def parse_response(response: Any) -> list[Any]:
    """A Messages API response (SDK object) to the raw opportunities; none on a refusal or a cut answer."""
    if getattr(response, "stop_reason", None) != "end_turn":
        return []
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
    try:
        ops = json.loads(text).get("oportunidades", [])
    except (ValueError, AttributeError):
        return []
    return ops if isinstance(ops, list) else []


class OpportunityWriter(Protocol):
    model: str

    def write(self, facts: Facts) -> list[Any]: ...


class ClaudeOpportunityWriter:
    """The real writer over the Anthropic SDK client (`anthropic.Anthropic().messages`)."""

    def __init__(self, client: Any = None, model: str | None = None) -> None:
        if client is None:
            import anthropic

            # ANTHROPIC_API_KEY by name only, never logged or stored, passed explicitly (as ai_attrs).
            key = os.environ.get("ANTHROPIC_API_KEY")
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY is not set")
            client = anthropic.Anthropic(api_key=key)
        self.client = client
        self.model = model or os.environ.get("MARGO_OPPORTUNITIES_MODEL") or DEFAULT_MODEL

    def write(self, facts: Facts) -> list[Any]:
        response = self.client.messages.create(**build_request(facts, self.model))
        return parse_response(response)


def writer_from_env() -> ClaudeOpportunityWriter | None:
    """The writer when ANTHROPIC_API_KEY is set; None skips the job (local development, tests)."""
    return ClaudeOpportunityWriter() if os.environ.get("ANTHROPIC_API_KEY") else None


# Step ----------------------------------------------------------------------------------------------------------------


class OpportunityRepo(Protocol):
    def has_opportunities(self, xray_id: str) -> bool: ...

    def opportunity_inputs(self, xray_id: str) -> tuple[Mapping[str, Any], Mapping[str, Any] | None] | None: ...

    def save_opportunities(
        self, xray_id: str, items: list[dict[str, Any]], facts_hash: str, model: str, prompt_version: str, dropped: int
    ) -> None: ...


def opportunities_step(repo: OpportunityRepo, xray_id: str, writer: OpportunityWriter | None) -> dict[str, Any]:
    """Job xray_opportunities: one call per run, a row once (never rewritten). Without a key: done, no row."""
    if writer is None:
        log_event("skipped_no_key", type="xray_opportunities", xray_id=xray_id)
        return {"skipped": "no_api_key"}
    if repo.has_opportunities(xray_id):
        return {"skipped": "exists"}
    inputs = repo.opportunity_inputs(xray_id)
    if inputs is None:
        return {"skipped": "not_ready"}
    result, positions = inputs
    if result.get("status") not in ("ready", "delivered") or result.get("target_kind") != "own":
        return {"skipped": "not_ready"}
    facts = build_facts(result, positions)
    if not facts.item_ids:
        return {"skipped": "no_items"}
    answers = writer.write(facts)
    kept, dropped = check_all(answers, facts)
    repo.save_opportunities(xray_id, kept, facts.hash(), writer.model, PROMPT_VERSION, dropped)
    log_event("m1_opportunities", xray_id=xray_id, kept=len(kept), dropped=dropped, model=writer.model)
    return {"kept": len(kept), "dropped": dropped}
