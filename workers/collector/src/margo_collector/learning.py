"""M1-04 Stage 2: what the AI read is learned, so the rule layer improves (Marlon, 07/nov). Pure functions;
the repository keeps the rows (public.m1_attr_learning, public.m1_attr_learning_run).

A learning is kept under a pattern: the item's category, its normalized name tokens and the words of the
fixed lists its description holds (`description_hints_m1_04`); never the raw name, and only in the database.
Each X-ray run that asked the AI adds one answer (a re-run of the same X-ray replaces its answer, so it
counts once). A pattern with at least `m1.attr_learning_min_runs` runs giving the same answer and no other
answer is promoted and applied like a rule, with no AI call. Two different answers mark it disputed: it goes
back to the AI on each run and a founder can settle it. A founder's correction in C04 wins over any AI
answer. Mirrors the hybrid ingredient rules of M3 (ingredient_rule.auto_confirm and disputed_at).

Without the AI key (OPENAI_API_KEY, D70) nothing is read and nothing is learned: the result is
the rules alone."""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from margo_common.log import log_event

from .food import FoodAttrs, attrs_from_json, attrs_to_json, description_hints_m1_04, unreadable_food_m1_04
from .rules import Item, is_food_m1_04, item_category_m1_04, item_food_attrs_m1_04, name_tokens

DEFAULT_MIN_RUNS = 3
LearningStatus = Literal["fundador", "promovido", "disputado", "pendente"]


@dataclass(frozen=True, order=True)
class Pattern:
    category: str
    tokens: tuple[str, ...]
    hints: tuple[str, ...]


def pattern_m1_04(item: Item) -> Pattern:
    """The key a learning is kept under: category, sorted name tokens, description hints."""
    category = item_category_m1_04(item) or ""
    return Pattern(
        category, tuple(sorted(name_tokens(item.name))), description_hints_m1_04(item.description, category)
    )


def _key(attrs: Mapping[str, Any]) -> str:
    import json

    return json.dumps(dict(attrs), sort_keys=True, ensure_ascii=False)


@dataclass
class Learning:
    pattern: Pattern
    answers: dict[str, dict[str, Any]] = field(default_factory=dict)
    """X-ray id to the AI's attributes in that run (`attrs_to_json`)."""
    founder: dict[str, Any] | None = None
    """A founder's attributes (C04); wins over every AI answer."""
    founder_disputed: bool = False
    """A founder rejected a pair these attributes made: back to the AI or a founder."""
    items_seen: int = 0

    def status(self, min_runs: int = DEFAULT_MIN_RUNS) -> LearningStatus:
        if self.founder is not None:
            return "fundador"
        if self.founder_disputed or len({_key(a) for a in self.answers.values()}) > 1:
            return "disputado"
        if len(self.answers) >= min_runs:
            return "promovido"
        return "pendente"

    def applied(self, min_runs: int = DEFAULT_MIN_RUNS) -> FoodAttrs | None:
        """The attributes the rule layer applies with no AI call; None while pending or disputed."""
        st = self.status(min_runs)
        if st == "fundador":
            return attrs_from_json(self.founder or {}, "fundador")
        if st == "promovido":
            return attrs_from_json(next(iter(self.answers.values())), "aprendido")
        return None


@dataclass(frozen=True)
class AiItem:
    """What goes to the model: business menu data only (name, description, category); `ref` is a local index.
    """

    ref: str
    name: str
    description: str | None
    category: str


class AttrReader(Protocol):
    model: str

    def read(self, items: Sequence[AiItem]) -> dict[str, tuple[FoodAttrs, float | None]]: ...


@dataclass(frozen=True)
class Answer:
    pattern: Pattern
    attrs: dict[str, Any]
    confidence: float | None
    items_seen: int


@dataclass
class FoodRun:
    overrides: dict[str, FoodAttrs] = field(default_factory=dict)
    answers: list[Answer] = field(default_factory=list)
    unreadable: int = 0
    from_learnings: int = 0
    ai_items: int = 0
    ai_skipped: bool = False


def unreadable_items(items: Iterable[Item]) -> list[Item]:
    """Single non-beverage items whose protein or type the rule cannot read, each once."""
    seen: set[str] = set()
    out = []
    for i in items:
        if i.id in seen or not is_food_m1_04(i):
            continue
        seen.add(i.id)
        if unreadable_food_m1_04(item_food_attrs_m1_04(i), item_category_m1_04(i)) is not None:
            out.append(i)
    return out


def read_food_m1_04(
    items: Iterable[Item],
    learnings: Mapping[Pattern, Learning],
    reader: AttrReader | None,
    *,
    min_runs: int = DEFAULT_MIN_RUNS,
    max_items: int = 200,
    xray_id: str = "",
) -> FoodRun:
    """M1-04 Stage 2: attributes for the items the rule cannot read. A founder's or a promoted learning
    first, with no AI call; the rest goes to the AI in one call (one item per pattern, at most `max_items`).
    Without a reader nothing is read and nothing is learned. An answer only fills attributes: a pair still
    needs them to match."""
    run = FoodRun(ai_skipped=reader is None)
    if reader is None:
        return run
    pending: dict[Pattern, list[Item]] = {}
    for item in unreadable_items(items):
        run.unreadable += 1
        p = pattern_m1_04(item)
        learned = learnings.get(p)
        applied = learned.applied(min_runs) if learned else None
        if applied is not None and unreadable_food_m1_04(applied, p.category) is None:
            run.overrides[item.id] = applied
            run.from_learnings += 1
        else:
            pending.setdefault(p, []).append(item)
    asked = sorted(pending)[:max_items]
    if not asked:
        return run
    batch = [
        AiItem(str(n), pending[p][0].name, pending[p][0].description, p.category) for n, p in enumerate(asked)
    ]
    log_event("m1_attr_ai_call", xray_id=xray_id, items=len(batch), model=reader.model)
    found = reader.read(batch)
    run.ai_items = len(batch)
    for n, p in enumerate(asked):
        got = found.get(str(n))
        if got is None:
            continue
        attrs, confidence = got
        if unreadable_food_m1_04(attrs, p.category) is not None:
            continue  # the AI could not read it either: no learning, the items stay as the rule left them
        for item in pending[p]:
            run.overrides[item.id] = attrs
        run.answers.append(Answer(p, attrs_to_json(attrs), confidence, len(pending[p])))
    log_event(
        "m1_attr_ai_result", xray_id=xray_id, items=len(batch), answered=len(run.answers), model=reader.model
    )
    return run


@dataclass(frozen=True)
class FounderLearning:
    pattern: Pattern
    attrs: dict[str, Any] | None
    """None: the founder rejected a pair the learned or AI attributes made (a dispute)."""
    person: str


def founder_learnings_m1_04(
    decisions: Mapping[tuple[str, str], tuple[bool, str]],
    items: Mapping[str, Item],
    ai_read: Collection[str],
) -> list[FounderLearning]:
    """M1-04 Stage 2: what a founder's C04 decisions teach. An accepted pair between an item the rule reads
    and one it cannot gives the unreadable side's pattern the readable side's attributes. A rejected pair
    whose unreadable side the AI or a learning read (`ai_read`, item ids) disputes that pattern. Two founders
    teaching two different answers for one pattern teach nothing (a dispute)."""
    taught: dict[Pattern, tuple[dict[str, Any] | None, str]] = {}
    disputed: dict[Pattern, str] = {}
    for (own_id, cand_id), (accepted, person) in sorted(decisions.items()):
        a, b = items.get(own_id), items.get(cand_id)
        if a is None or b is None or not is_food_m1_04(a) or not is_food_m1_04(b):
            continue
        for unread, read in ((a, b), (b, a)):
            ru = item_food_attrs_m1_04(unread)
            if unreadable_food_m1_04(ru, item_category_m1_04(unread)) is None:
                continue
            p = pattern_m1_04(unread)
            rr = item_food_attrs_m1_04(read)
            if accepted and unreadable_food_m1_04(rr, item_category_m1_04(read)) is None:
                answer = attrs_to_json(rr)
                prior = taught.get(p)
                if prior is not None and prior[0] is not None and _key(prior[0]) != _key(answer):
                    disputed[p] = person
                else:
                    taught[p] = (answer, person)
            elif not accepted and unread.id in ai_read:
                disputed[p] = person
    out = [FounderLearning(p, attrs, person) for p, (attrs, person) in taught.items() if p not in disputed]
    out += [FounderLearning(p, None, person) for p, person in disputed.items()]
    return sorted(out, key=lambda f: f.pattern)


def apply_answers(learnings: dict[Pattern, Learning], xray_id: str, answers: Sequence[Answer]) -> None:
    """In memory, what the repository does with this run's AI answers: one answer per X-ray per pattern."""
    for a in answers:
        lr = learnings.setdefault(a.pattern, Learning(a.pattern))
        lr.answers[xray_id] = dict(a.attrs)
        lr.items_seen += a.items_seen


def apply_founders(learnings: dict[Pattern, Learning], taught: Sequence[FounderLearning]) -> None:
    """In memory, what the repository does with founder corrections: an answer wins and clears a dispute; a
    rejection disputes the pattern unless a founder already taught it."""
    for f in taught:
        lr = learnings.setdefault(f.pattern, Learning(f.pattern))
        if f.attrs is not None:
            lr.founder = dict(f.attrs)
            lr.founder_disputed = False
        elif lr.founder is None:
            lr.founder_disputed = True
