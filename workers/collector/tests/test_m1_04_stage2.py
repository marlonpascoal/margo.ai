"""M1-04 Stage 2: lanches and porções paired by attributes, the AI only for what the rules cannot read, what it
teaches, and exclusive items. Acceptance IDs A6 to A8 and B7 of the pairing redesign (Marlon, 07/nov), one test per
failure shape found on real data. All names are SINTÉTICO: generic products, no restaurant's menu."""

from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

import pytest
from margo_collector import ai_attrs
from margo_collector.ai_attrs import AiAttrReader, build_request, parse_response, validate
from margo_collector.food import (
    EXCLUSIVE_NOTE,
    FoodAttrs,
    attrs_from_json,
    attrs_to_json,
    compare_food_m1_04,
    description_hints_m1_04,
    food_attrs_m1_04,
    signature_hint,
    vocabulary_word,
)
from margo_collector.learning import (
    AiItem,
    Learning,
    apply_answers,
    apply_founders,
    founder_learnings_m1_04,
    pattern_m1_04,
    read_food_m1_04,
)
from margo_collector.repo import MemoryXrayRepo
from margo_collector.rules import Item, Settings, pair_item_m1_04
from margo_collector.steps import XrayRun, pair_step
from margo_collector.xray import CalcInput, build_pairs, calculate
from margo_common import llm

ROOT = Path(__file__).resolve().parents[3]


def lanche(iid: str, store: str, name: str, desc: str | None = None, cents: int = 2500) -> Item:
    return Item(iid, store, name, cents, section="Lanches", description=desc)


def porcao(
    iid: str, store: str, name: str, desc: str | None = None, cents: int = 3000, unit="un", qty=None
) -> Item:
    return Item(iid, store, name, cents, unit, qty, section="Porções", description=desc)


def five(name: str, desc: str | None = None, n: int = 5, make=lanche) -> list[Item]:
    return [make(f"{name}-{i}", f"s{i}", name, desc, 2500 + 10 * i) for i in range(n)]


def attrs(name: str, desc: str | None = None, category: str = "lanches") -> FoodAttrs:
    return food_attrs_m1_04(name, desc, category)


def accepted(p) -> list[str]:
    return [c.item.name for c in p.candidates if c.accepted]


# Attributes by rule ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "desc", "base", "proteins", "patties"),
    [
        ("Dog de frango", None, "dog", {"salsicha", "frango"}, 1),
        ("Dog de bacon duplo", None, "dog", {"salsicha", "bacon"}, 2),
        ("X dog frango", "Pão, duas salsichas, presunto, queijo, frango", "dog", {"salsicha", "frango"}, 2),
        ("Dog de frango duplo", "Pão, salsicha, frango", "dog", {"salsicha", "frango"}, 2),
        ("X-Bacon da vila", None, "burguer", {"bovino", "bacon"}, 1),
        ("Burguer com bacon", "Pão de hambúrguer, hambúrguer, bacon, queijo", "burguer", {"bovino", "bacon"}, 1),
        ("Cheese de frango", "Pão brioche, frango desfiado, cheddar, alface", "burguer", {"frango"}, 1),
        (
            "X Frango da vila",
            "Pão de burger, hambúrguer artesanal 150g, queijo, frango desfiado",
            "burguer",
            {"bovino", "frango"},
            1,
        ),
        ("X Frango da vila", "Pão, filé de frango, queijo, tomate", "burguer", {"frango"}, 1),
        ("Burger de frango crispy", "Hambúrguer de frango empanado, alface", "burguer", {"frango"}, 1),
        ("Costela burger", "Blend de costela 180g", "burguer", {"costela"}, 1),
        (
            "Monstro bacon",
            "Pão brioche, 2 hambúrguer bovino 160g, bacon, cheddar",
            "burguer",
            {"bovino", "bacon"},
            2,
        ),
        ("Bacon duplo", None, None, {"bovino", "bacon"}, 2),
        ("Smash simples", None, "burguer", {"bovino"}, 1),
        ("Burger triplo", None, "burguer", {"bovino"}, 3),
        ("Triplo cheddar cremoso", None, None, set(), 1),
        ("Frango da vila", "Um pastel de frango bem recheado", "pastel", {"frango"}, 1),
        (
            "Especial da vila",
            "Pão, hambúrguer, frango, bacon, ovo, salsicha, presunto",
            "burguer",
            {"bovino", "frango", "bacon", "ovo", "salsicha"},
            1,
        ),
    ],
)
def test_M1_04_A6_A7_proteins_base_and_patties_from_the_name_then_the_description(
    name, desc, base, proteins, patties
):
    a = attrs(name, desc)
    assert (a.base, set(a.proteins), a.patties) == (base, proteins, patties)


def test_M1_04_A7_double_cheese_is_no_double_patty():
    assert attrs("X-Bacon da vila", "Hambúrguer, bacon e duplo queijo mussarela").patties == 1
    assert attrs("X Frango dupla mussarela").patties == 1


def test_M1_04_A8_weight_from_the_name_then_the_description_and_portion_sizes():
    assert attrs("Burguer com bacon 160", "Pão, hambúrguer bovino 160g, bacon").weight_g == 160
    assert attrs("Burger 180 g").weight_g == 180
    assert attrs("Tirinhas de peixe - Média", None, "porcoes").portion == "media"
    assert attrs("Fritas tamanho grande", None, "porcoes").portion == "grande"
    assert attrs("Calabresa acebolada serve 2 pessoas", None, "porcoes").portion == "2 pessoas"
    assert attrs("Fritas 1,2kg", None, "porcoes").weight_g == 1200


def test_M1_04_extras_are_listed_by_class():
    assert set(attrs("Dog de bacon e queijo").extras) == {"queijo"}
    assert set(attrs("X-Salada da vila").extras) == {"queijo", "salada"}
    assert "cebola" in attrs("Burguer com bacon cebola caramelizada").extras


# Comparing ---------------------------------------------------------------------------------------------


def test_M1_04_A6_another_protein_is_another_item():
    assert compare_food_m1_04(attrs("Dog de bacon"), attrs("Dog de frango")) == "conflict"
    assert compare_food_m1_04(attrs("Burguer com bacon"), attrs("Burguer com frango e bacon")) == "conflict"
    assert (
        compare_food_m1_04(attrs("Tirinhas de peixe", None, "porcoes"), attrs("Tirinhas de frango da vila", None, "porcoes"))
        == "conflict"
    )
    assert (
        compare_food_m1_04(
            attrs("Cheese de frango", "Pão, frango desfiado"),
            attrs("Cheese burguer de frango", "Pão, hambúrguer, frango"),
        )
        == "conflict"
    )


def test_M1_04_A7_simple_never_meets_double_or_triple():
    assert compare_food_m1_04(attrs("Dog de bacon"), attrs("Dog de bacon duplo")) == "conflict"
    assert compare_food_m1_04(attrs("Smash simples"), attrs("Smash duplo")) == "conflict"
    assert compare_food_m1_04(attrs("Bacon duplo"), attrs("Bacon triplo")) == "conflict"


def test_M1_04_A8_a_stated_weight_or_portion_must_match_when_both_state_it():
    a = attrs("Burguer com bacon", "hambúrguer bovino 160g, bacon")
    assert compare_food_m1_04(a, attrs("Burguer com bacon", "hambúrguer artesanal 150g, bacon")) == "conflict"
    assert compare_food_m1_04(a, attrs("Burguer com bacon", "hambúrguer, bacon")) == "identical", (
        "one side silent"
    )
    m, g = attrs("Tirinhas de frango média", None, "porcoes"), attrs("Tirinhas de frango grande", None, "porcoes")
    assert compare_food_m1_04(m, g) == "conflict"
    assert compare_food_m1_04(m, g, by_weight=True) == "identical", "M1-03 already compares per 100 g"


def test_M1_04_the_base_must_match_when_both_state_it():
    assert (
        compare_food_m1_04(attrs("Frango da vila", "um pastel de frango"), attrs("X Frango da vila", "pão, frango"))
        == "conflict"
    )
    assert compare_food_m1_04(attrs("Frango crispy"), attrs("Burger de frango crispy")) == "identical"


def test_M1_04_extras_rule_cheese_salad_or_a_sauce_alone_do_not_separate():
    """Proposed default (Marlon decides): an extra main ingredient makes it different (a protein, A6); cheese, salad or
    the other extras alone do not."""
    assert compare_food_m1_04(attrs("Dog de bacon"), attrs("Dog de bacon e queijo")) == "identical"
    assert compare_food_m1_04(attrs("X-Bacon da vila"), attrs("Burguer com bacon e salada")) == "identical"
    assert compare_food_m1_04(attrs("Burguer com bacon"), attrs("Burguer com bacon e barbecue")) == "identical"
    assert compare_food_m1_04(attrs("Dog de bacon"), attrs("Dog de bacon e frango")) == "conflict"


# Pairing -----------------------------------------------------------------------------------------------


def test_M1_04_A6_A7_A8_pairs_only_inside_the_attribute_block():
    own = lanche("o", "t", "Dog de bacon")
    pool = five("Dog de bacon e queijo") + five("Dog de frango", n=3) + five("Dog de bacon duplo", n=3)
    p = pair_item_m1_04(own, pool, Settings())
    assert p.status == "auto"
    assert set(accepted(p)) == {"Dog de bacon e queijo"}


def test_M1_04_name_similarity_breaks_the_tie_inside_a_store():
    own = lanche("o", "t", "Burguer com bacon")
    pool = five("Burguer com bacon") + [lanche("x", "s0", "Bacon especial da vila", "hambúrguer, bacon")]
    p = pair_item_m1_04(own, pool, Settings())
    assert "Bacon especial da vila" not in accepted(p), "the store's closer name wins"
    assert len({c.item.store_id for c in p.candidates if c.accepted}) == 5


def test_M1_04_a_name_with_no_word_in_common_is_no_candidate():
    own = lanche("o", "t", "Burguer com bacon")
    p = pair_item_m1_04(own, five("Vila Nova", "hambúrguer, bacon"), Settings())
    assert accepted(p) == []


def test_M1_04_an_unreadable_lanche_goes_to_revisar_with_its_reason():
    p = pair_item_m1_04(lanche("o", "t", "Gigante da casa"), five("Gigante da casa"), Settings())
    assert (p.status, p.note) == ("revisar", "proteína ilegível")
    assert accepted(p) == [] and len(p.candidates) == 5, "listed for a founder"


def test_M1_04_porcoes_by_weight_compare_per_100g_whatever_the_size_word():
    own = porcao("o", "t", "Batata palito média", unit="g", qty=300)
    pool = [porcao(f"b{i}", f"s{i}", "Batata palito grande", unit="g", qty=500) for i in range(5)]
    assert pair_item_m1_04(own, pool, Settings()).status == "normalizado"


# Exclusive items ---------------------------------------------------------------------------------------


def test_M1_04_B7_an_item_no_store_sells_with_its_attributes_is_exclusive():
    own = lanche("o", "t", "Especial da vila", "Pão, hambúrguer, frango, bacon, ovo, salsicha")
    pool = five("Especial da vila frango", "Pão, filé de frango, queijo")
    p = pair_item_m1_04(own, pool, Settings())
    assert (p.status, p.note) == ("exclusivo", EXCLUSIVE_NOTE), "not revisar"
    assert accepted(p) == []
    assert len(p.candidates) == 5, "similar names listed so a founder can still pair it"


def test_M1_04_B7_a_signature_word_is_only_a_hint():
    assert signature_hint("Especial da casa") and signature_hint("Lanche Vila", "Lanchonete Vila")
    own = lanche("o", "t", "X-Bacon especial da vila", "Pão, hambúrguer, bacon")
    p = pair_item_m1_04(own, five("X-Bacon da vila", "Pão, hambúrguer, bacon, queijo"), Settings())
    assert p.status == "auto", "the attributes decide"


def test_M1_04_B7_one_store_with_the_same_attributes_is_few_pairs_not_exclusive():
    own = lanche("o", "t", "Dog de bacon")
    p = pair_item_m1_04(own, five("Dog de bacon", n=2), Settings())
    assert (p.status, p.note) == ("revisar", "poucos pares")


def test_M1_04_B7_exclusive_stays_out_of_parity_and_the_pareto_and_a_founder_can_pair_it():
    own = lanche("o", "t", "Especial da vila", "Pão, hambúrguer, frango, bacon, ovo")
    pool = five("Especial frango", "Pão, filé de frango")
    row = build_pairs([own], pool, Settings())[0]
    assert row.pair_status == "exclusivo"
    calc = calculate([CalcInput("k", own, (), None)], min_pairs=5)
    assert calc.rows[0].parity_cents is None and calc.items_analyzed == 0
    chosen = pool[0].id
    row = build_pairs([own], pool, Settings(), {(own.id, chosen): (True, "founder")})[0]
    assert [p.public_menu_item_id for p in row.pairs if p.accepted] == [chosen]
    calc = calculate([CalcInput("k", own, (pool[0],), None, reviewed=True)], min_pairs=5)
    assert calc.rows[0].parity_cents == pool[0].price_cents


# The AI: request, answer, recorder ------------------------------------------------------------------------


def test_M1_04_ai_request_sends_business_data_only():
    req = build_request([AiItem("0", "Lanche da vila", "Pão e bacon", "lanches")], "m")
    body = llm.request_payload("openai", req)
    assert set(body["itens"][0]) == {"ref", "nome", "descricao", "categoria"}
    assert req["text"]["format"]["type"] == "json_schema" and req["text"]["format"]["strict"] is True
    assert req["model"] == "m"
    anthropic = build_request([AiItem("0", "Lanche da vila", "Pão e bacon", "lanches")], "m", "anthropic")
    assert llm.request_payload("anthropic", anthropic) == body, "D70: the same payload for either provider"


def test_M1_04_ai_answers_are_validated_against_what_was_sent():
    items = [
        {
            "ref": "0",
            "base": "burguer",
            "proteinas": ["bovino", "bacon", "inventada"],
            "carnes": 2,
            "peso_g": 160,
            "porcao": None,
            "extras": ["queijo"],
            "confianca": 1.4,
        },
        {
            "ref": "0",
            "base": "dog",
            "proteinas": [],
            "carnes": 1,
            "peso_g": None,
            "porcao": None,
            "extras": [],
            "confianca": 0.5,
        },
        {
            "ref": "9",
            "base": "dog",
            "proteinas": ["salsicha"],
            "carnes": 1,
            "peso_g": None,
            "porcao": None,
            "extras": [],
            "confianca": 1,
        },
        {
            "ref": "1",
            "base": "dog",
            "proteinas": ["salsicha"],
            "carnes": 7,
            "peso_g": None,
            "porcao": None,
            "extras": [],
            "confianca": 1,
        },
    ]
    out = validate(items, {"0", "1"})
    assert set(out) == {"0"}, "one per ref, refs we sent, a count from 1 to 3"
    a, conf = out["0"]
    assert (a.base, set(a.proteins), a.patties, a.weight_g, conf, a.source) == (
        "burguer",
        {"bovino", "bacon"},
        2,
        160,
        1.0,
        "ia",
    )


def test_M1_04_D70_ai_refusal_or_cut_answer_reads_nothing():
    class R:
        stop_reason = "max_tokens"
        content = []

    assert parse_response(R(), {"0"}, "anthropic") == {}
    assert parse_response({"status": "incomplete", "output": []}, {"0"}) == {}
    refusal = {"type": "message", "content": [{"type": "refusal", "refusal": "não"}]}
    assert parse_response({"status": "completed", "output": [refusal]}, {"0"}) == {}


def test_M1_04_D70_ai_model_is_a_parameter_and_the_key_is_read_by_name(monkeypatch):
    monkeypatch.delenv("MARGO_AI_PROVIDER", raising=False)
    monkeypatch.delenv("MARGO_PAIR_MODEL", raising=False)
    assert AiAttrReader(client=object()).model == llm.USE_DEFAULTS["openai"]["MARGO_PAIR_MODEL"]
    monkeypatch.setenv("MARGO_PAIR_MODEL", "outro-modelo")
    assert AiAttrReader(client=object()).model == "outro-modelo"
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        AiAttrReader()
    assert ai_attrs.reader_from_env() is None


def test_M1_04_recorder_sends_synthetic_items_in_the_worker_shape():
    from margo_collector import record_pairing

    body = llm.request_payload("openai", build_request(record_pairing.ITEMS, "m"))
    assert len(body["itens"]) == len(record_pairing.ITEMS)
    assert all(set(i) == {"ref", "nome", "descricao", "categoria"} for i in body["itens"])


@pytest.mark.parametrize("path", sorted((ROOT / "fixtures" / "ai").glob("pairing-*.json")) or [None])
def test_M1_04_D70_recorded_answers_parse(path):
    """Replays every answer Marlon recorded (`uv run record-ai-pairing`); none yet means nothing to replay."""
    if path is None:
        pytest.skip("no pairing recording yet: fixtures/ai/README.md")
    rec = json.loads(path.read_text())
    sent = {i["ref"] for i in llm.request_payload(rec["provider"], rec["request"])["itens"]}
    out = parse_response(rec["response"], sent, rec["provider"])
    assert set(out) <= sent


# The learning loop -------------------------------------------------------------------------------------


class FakeReader:
    """A fake AttrReader for the loop's logic; it says what a test asks it to say, never a recorded model answer."""

    model = "modelo-de-teste"

    def __init__(self, answer: FoodAttrs | None) -> None:
        self.answer = answer
        self.calls: list[list[str]] = []

    def read(self, items):
        self.calls.append([i.name for i in items])
        return {i.ref: (self.answer, 0.9) for i in items} if self.answer else {}


BACON = FoodAttrs("burguer", frozenset({"bovino", "bacon"}), 1, None, None, frozenset(), "ia")
FRANGO = FoodAttrs("burguer", frozenset({"frango"}), 1, None, None, frozenset(), "ia")


def test_M1_04_pattern_keeps_tokens_and_list_words_never_free_text():
    item = lanche("o", "t", "Gigante da Vila", "Pão de dog, duas salsichas e frango")
    p = pattern_m1_04(item)
    assert p.tokens == ("gigante", "vila") and p.hints == description_hints_m1_04(item.description, "lanches")
    assert all(h.split(":")[0] in {"base", "proteina", "carnes"} for h in p.hints)
    assert vocabulary_word("bacon") and not vocabulary_word("vila")


def test_M1_04_learning_promotes_after_n_agreeing_runs_then_no_ai_call():
    item = lanche("o", "t", "Gigante da vila")
    learnings: dict = {}
    for run in ("x1", "x2", "x3"):
        reader = FakeReader(BACON)
        r = read_food_m1_04([item], learnings, reader, min_runs=3, xray_id=run)
        assert reader.calls == [["Gigante da vila"]]
        assert r.overrides[item.id].proteins == BACON.proteins
        apply_answers(learnings, run, r.answers)
    assert learnings[pattern_m1_04(item)].status(3) == "promovido"
    reader = FakeReader(FRANGO)
    r = read_food_m1_04([item], learnings, reader, min_runs=3, xray_id="x4")
    assert reader.calls == [], "a promoted pattern is applied like a rule, no AI call"
    assert r.overrides[item.id].source == "aprendido" and r.from_learnings == 1


def test_M1_04_learning_a_rerun_of_one_xray_counts_once():
    item = lanche("o", "t", "Gigante da vila")
    learnings: dict = {}
    for _ in range(3):
        apply_answers(
            learnings, "x1", read_food_m1_04([item], learnings, FakeReader(BACON), xray_id="x1").answers
        )
    assert learnings[pattern_m1_04(item)].status(3) == "pendente"


def test_M1_04_learning_a_conflicting_answer_disputes_and_goes_back_to_the_ai():
    item = lanche("o", "t", "Gigante da vila")
    learnings: dict = {}
    for run, answer in (("x1", BACON), ("x2", BACON), ("x3", FRANGO)):
        apply_answers(
            learnings, run, read_food_m1_04([item], learnings, FakeReader(answer), xray_id=run).answers
        )
    assert learnings[pattern_m1_04(item)].status(3) == "disputado"
    reader = FakeReader(BACON)
    read_food_m1_04([item], learnings, reader, xray_id="x4")
    assert reader.calls == [["Gigante da vila"]]


def test_M1_04_learning_a_founder_correction_wins_over_the_ai():
    own = lanche("o", "t", "Gigante da vila")
    readable = lanche("c", "s1", "Burguer de frango", "Pão, frango")
    learnings: dict = {}
    for run in ("x1", "x2", "x3"):
        apply_answers(
            learnings, run, read_food_m1_04([own], learnings, FakeReader(BACON), xray_id=run).answers
        )
    taught = founder_learnings_m1_04(
        {(own.id, readable.id): (True, "founder")}, {own.id: own, readable.id: readable}, set()
    )
    assert [t.attrs for t in taught] == [attrs_to_json(attrs("Burguer de frango", "Pão, frango"))]
    apply_founders(learnings, taught)
    reader = FakeReader(BACON)
    r = read_food_m1_04([own], learnings, reader, xray_id="x5")
    assert reader.calls == [] and r.overrides[own.id].proteins == frozenset({"frango"})
    assert learnings[pattern_m1_04(own)].status(3) == "fundador"


def test_M1_04_learning_a_founder_rejecting_an_ai_pair_disputes_it():
    own = lanche("o", "t", "Gigante da vila")
    readable = lanche("c", "s1", "X-Bacon da vila")
    taught = founder_learnings_m1_04(
        {(own.id, readable.id): (False, "founder")}, {own.id: own, readable.id: readable}, {own.id}
    )
    learnings = {
        pattern_m1_04(own): Learning(
            pattern_m1_04(own),
            {"x1": attrs_to_json(BACON), "x2": attrs_to_json(BACON), "x3": attrs_to_json(BACON)},
        )
    }
    apply_founders(learnings, taught)
    assert learnings[pattern_m1_04(own)].status(3) == "disputado"


def test_M1_04_no_ai_result_pairs_unless_its_attributes_match():
    own = lanche("o", "t", "Gigante da vila")
    pool = five("Gigante frango", "Pão, frango")
    r = read_food_m1_04([own, *pool], {}, FakeReader(BACON))
    p = pair_item_m1_04(own, pool, Settings(), r.overrides)
    assert accepted(p) == [] and p.status == "exclusivo"
    r = read_food_m1_04([own, *pool], {}, FakeReader(FRANGO))
    assert pair_item_m1_04(own, pool, Settings(), r.overrides).status == "auto"


def test_M1_04_a_rule_reading_is_never_replaced_by_the_ai():
    own = lanche("o", "t", "Dog de bacon")
    r = read_food_m1_04([own], {}, FakeReader(FRANGO))
    assert r.ai_items == 0 and own.id not in r.overrides


# The worker step ---------------------------------------------------------------------------------------


def hood() -> MemoryXrayRepo:
    repo = MemoryXrayRepo()
    repo.xrays["x"] = XrayRun("x", None, "t", None, 3, [], {}, None)
    from margo_collector.xray import StoreRow

    repo.hood["x"] = [StoreRow(f"s{i}", 100, None, True, None) for i in range(5)]
    own = [lanche("o1", "t", "Gigante da vila"), lanche("o2", "t", "Dog de bacon")]
    pool = five("Gigante bacon", "Pão, hambúrguer, bacon") + five("Dog de bacon")
    repo.items = {i.id: i for i in [*own, *pool]}
    return repo


def test_M1_04_without_a_key_the_step_is_the_rules_alone_and_learns_nothing(capsys):
    repo = hood()
    out = pair_step(repo, "x", None)
    rules = build_pairs(
        repo.items_of_stores(["t"]), repo.items_of_stores([f"s{i}" for i in range(5)]), Settings()
    )
    assert repo.pairs["x"] == rules
    assert out["ai_skipped"] is True and out["ai_items"] == 0 and out["ai_model"] is None
    assert repo.learnings == {}
    assert "m1_attr_ai_skipped" in capsys.readouterr().err
    row = next(r for r in repo.pairs["x"] if r.public_menu_item_id == "o1")
    assert (row.pair_status, row.pair_note) == ("revisar", "proteína ilegível")


def test_M1_04_with_a_reader_one_call_logs_count_and_model_and_learns(capsys):
    repo = hood()
    reader = FakeReader(BACON)
    out = pair_step(repo, "x", reader)
    assert len(reader.calls) == 1, "one batched call per X-ray"
    assert out["ai_items"] == 1 and out["ai_model"] == "modelo-de-teste"
    err = capsys.readouterr().err
    assert '"event": "m1_attr_ai_call"' in err and '"items": 1' in err and "modelo-de-teste" in err
    assert repo.learning_models == [("x", "modelo-de-teste", 1)]
    row = next(r for r in repo.pairs["x"] if r.public_menu_item_id == "o1")
    assert row.pair_status == "auto", (
        "the AI read the target's item; the pair forms because the attributes match"
    )


def test_M1_04_attribute_json_round_trip_and_refusals():
    a = attrs("Dog de bacon duplo")
    assert attrs_from_json(attrs_to_json(a), "regra") == a
    assert attrs_from_json({"carnes": 9}) is None
    assert attrs_from_json({"carnes": 1, "peso_g": 5}) is None
    assert attrs_from_json({"base": "foguete", "carnes": 1}).base is None


def test_M1_04_attribute_floor_is_a_param():
    assert Settings.from_xray(3, {"attribute_floor": "0.5"}).attribute_floor == Fraction(1, 2)
    assert Settings().attribute_floor == Fraction(1, 100)


# Default sizes -----------------------------------------------------------------------------------------

from margo_collector.rules import (  # noqa: E402
    SizeDefaults,
    item_beverage_attrs_m1_04,
    presumed_size_m1_04,
    size_defaults_m1_04,
)


def drink(iid: str, store: str, name: str, ml: int | None = None, cents: int = 500) -> Item:
    return Item(iid, store, name, cents, "ml" if ml else "un", ml, section="Bebidas")


TABLE = SizeDefaults(dict(Settings().default_sizes))


def test_M1_04_defaults_water_500_and_lata_350_for_a_known_type_only():
    assert presumed_size_m1_04(drink("a", "t", "Água mineral unidade"), TABLE) == 500
    assert presumed_size_m1_04(drink("a", "t", "Refrigerante de lata"), TABLE) == 350
    assert presumed_size_m1_04(drink("a", "t", "Cerveja lata"), TABLE) == 350
    assert presumed_size_m1_04(drink("a", "t", "Suco lata"), TABLE) is None, (
        "a juice can is not 350 in the data"
    )
    assert presumed_size_m1_04(drink("a", "t", "Gelada da vila"), TABLE) is None, "never an unreadable type"
    assert presumed_size_m1_04(drink("a", "t", "Água com gás copo"), TABLE) is None, (
        "another container says nothing"
    )


def test_M1_04_defaults_an_explicit_size_wins_and_never_a_combo_or_a_quantity():
    assert presumed_size_m1_04(drink("a", "t", "Água mineral 300 ml", 300), TABLE) is None
    assert item_beverage_attrs_m1_04(drink("a", "t", "Água mineral 300 ml", 300), TABLE).size_ml == 300
    assert presumed_size_m1_04(drink("a", "t", "2 águas minerais"), TABLE) is None
    assert presumed_size_m1_04(drink("a", "t", "Água + refrigerante lata"), TABLE) is None


def test_M1_04_defaults_by_brand_and_container_need_a_clear_majority():
    rows = [drink(f"h{i}", f"s{i}", "Heineken long neck 330ml gelada", 330) for i in range(4)]
    rows += [drink("h9", "s9", "Heineken long neck 355ml", 355)]
    d = size_defaults_m1_04(rows, Settings())
    assert d.derived == {("heineken", "long_neck"): 330}, "4 of 5, 80%"
    assert presumed_size_m1_04(drink("x", "t", "Heineken long neck gelada"), d) == 330
    assert presumed_size_m1_04(drink("x", "t", "Corona long neck gelada"), d) is None, (
        "no brand data, no type default"
    )
    split = rows[:3] + [drink(f"k{i}", f"s{i}", "Heineken long neck 355ml", 355) for i in range(2)]
    assert size_defaults_m1_04(split, Settings()).derived == {}, "3 of 5 is no default"
    assert size_defaults_m1_04(rows[:4], Settings()).derived == {}, "fewer than 5 rows"


def test_M1_04_A1_a_default_is_a_size_like_any_other_and_the_note_says_so():
    own = drink("o", "t", "Água Crystal sem gás unidade")
    pool = [drink(f"w{i}", f"s{i}", "Água Crystal natural sem gás 500ml", 500, 450 + i) for i in range(3)]
    pool += [drink("w9", "s9", "Água Crystal sem gás 1,5 litro", 1500, 900)]
    row = build_pairs([own], pool, Settings())[0]
    assert (row.pair_status, row.pair_note, row.size_presumed_ml) == (
        "normalizado",
        "tamanho presumido 500 ml",
        500,
    )
    assert {p.public_menu_item_id for p in row.pairs if p.accepted} == {"w0", "w1", "w2"}, "never the 1.5 l"
    nothing = build_pairs([own], pool, Settings.from_xray(3, {"default_sizes": {}}))[0]
    assert (nothing.pair_status, nothing.pair_note) == ("revisar", "tamanho ilegível"), "the table is a param"


def test_M1_04_a_candidate_that_rests_on_a_default_is_recorded_and_priced_per_100ml():
    from margo_collector.xray import presumed_m1_04

    own = drink("o", "t", "Refrigerante Fanta em lata 350ml", 350, 600)
    pool = [drink("c", "s1", "Fanta em lata", None, 550)]
    row = build_pairs([own], pool, Settings())[0]
    assert row.pair_note == "tamanho presumido 350 ml"
    assert [p.size_presumed_ml for p in row.pairs] == [350]
    calc = calculate([CalcInput("k", own, (presumed_m1_04(pool[0], 350),), None, reviewed=True)])
    assert calc.rows[0].parity_cents == 550


def test_M1_04_a_founder_review_still_wins_over_a_default():
    own = drink("o", "t", "Água mineral unidade")
    pool = [drink(f"w{i}", f"s{i}", "Água mineral natural 500ml", 500) for i in range(2)]
    row = build_pairs([own], pool, Settings(), {("o", "w0"): (False, "founder")})[0]
    assert {p.public_menu_item_id: p.accepted for p in row.pairs} == {"w0": False, "w1": True}


# Every category: pratos, pizza, sushi, sobremesas, adicionais ------------------------------------------------


def prato(iid: str, store: str, name: str, desc: str | None = None, cents: int = 3000) -> Item:
    return Item(iid, store, name, cents, section="Pratos", description=desc)


def doce(iid: str, store: str, name: str, cents: int = 1500) -> Item:
    return Item(iid, store, name, cents, section="Sobremesas")


def extra(iid: str, store: str, name: str, cents: int = 400) -> Item:
    return Item(iid, store, name, cents, section="Adicionais")


def test_M1_04_pizza_flavor_always_and_size_when_both_state_it():
    a = attrs("Pizza calabresa grande", None, "pratos")
    assert (a.base, set(a.proteins), a.portion) == ("pizza", {"calabresa"}, "grande")
    assert compare_food_m1_04(a, attrs("Pizza calabresa com catupiry grande", None, "pratos")) == "conflict"
    assert compare_food_m1_04(a, attrs("Pizza calabresa broto", None, "pratos")) == "conflict"
    assert compare_food_m1_04(a, attrs("Pizza de calabresa", None, "pratos")) == "identical"
    assert attrs("Pizza 4 queijos 35 cm", None, "pratos").portion == "35 cm"
    assert attrs("Pizza mussarela 8 fatias", None, "pratos").portion == "8 fatias"
    from margo_collector.food import unreadable_food_m1_04

    assert unreadable_food_m1_04(attrs("Pizza grande", None, "pratos"), "pratos") == "sabor ilegível"


def test_M1_04_sushi_pieces_must_match_when_both_state_them():
    a = attrs("Combinado da vila 20 peças", None, "pratos")
    assert (a.base, a.pieces) == ("sushi", 20)
    assert compare_food_m1_04(a, attrs("Combinado salmão 30 peças", None, "pratos")) == "conflict"
    assert compare_food_m1_04(a, attrs("Combinado sortido 20 peças", None, "pratos")) == "identical"


def test_M1_04_pratos_by_base_protein_and_portion():
    m = attrs("Marmitex média de frango", None, "pratos")
    assert (m.base, set(m.proteins), m.portion) == ("marmita", {"frango"}, "media")
    assert compare_food_m1_04(m, attrs("Marmitex grande de frango", None, "pratos")) == "conflict"
    assert compare_food_m1_04(m, attrs("Marmita de frango média", None, "pratos")) == "identical"
    assert compare_food_m1_04(attrs("Strogonoff de frango", None, "pratos"), attrs("Strogonoff de carne", None, "pratos")) == "conflict"
    assert attrs("Executivo da vila", "Arroz, feijão e filé de frango grelhado", "pratos").proteins == frozenset({"frango"})


def test_M1_04_sobremesas_by_type_flavor_and_size():
    s = attrs("Sundae de morango", None, "sobremesas")
    assert (s.base, set(s.flavors)) == ("sundae", {"morango"})
    assert compare_food_m1_04(s, attrs("Sundae de chocolate quente", None, "sobremesas")) == "conflict"
    assert compare_food_m1_04(attrs("Sundae", None, "sobremesas"), s) == "identical", "one side silent"
    assert compare_food_m1_04(attrs("Açaí 300 ml", None, "sobremesas"), attrs("Açaí 500 ml", None, "sobremesas")) == "conflict"
    assert compare_food_m1_04(attrs("Brownie da vila", None, "sobremesas"), attrs("Pudim", None, "sobremesas")) == "conflict"


def test_M1_04_adicionais_by_what_it_is_and_quantity():
    assert attrs("Adicional de bacon em cubos", None, "adicionais").base == "bacon"
    assert compare_food_m1_04(attrs("Molho especial", None, "adicionais"), attrs("Maionese especial", None, "adicionais")) == "conflict"
    assert compare_food_m1_04(attrs("Ad bacon crocante", None, "adicionais"), attrs("Bacon extra", None, "adicionais")) == "identical"
    assert compare_food_m1_04(attrs("Pote maionese 30 ml", None, "adicionais"), attrs("Pote maionese 50 ml", None, "adicionais")) == "conflict"


def test_M1_04_every_category_pairs_by_attributes_and_can_be_exclusive():
    own = doce("o", "t", "Sundae de morango")
    pool = [doce(f"a{i}", f"s{i}", "Sundae com morango") for i in range(5)] + [doce("c", "s9", "Sundae com chocolate")]
    p = pair_item_m1_04(own, pool, Settings())
    assert p.status == "auto" and "Sundae com chocolate" not in accepted(p)
    alone = pair_item_m1_04(prato("o", "t", "Pizza da vila de figo"), [prato("x", "s1", "Pizza calabresa")], Settings())
    assert alone.status == "revisar" and alone.note == "sabor ilegível", "an unknown flavor is unreadable, not exclusive"
    piece = pair_item_m1_04(extra("o", "t", "Adicional de catupiry"), [extra("x", "s1", "Adicional de bacon em cubos")], Settings())
    assert (piece.status, piece.note) == ("exclusivo", EXCLUSIVE_NOTE)


# A prato's base: the section, and both sides must say it (Marlon, 08/nov, D72). All names are SINTÉTICO. -------------


def _prato(item_id: str, store: str, name: str, cents: int, section: str | None = None) -> Item:
    return Item(id=item_id, store_id=store, name=name, price_cents=cents, section=section)


def test_M1_04_prato_base_comes_from_the_section_when_the_name_says_none():
    a = food_attrs_m1_04("Frango", None, "pratos", section="Espetos")
    assert a.base == "espeto"
    assert a.proteins == frozenset({"frango"})


def test_M1_04_prato_a_cut_in_a_skewer_section_is_a_skewer():
    assert food_attrs_m1_04("Medalhão de frango", None, "pratos", section="Espetos").base == "espeto"


def test_M1_04_prato_the_name_still_decides_over_the_section():
    assert food_attrs_m1_04("Strogonoff de frango", None, "pratos", section="Espetos").base == "strogonoff"
    assert food_attrs_m1_04("Filé de frango", None, "pratos", section="Pratos do dia").base == "grelhado"


def test_M1_04_only_pratos_read_the_section_for_the_base():
    assert food_attrs_m1_04("Frango", None, "porcoes", section="Espetos").base is None


def test_M1_04_prato_with_no_base_on_one_side_does_not_pair():
    a = food_attrs_m1_04("Frango", None, "pratos", section="Espetos")
    b = food_attrs_m1_04("Bowl frango xadrez", None, "pratos")
    assert b.base is None
    assert compare_food_m1_04(a, b, base_required=True) == "unreadable"
    assert compare_food_m1_04(a, a, base_required=True) == "identical"


def test_M1_04_prato_skewer_is_not_compared_with_full_plates():
    own = _prato("own", "T", "Frango", 1590, "Espetos")
    pool = [
        _prato(f"s{i}", f"S{i}", name, 5000 + i, section)
        for i, (name, section) in enumerate(
            [
                ("Strogonoff de frango", "Pratos"),
                ("Yakisoba de frango", "Pratos"),
                ("Bowl frango xadrez", "Delícias"),
                ("Frango à cubana", "Novidades"),
                ("Filé de frango", "Pratos"),
                ("Fricassé de frango", "Pratos com frango"),
            ]
        )
    ]
    paired = pair_item_m1_04(own, pool, Settings())
    assert paired.status == "exclusivo"
    assert not [c for c in paired.candidates if c.accepted]


def test_M1_04_pratos_with_no_base_pair_only_with_close_names():
    own = _prato("own", "T", "Frango ao molho", 1590, "Pratos")
    other = [_prato(f"s{i}", f"S{i}", "Bowl frango xadrez", 4000, "Pratos") for i in range(5)]
    assert pair_item_m1_04(own, other, Settings()).status == "exclusivo"
    same = [_prato(f"s{i}", f"S{i}", "Frango ao molho", 2000, "Pratos") for i in range(5)]
    assert pair_item_m1_04(own, same, Settings()).status == "auto"


def test_M1_04_prato_skewers_still_pair_with_skewers():
    own = _prato("own", "T", "Frango", 1590, "Espetos")
    pool = [_prato(f"s{i}", f"S{i}", "Espeto de frango", 1600 + i, "Pratos") for i in range(5)]
    paired = pair_item_m1_04(own, pool, Settings())
    assert paired.status == "auto"
    assert len([c for c in paired.candidates if c.accepted]) == 5


def test_M1_04_a_lanche_with_no_base_on_one_side_keeps_pairing():
    a = food_attrs_m1_04("Especial da vila de frango", None, "lanches")
    b = food_attrs_m1_04("Burger de frango", None, "lanches")
    assert a.base is None
    assert compare_food_m1_04(a, b) == "identical"


# A count on one side only is a different scale; porções follow the same base rule (Marlon, 08/nov, D72). SINTÉTICO.


def test_M1_03_an_item_with_a_count_never_pairs_with_one_without():
    own = Item(id="own", store_id="T", name="Sashimi de peixe (15 unid.)", price_cents=4290, unit_qty=15, section="Porções")
    whole = [Item(id=f"s{i}", store_id=f"S{i}", name="Sashimi de peixe", price_cents=6000, section="Porções") for i in range(5)]
    assert pair_item_m1_04(own, whole, Settings()).status == "exclusivo"
    counted = [
        Item(id=f"c{i}", store_id=f"C{i}", name="Sashimi de peixe (10 unid.)", price_cents=4000, unit_qty=10, section="Porções")
        for i in range(5)
    ]
    assert pair_item_m1_04(own, counted, Settings()).status == "normalizado"


def test_M1_04_porcao_with_a_base_never_pairs_with_one_without():
    own = Item(id="own", store_id="T", name="Sashimi de peixe", price_cents=4290, section="Porções")
    iscas = [Item(id=f"s{i}", store_id=f"S{i}", name="Isca de peixe", price_cents=3000, section="Porções") for i in range(5)]
    assert pair_item_m1_04(own, iscas, Settings()).status == "exclusivo"

