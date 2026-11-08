"""M1-12 (D73, Marlon 08/nov): before pairing ends, an AI reviews every automatic pair against a fixed
checklist.

The rules (M1-03, M1-04) propose pairs. The reviewer answers five yes-or-no questions per pair; a pair
passes only with five yeses, so the verdict is derived, not asked. A rejected pair leaves and the rules run
again: the store's next best item may take its place, and only what changed is reviewed in the next round,
up to `m1.pair_review_max_rounds`. What is still unreviewed then goes to the doubts instead of the
calculation.

Limits: the AI only removes pairs, never creates one; a person's decision is neither sent nor changed;
without a key the rules stand and the run says so. What goes out: name, description, section, category and
price of the two items, never a store or a person.

Each verdict is kept under a pair pattern. A pattern with `m1.pair_review_learning_min_runs` runs giving one
verdict and no other applies with no AI call. A rejection that rests only on price or portion is not kept:
it says something about that pair, not about the pattern.

Tests use a fake reviewer; no test calls the API (06, D40). `fixtures/ai/README.md` has the recording
command."""

from __future__ import annotations

import json
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from margo_common import llm
from margo_common.log import log_event

from .learning import pattern_m1_04
from .rules import FoodOverrides, Item, Settings, item_category_m1_04, normalize_m1_03
from .xray import ItemRow, PairRow, build_pairs

PROMPT_VERSION = "pareamento.v3"
MODEL_ENV = "MARGO_REVIEW_MODEL"
"""Overrides the provider's default model (llm.DEFAULT_MODELS)."""
BATCH = 100
"""Pairs per call; a larger run takes several calls."""
DEFAULT_TARGET = 0.95
DEFAULT_MAX_ROUNDS = 3
DEFAULT_MIN_RUNS = 3

CHECKS = ("mesmo_tipo", "mesma_proteina_ou_sabor", "mesmo_servico", "porcao_compativel", "preco_plausivel")
CONTEXT_CHECKS = frozenset({"porcao_compativel", "preco_plausivel"})
"""A rejection resting only on these belongs to that pair, not to its pattern."""
DOUBT_NOTE = "revisão de IA incompleta"

SYSTEM = (
    "Você confere pares de itens de cardápio de restaurantes vizinhos. Cada par foi proposto por regras"
    " como o mesmo produto, e o preço de um será usado para comparar com o do outro. Julgue como um "
    "cliente que escolhe entre os dois no aplicativo. Responda sim (true) ou não (false) a cada "
    "pergunta, usando só nome, descrição, seção, categoria, tamanho e preço. mesmo_tipo: são o mesmo "
    "tipo de produto? Um sashimi e uma isca não são; dois temakis são. mesma_proteina_ou_sabor: têm a "
    "mesma proteína principal, ou o mesmo sabor numa sobremesa ou bebida? mesmo_servico: são servidos "
    "do mesmo jeito, sem ser outra versão do produto? Uma versão zero ou sem açúcar, um item hot ou "
    "empanado contra um cru, ou um item com coberturas que o outro não cita são outros produtos. Um "
    "espeto não é um prato feito; um item mini não é o tamanho normal. porcao_compativel: a porção é "
    "parecida? Se um dos dois não disser o tamanho, responda sim. preco_plausivel: a diferença de preço"
    " cabe no mesmo produto? Responda não só quando um custar várias vezes o outro. Na dúvida sobre o "
    "que não está escrito, responda sim: reprove só o que os dados mostram ser diferente."
)

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pares": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"ref": {"type": "string"}, **{c: {"type": "boolean"} for c in CHECKS}},
                "required": ["ref", *CHECKS],
                "additionalProperties": False,
            },
        }
    },
    "required": ["pares"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class Verdict:
    """The five answers; the verdict is derived from them, never asked."""

    checks: Mapping[str, bool]

    @property
    def failed(self) -> tuple[str, ...]:
        return tuple(c for c in CHECKS if not self.checks.get(c, False))

    @property
    def approved(self) -> bool:
        return not self.failed


ReviewAnswers = dict[str, Verdict]


@dataclass(frozen=True)
class ReviewPair:
    ref: str
    category: str | None
    own: Item
    candidate: Item


class PairReviewer(Protocol):
    model: str
    prompt_version: str

    def review(self, pairs: Sequence[ReviewPair], cuisine: str | None = None) -> ReviewAnswers: ...


@dataclass
class ReviewRun:
    rows: list[ItemRow]
    status: str
    score: float | None = None
    first_round_score: float | None = None
    rounds: int = 0
    judged: int = 0
    approved: int = 0
    rejected: int = 0
    from_learnings: int = 0
    sent_to_doubts: int = 0
    model: str | None = None
    prompt_version: str | None = None
    detail: list[dict[str, Any]] = field(default_factory=list)
    answers: dict[str, bool] = field(default_factory=dict)


def _size(item: Item) -> str | None:
    """What the item states: "150 g", "500 ml", "8 unidades"; None when it states nothing."""
    n = normalize_m1_03(item)
    if not n.by_weight_or_pack:
        return None
    word = {"100g": "g", "100ml": "ml"}.get(n.unit, "unidades")
    return f"{int(n.own_base_qty)} {word}"


def side_of(item: Item) -> dict[str, Any]:
    return {
        "nome": item.name,
        "descricao": item.description,
        "secao": item.section,
        "preco_centavos": item.price_cents,
        "tamanho": _size(item),
    }


def cuisine_m1_12(shares: Mapping[str, float] | None, categories: Sequence[str]) -> str | None:
    """D77: the main cuisine of the store: its menu's largest term, else the first category chosen."""
    term = max(shares, key=lambda t: shares[t]) if shares else (categories[0] if categories else None)
    return term.lower() if term else None


def system_for(cuisine: str | None) -> str:
    """D77: the reviewer is an expert in the store's main cuisine: it knows a Filadélfia is salmon and cream
    cheese, and a hot roll is not a uramaki."""
    if not cuisine:
        return SYSTEM
    return f"Você é especialista na cozinha {cuisine}: use esse conhecimento para julgar cada par. {SYSTEM}"


def build_call(pairs: Sequence[ReviewPair], cuisine: str | None = None) -> llm.Call:
    """Business menu data only: `ref` is a local index, and an Item's store never goes out."""
    payload = {
        "pares": [
            {"ref": p.ref, "categoria": p.category, "item": side_of(p.own), "vizinho": side_of(p.candidate)}
            for p in pairs
        ]
    }
    return llm.Call("revisao_de_pares", system_for(cuisine), payload, OUTPUT_SCHEMA, 16000)


def build_request(
    pairs: Sequence[ReviewPair], model: str, provider: str = llm.DEFAULT_PROVIDER
) -> dict[str, Any]:
    return llm.build_request(provider, model, build_call(pairs))


def parse_answer(answer: Mapping[str, Any] | None, refs: Collection[str]) -> ReviewAnswers:
    """Only a ref we sent, once, with every check a boolean; nothing on a refusal or a cut."""
    rows = answer.get("pares") if answer else None
    out: ReviewAnswers = {}
    for row in rows if isinstance(rows, list) else []:
        ref = str(row.get("ref", "")) if isinstance(row, Mapping) else ""
        if ref not in refs or ref in out or not all(isinstance(row.get(c), bool) for c in CHECKS):
            continue
        out[ref] = Verdict({c: row[c] for c in CHECKS})
    return out


def parse_response(
    response: Any, refs: Collection[str], provider: str = llm.DEFAULT_PROVIDER
) -> ReviewAnswers:
    return parse_answer(llm.response_json(provider, response), refs)


class AiPairReviewer:
    """The real PairReviewer over `margo_common.llm` (model: MARGO_REVIEW_MODEL)."""

    prompt_version = PROMPT_VERSION

    def __init__(self, client: Any = None, model: str | None = None, provider: str | None = None) -> None:
        self.ai = llm.StructuredClient(client, model, provider, MODEL_ENV)
        self.model = self.ai.model

    def review(self, pairs: Sequence[ReviewPair], cuisine: str | None = None) -> ReviewAnswers:
        out: ReviewAnswers = {}
        for start in range(0, len(pairs), BATCH):
            batch = pairs[start : start + BATCH]
            out.update(parse_answer(self.ai.ask(build_call(batch, cuisine)), {p.ref for p in batch}))
        return out


def reviewer_from_env() -> AiPairReviewer | None:
    """The reviewer when the provider's key is set; None leaves the rules alone."""
    return AiPairReviewer() if llm.key_present() else None


def pair_pattern(own: Item, candidate: Item) -> str:
    """The key a verdict is kept under: both sides' category, name tokens and description hints."""
    a, b = pattern_m1_04(own), pattern_m1_04(candidate)
    return json.dumps([[a.category, a.tokens, a.hints], [b.category, b.tokens, b.hints]], ensure_ascii=False)


def learned_verdict(answers: Mapping[str, bool], min_runs: int = DEFAULT_MIN_RUNS) -> bool | None:
    """The verdict that applies with no AI call: enough runs, one verdict. None otherwise."""
    if len(answers) < min_runs or len(set(answers.values())) != 1:
        return None
    return next(iter(answers.values()))


def _open_pairs(rows: Sequence[ItemRow], done: Collection[tuple[str, str]]) -> list[tuple[str, str]]:
    """The automatic accepted pairs not yet judged; a person's decision (`by`) is never one."""
    return [
        (r.public_menu_item_id, p.public_menu_item_id)
        for r in rows
        for p in r.pairs
        if p.accepted and p.by is None and (r.public_menu_item_id, p.public_menu_item_id) not in done
    ]


def _doubts(
    rows: Sequence[ItemRow],
    unreviewed: Collection[tuple[str, str]],
    items: Mapping[str, Item],
    settings: Settings,
) -> list[ItemRow]:
    """Unreviewed pairs leave the calculation; an item left short of stores becomes a doubt."""
    out = []
    for r in rows:
        if not any((r.public_menu_item_id, p.public_menu_item_id) in unreviewed for p in r.pairs):
            out.append(r)
            continue
        pairs: list[PairRow] = [
            replace(p, accepted=False) if (r.public_menu_item_id, p.public_menu_item_id) in unreviewed else p
            for p in r.pairs
        ]
        stores = {items[p.public_menu_item_id].store_id for p in pairs if p.accepted}
        need = 1 if r.item_category == "bebidas" else settings.min_pairs
        short = len(stores) < need
        out.append(
            replace(
                r,
                pairs=tuple(pairs),
                pair_status="revisar" if short else r.pair_status,
                pair_note=DOUBT_NOTE if short else r.pair_note,
            )
        )
    return out


def review_pairing_m1_12(
    own: Sequence[Item],
    pool: Sequence[Item],
    settings: Settings,
    decisions: Mapping[tuple[str, str], tuple[bool, str]],
    food: FoodOverrides | None,
    reviewer: PairReviewer | None,
    learnings: Mapping[str, Mapping[str, bool]],
    *,
    target: float = DEFAULT_TARGET,
    max_rounds: int = DEFAULT_MAX_ROUNDS,
    min_runs: int = DEFAULT_MIN_RUNS,
    xray_id: str = "",
    cuisine: str | None = None,
) -> ReviewRun:
    """M1-12: the rules' pairs, reviewed and re-run until nothing is left to judge or the rounds end."""
    first = build_pairs(own, pool, settings, decisions, food)
    if reviewer is None:
        log_event("m1_pair_review_skipped", xray_id=xray_id, note="chave de IA ausente: só regras")
        return ReviewRun(first, "sem_ia")
    items = {i.id: i for i in [*own, *pool]}
    run = ReviewRun(first, "adequado", model=reviewer.model, prompt_version=reviewer.prompt_version)
    approved: set[tuple[str, str]] = set()
    rejected: set[tuple[str, str]] = set()
    asked_any, answered_any = False, False
    for number in range(1, max_rounds + 1):
        pending = _open_pairs(run.rows, approved | rejected)
        if not pending:
            break
        run.rounds = number
        ask: list[ReviewPair] = []
        learned_ok = learned_bad = 0
        for ref, key in enumerate(pending):
            own_item, cand = items[key[0]], items[key[1]]
            known = learned_verdict(learnings.get(pair_pattern(own_item, cand), {}), min_runs)
            if known is None:
                ask.append(ReviewPair(str(ref), item_category_m1_04(own_item), own_item, cand))
                continue
            run.from_learnings += 1
            if known:
                approved.add(key)
                learned_ok += 1
            else:
                rejected.add(key)
                learned_bad += 1
                run.detail.append(_rejection(key, "aprendido", number))
        answers = reviewer.review(ask, cuisine) if ask else {}
        asked_any = asked_any or bool(ask)
        answered_any = answered_any or bool(answers)
        log_event(
            "m1_pair_review_round", xray_id=xray_id, round=number, asked=len(ask), answered=len(answers)
        )
        good, bad = learned_ok, learned_bad
        for p in ask:
            v = answers.get(p.ref)
            if v is None:
                continue
            key = (p.own.id, p.candidate.id)
            if v.approved:
                approved.add(key)
                good += 1
                run.answers[pair_pattern(p.own, p.candidate)] = True
            else:
                rejected.add(key)
                bad += 1
                run.detail.append(_rejection(key, v.failed[0], number))
                if not set(v.failed) <= CONTEXT_CHECKS:
                    run.answers[pair_pattern(p.own, p.candidate)] = False
        if run.first_round_score is None and good + bad:
            run.first_round_score = good / (good + bad)
        run.rows = build_pairs(own, pool, settings, decisions, food, rejected=rejected)
    if asked_any and not answered_any:
        log_event("m1_pair_review_no_answer", xray_id=xray_id)
        return ReviewRun(first, "sem_resposta", model=reviewer.model, prompt_version=reviewer.prompt_version)
    unreviewed = _open_pairs(run.rows, approved | rejected)
    run.rows = _doubts(run.rows, set(unreviewed), items, settings)
    run.judged, run.approved, run.rejected = len(approved) + len(rejected), len(approved), len(rejected)
    run.sent_to_doubts = len(unreviewed)
    final = len([k for k in approved if _is_accepted(run.rows, k)])
    # After the rejections leave, what counts is how much of what remains was reviewed;
    # `first_round_score` keeps how good the rules' own pairs were.
    run.score = final / (final + run.sent_to_doubts) if final + run.sent_to_doubts else 1.0
    run.status = "adequado" if run.score >= target else "abaixo_da_meta"
    log_event(
        "m1_pair_review",
        xray_id=xray_id,
        status=run.status,
        score=run.score,
        rounds=run.rounds,
        rejected=run.rejected,
        doubts=run.sent_to_doubts,
    )
    return run


def _is_accepted(rows: Sequence[ItemRow], key: tuple[str, str]) -> bool:
    return any(
        r.public_menu_item_id == key[0] and p.public_menu_item_id == key[1] and p.accepted
        for r in rows
        for p in r.pairs
    )


def _rejection(key: tuple[str, str], reason: str, number: int) -> dict[str, Any]:
    return {"own_item_id": key[0], "candidate_item_id": key[1], "motivo": reason, "rodada": number}
