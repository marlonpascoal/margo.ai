"""P23 "Oportunidades" (Marlon, 08/nov): after a run is calculated, one AI call (D70) reads the run's deterministic
facts (M1-05 to M1-12, as monitor_result and monitor_positions show them) and writes 3 to 5 prioritized opportunities,
each with a short "why". The AI only words and orders them; a deterministic check is the guardrail:

- every number in the title or the why exists in the facts (R$ values among the money, % among the percentages, a
  plain number among any of them, the numbers in item names, or the count of the items the opportunity cites);
- no "lucro", "margem", "ganho" or "profit" (no cost data: never money gained), and no long dash;
- the items cited are items of this run that were sent; the lever is one of LEVERS.

Answers that fail are dropped and counted. Same client as ai_attrs (the M1-04 Stage 2 reader), `margo_common.llm`: the
key read by name, the model a parameter (MARGO_OPPORTUNITIES_MODEL), skipped without the provider's key, a recorder
Marlon runs (record_opportunities). What goes out: the run's item names, categories, prices and counts. No store name, no person.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

from margo_common import llm
from margo_common.log import log_event

MODEL_ENV = "MARGO_OPPORTUNITIES_MODEL"
"""Overrides the provider's default model (llm.DEFAULT_MODELS)."""
PROMPT_VERSION = "oportunidades.v3"
MAX_ITEMS = 80
"""Compared items sent per run, in the result's order (pode_subir first, largest gap first)."""
MAX_OPPORTUNITIES = 5
LEVERS = ("subir_preco", "manter", "rever_custo", "acompanhar")
FEW_STORES = 5
"""Below the M1-04 default `min_pairs` (rules.Settings): fewer stores than an item needs to pair on its own."""
SPREAD_FACTOR = 2
"""The neighbors' highest price at least twice their lowest: sizes or portions likely differ (Marlon, 08/nov)."""

SYSTEM = (
    "Você é especialista em preços de cardápio de delivery no iFood e ajuda o dono de um restaurante a ler o raio-X "
    "de preços do cardápio dele. O raio-X compara o preço de cada item com o de itens iguais das lojas vizinhas. "
    "O meio da vizinhança é a mediana dos preços dos vizinhos. "
    "Leitura de cada item, com a faixa_da_media_pct dos fatos: pode_subir (abaixo do meio por mais que a faixa), "
    "na_media (dentro da faixa), nao_mexer (acima do meio por mais que a faixa). "
    "Campos que ajudam a decidir: tamanho_da_diferenca (pequena, moderada ou grande, já calculado); "
    "comparacao (firme, poucas_lojas ou precos_espalhados); papel_na_categoria (mais_barato, mais_caro, no_meio ou "
    "unico entre os itens comparados da mesma categoria no cardápio do dono); e, nos itens pode_subir, "
    "preco_para_testar e aumento_do_teste_pct: um primeiro passo de subida já calculado, nunca maior que a faixa, "
    "terminando em ,90 quando dá. "
    "Escreva de 3 a 5 oportunidades, da mais importante para a menos importante. Como escolher e ordenar: "
    "(a) pese juntos o tamanho da diferença e a força da comparação: grande e firme vem primeiro; "
    "moderada e firme vem antes de grande com comparação fraca; "
    "(b) pode_subir é a melhor oportunidade: proponha testar o preco_para_testar, um item por vez, olhar as vendas "
    "por algumas semanas e só então pensar no próximo passo; diga que é um primeiro passo e que o meio está mais "
    "acima; "
    "(c) quando vários itens da mesma categoria estão abaixo, faça uma oportunidade da categoria, cite os itens e "
    "diga para começar pelo de maior diferença, sem subir todos de uma vez; "
    "(d) o item mais_barato da categoria costuma ser a porta de entrada do cardápio: suba com mais cuidado e "
    "prefira começar por outro item da categoria; o item mais_caro serve de referência para os outros: se ele está "
    "abaixo do meio, a categoria inteira parece barata e ele é um bom primeiro teste; "
    "(e) bebidas e adicionais: o cliente compara menos esses preços; uma bebida ou adicional nao_mexer com "
    "tamanho_da_diferenca moderada pede manter, dizendo que o preço está perto do meio e que baixar quase nunca "
    "traz mais pedidos; use rever_custo nesses grupos só com diferença grande; "
    "(f) nao_mexer: não sugira baixar direto; use rever_custo e diga que baixar pode vender mais, mas só o custo "
    "diz se compensa; "
    "(g) inclua uma oportunidade manter para onde o dono está mais forte (a categoria com mais itens na_media ou o "
    "maior itens_alinhados_pct), para ele não mexer no que já está certo; "
    "(h) use acompanhar quando a comparação é poucas_lojas, e diga que com mais lojas comparadas no próximo "
    "raio-X a leitura fica mais firme; "
    "(i) não repita o mesmo item em duas oportunidades e varie as alavancas quando os fatos permitem. "
    "Comparação fraca: com poucas_lojas ou precos_espalhados, ou num prato ou porção sem o peso no nome, diga no "
    "porquê que o tamanho ou a porção dos vizinhos pode ser diferente, e que ainda assim o preço de face já mostra "
    "a diferença. "
    "Cada oportunidade tem: title (até 70 caracteres, com a ação e o nome do item ou da categoria, sem "
    "os nomes dos campos), why (até 2 frases curtas: a primeira com os números do item, como seu "
    "preço, o meio e a diferença; a segunda com o que fazer e o cuidado), item_ids (os ids dos itens citados, da "
    "lista de fatos) e lever, uma destas: "
    "subir_preco (o item está abaixo do meio: subir o preço aumenta o que entra por venda, mas pode vender menos), "
    "manter (o preço está alinhado com a vizinhança, ou a diferença não pede mudança: não mexer agora), "
    "rever_custo (o item está acima do meio: baixar o preço pode vender mais, mas só vale a pena sabendo o custo), "
    "acompanhar (a comparação ainda é fraca: vale olhar de novo no próximo raio-X). "
    "Escrita: português do Brasil, frases curtas e simples, como quem explica para alguém que não é da área; "
    "sem palavras técnicas como elasticidade, ticket, markup ou âncora. "
    "Regras: use só números que aparecem nos fatos, escritos como nos fatos (R$ 32,00, 12%). "
    "Não faça contas, não some, não arredonde, não invente números, nem prazos ou quantidades com algarismos. "
    "O custo dos itens é desconhecido: nunca fale em lucro, margem ou ganho, nem prometa dinheiro a mais. "
    "Ao sugerir subir, diga que pode vender menos; ao falar de baixar um preço alto, diga que pode vender mais e "
    "que só o custo diz se compensa. "
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


def comparison_strength(stores: Any, low_cents: Any, high_cents: Any) -> str:
    """How much one item's comparison can be trusted, for the AI's wording (no number on screen comes from it).

    `poucas_lojas`: fewer than FEW_STORES stores; `precos_espalhados`: the neighbors' highest price is at least
    SPREAD_FACTOR times the lowest (sizes or portions likely differ); else `firme`. Few stores wins over spread."""
    if stores is None or int(stores) < FEW_STORES:
        return "poucas_lojas"
    if low_cents and high_cents and int(high_cents) >= SPREAD_FACTOR * int(low_cents):
        return "precos_espalhados"
    return "firme"


CHARM_CENTS = 90
"""Delivery menus price at ",90" (R$ 29,90): the test price lands on the highest such point it can."""


def gap_size(gap_fraction: Any, band: Any) -> str | None:
    """M1-06 gap against the M1-07 band, as a word for the AI to weigh: `pequena` inside the band, `moderada` up to
    twice the band, `grande` beyond it. No number on screen comes from it; it only orders the opportunities."""
    if gap_fraction is None:
        return None
    g, b = abs(Decimal(str(gap_fraction))), Decimal(str(band))
    if g < b:
        return "pequena"
    return "moderada" if g < 2 * b else "grande"


def charm_at_or_below(cents: int) -> int:
    """The highest price ending in ,90 at or below `cents` (R$ 26,40 -> R$ 25,90; R$ 29,90 -> R$ 29,90)."""
    whole, frac = divmod(int(cents), 100)
    return whole * 100 + CHARM_CENTS if frac >= CHARM_CENTS else (whole - 1) * 100 + CHARM_CENTS


def first_test_price(own_cents: Any, parity_cents: Any, band: Any) -> int | None:
    """First test price for a `pode_subir` item (M1-07), from the own price, the M1-05 parity and the M1-07 band.

    A raise is tested one step at a time: the step is capped at the band over the own price (one test never moves
    more than the band that defines "na média"), never past the parity, and lands on the ",90" point at or below that
    cap when one is above the own price; otherwise the cap itself. A `pode_subir` item sits more than the band below
    the parity, so the test is always a first step and the middle stays further up. None without room above the own
    price."""
    if own_cents is None or parity_cents is None or int(parity_cents) <= int(own_cents):
        return None
    own, parity = int(own_cents), int(parity_cents)
    cap = min(parity, own + int((Decimal(own) * Decimal(str(band))).to_integral_value(rounding="ROUND_FLOOR")))
    charm = charm_at_or_below(cap)
    price = charm if charm > own else cap
    return price if price > own else None


def category_role(own_cents: Any, group_prices: Sequence[int]) -> str | None:
    """Where an item sits in its own category ladder, among the run's compared items of the same M1-04 group:
    `unico`, `mais_barato` (the entry item), `mais_caro` (the reference item) or `no_meio`."""
    if own_cents is None or not group_prices:
        return None
    if len(group_prices) == 1:
        return "unico"
    low, high = min(group_prices), max(group_prices)
    if low == high:
        return "no_meio"
    if int(own_cents) == low:
        return "mais_barato"
    return "mais_caro" if int(own_cents) == high else "no_meio"


def build_facts(result: Mapping[str, Any], positions: Mapping[str, Any] | None) -> Facts:
    """M1-05 to M1-12 of one run, from monitor_result and monitor_positions, in the shape the prompt reads.

    Per compared item: name, category group, own price, parity (meio), low and high of the neighbors, gap % (M1-06),
    reading (M1-07), stores, the price difference to the middle, the comparison strength, the gap size against the band,
    the item's place in its own category ladder and, for `pode_subir`, the first test price (`first_test_price`). Per
    category: counts, % of items aligned (M1-12 v3), position (M1-10 per category) and the owner's lowest and highest
    compared price. The store position (M1-10), the menu % aligned and the only-yours count."""
    f = Facts(prompt={})
    positions = positions or {}
    score = positions.get("score") or {}
    pos = result.get("position") or positions.get("store_position")
    cat_pos = {c.get("group"): c for c in positions.get("by_category") or []}
    band = result.get("reading_band", 0.1)
    ladder: dict[Any, list[int]] = {}
    for it in result.get("items") or []:
        if it.get("own_cents") is not None:
            ladder.setdefault(it.get("group"), []).append(int(it["own_cents"]))

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
                "seu_menor_preco": _cents(f, min(ladder[group]) if ladder.get(group) else None),
                "seu_maior_preco": _cents(f, max(ladder[group]) if ladder.get(group) else None),
            }
        )

    items = []
    for it in list(result.get("items") or [])[:MAX_ITEMS]:
        iid = str(it["item_id"])
        f.item_ids.add(iid)
        own, parity = it.get("own_cents"), it.get("parity_cents")
        gap = _pct(f, it.get("gap_pct"))
        row: dict[str, Any] = {
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
            "comparacao": comparison_strength(it.get("stores"), it.get("low_cents"), it.get("high_cents")),
            "tamanho_da_diferenca": gap_size(it.get("gap_pct"), band),
            "papel_na_categoria": category_role(own, ladder.get(it.get("group")) or []),
        }
        price = first_test_price(own, parity, band) if it.get("reading") == "pode_subir" else None
        if price is not None:
            row["preco_para_testar"] = _cents(f, price)
            row["aumento_do_teste_pct"] = _whole_pct(f, round_half_away((Decimal(price) - own) * 100 / own))
        items.append(row)

    f.prompt = {
        "raio_km": _count(f, result.get("radius_km")),
        "faixa_da_media_pct": _pct(f, band),
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


# AI call ---------------------------------------------------------------------------------------------------------------


def build_call(facts: Facts) -> llm.Call:
    """The system rules and the run's facts as JSON."""
    return llm.Call("oportunidades", SYSTEM, {"fatos": facts.prompt}, OUTPUT_SCHEMA, 4000)


def build_request(facts: Facts, model: str, provider: str = llm.DEFAULT_PROVIDER) -> dict[str, Any]:
    """The SDK arguments (llm.build_request)."""
    return llm.build_request(provider, model, build_call(facts))


def parse_answer(answer: Mapping[str, Any] | None) -> list[Any]:
    """The answer object to the raw opportunities; none on a refusal, a cut or a malformed answer."""
    ops = answer.get("oportunidades") if answer else None
    return ops if isinstance(ops, list) else []


def parse_response(response: Any, provider: str = llm.DEFAULT_PROVIDER) -> list[Any]:
    """An SDK response (or its recorded dict) to the raw opportunities."""
    return parse_answer(llm.response_json(provider, response))


class OpportunityWriter(Protocol):
    model: str

    def write(self, facts: Facts) -> list[Any]: ...


class AiOpportunityWriter:
    """The real writer over `margo_common.llm` (provider from MARGO_AI_PROVIDER, model from MARGO_OPPORTUNITIES_MODEL)."""

    def __init__(self, client: Any = None, model: str | None = None, provider: str | None = None) -> None:
        self.ai = llm.StructuredClient(client, model, provider, MODEL_ENV)
        self.model = self.ai.model

    def write(self, facts: Facts) -> list[Any]:
        return parse_answer(self.ai.ask(build_call(facts)))


def writer_from_env() -> AiOpportunityWriter | None:
    """The writer when the provider's key is set; None skips the job (local development, tests)."""
    return AiOpportunityWriter() if llm.key_present() else None


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
