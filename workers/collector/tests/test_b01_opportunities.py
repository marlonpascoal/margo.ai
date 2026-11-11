"""B01 P23 "Oportunidades" (Marlon, 08/nov): the run's facts for the AI, and the deterministic check that keeps only
opportunities whose numbers exist in the facts, with no profit words and no long dash. The writer is a fake: no test
calls the API or replays an invented answer (D40); recorded answers in fixtures/ai are replayed when present.
All items are SINTÉTICO."""

from __future__ import annotations

import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from margo_collector import opportunities
from margo_collector.opportunities import (
    PROMPT_VERSION,
    AiOpportunityWriter,
    brl,
    build_facts,
    build_request,
    check_all,
    check_opportunity,
    numbers_ok,
    opportunities_step,
    parse_response,
)
from margo_collector.opportunity_eval import SCENARIOS
from margo_collector.record_opportunities import POSITIONS, RESULT
from margo_common import llm

ROOT = Path(__file__).resolve().parents[3]
BURGER = "00000000-0000-4000-8000-000000000001"
SALADA = "00000000-0000-4000-8000-000000000002"
BATATA = "00000000-0000-4000-8000-000000000004"


@pytest.fixture
def facts():
    return build_facts(RESULT, POSITIONS)


def op(title: str, why: str, ids: list[str] | None = None, lever: str = "subir_preco") -> dict[str, Any]:
    return {"title": title, "why": why, "item_ids": [BURGER] if ids is None else ids, "lever": lever}


# Facts ---------------------------------------------------------------------------------------------------------------


def test_B01_opportunities_brl_formats_centavos_as_reais():
    assert brl(3200) == "R$ 32,00"
    assert brl(149000) == "R$ 1.490,00"
    assert brl(5) == "R$ 0,05"


def test_B01_opportunities_facts_per_item_category_and_store(facts):
    p = facts.prompt
    burger = next(i for i in p["itens"] if i["id"] == BURGER)
    assert burger == {
        "id": BURGER,
        "nome": "X-Burger Sintético",
        "grupo": "Lanches",
        "seu_preco": "R$ 24,00",
        "meio_da_vizinhanca": "R$ 29,00",
        "vizinhos_de": "R$ 25,00",
        "vizinhos_ate": "R$ 34,00",
        "diferenca_pct": -17,
        "em_relacao_ao_meio": "abaixo",
        "diferenca_para_o_meio": "R$ 5,00",
        "leitura": "pode_subir",
        "lojas": 9,
        "comparacao": "firme",
        "tamanho_da_diferenca": "moderada",
        "papel_na_categoria": "porta_de_entrada",
        "preco_para_testar": "R$ 25,90",
        "aumento_do_teste_pct": 8,
    }
    bacon = next(i for i in p["itens"] if i["nome"] == "X-Bacon Sintético")
    assert "preco_para_testar" not in bacon and bacon["papel_na_categoria"] == "referencia"
    lanches = p["categorias"][0]
    assert lanches["seu_menor_preco"] == "R$ 24,00" and lanches["seu_maior_preco"] == "R$ 32,00"
    assert lanches["grupo"] == "Lanches" and lanches["pode_subir"] == 2 and lanches["comparados"] == 3
    assert lanches["diferenca_por_venda_dos_que_podem_subir"] == "R$ 9,00"
    assert lanches["posicao_na_categoria"] == 3 and lanches["lojas_na_categoria"] == 9
    assert p["posicao_da_loja"] == 4 and p["lojas_no_ranking"] == 12
    assert p["itens_so_seus"] == 2 and p["itens_alinhados_pct"] == 50 and p["faixa_da_media_pct"] == 10
    assert facts.item_ids == {i["item_id"] for i in RESULT["items"]}
    assert Decimal("24") in facts.money and Decimal("17") in facts.percents and Decimal("400") in facts.plain


def test_B01_opportunities_comparison_strength_marks_few_stores_and_spread_prices():
    """Marlon, 08/nov: outliers or different portions make a comparison diverge; the AI says so, and still reads the
    face price. Few stores (below the M1-04 min_pairs default) wins over spread."""
    assert opportunities.comparison_strength(9, 2500, 3400) == "firme"
    assert opportunities.comparison_strength(1, 4299, 4299) == "poucas_lojas"
    assert opportunities.comparison_strength(4, 2000, 9000) == "poucas_lojas"
    assert opportunities.comparison_strength(6, 3000, 6000) == "precos_espalhados"
    assert opportunities.comparison_strength(6, 3000, 5999) == "firme"
    assert opportunities.comparison_strength(None, None, None) == "poucas_lojas"


def test_B01_opportunities_prompt_v3_keeps_the_caveat_and_adds_the_specialist_rules():
    assert PROMPT_VERSION == "oportunidades.v4"
    for words in ("poucas_lojas", "precos_espalhados", "preço de face", "mais lojas comparadas"):
        assert words in opportunities.SYSTEM, "v2 caveat kept (Marlon, 08/nov)"
    for words in (
        "tamanho_da_diferenca", "papel_na_categoria", "preco_para_testar", "um item por vez",
        "primeiro passo", "porta_de_entrada", "bebidas e adicionais", "mais forte", "só o custo diz se compensa",
    ):
        assert words in opportunities.SYSTEM
    assert set(re.findall(r"\d+(?:,\d+)?", opportunities.SYSTEM)) <= {"90", "3", "5", "70", "2", "32,00", "12"}, (
        "only the format examples and the limits: no sample price, step or deadline the model could copy"
    )


# Deterministic facts for the recommendations --------------------------------------------------------------------------


def test_B01_opportunities_gap_size_against_the_band():
    assert opportunities.gap_size(-0.05, 0.1) == "pequena"
    assert opportunities.gap_size(-0.1, 0.1) == "moderada"
    assert opportunities.gap_size(0.1125, 0.1) == "moderada"
    assert opportunities.gap_size(0.2, 0.1) == "grande"
    assert opportunities.gap_size(-0.33, 0.1) == "grande"
    assert opportunities.gap_size(None, 0.1) is None


def test_B01_opportunities_charm_price_at_or_below():
    assert opportunities.charm_at_or_below(2640) == 2590
    assert opportunities.charm_at_or_below(2990) == 2990
    assert opportunities.charm_at_or_below(2999) == 2990
    assert opportunities.charm_at_or_below(3000) == 2990
    assert opportunities.charm_at_or_below(440) == 390


def test_B01_opportunities_first_test_price_is_one_step_capped_by_the_band_and_the_middle():
    """M1-07 band caps the step; the parity caps it too; the ",90" point at or below wins when above the own price."""
    assert opportunities.first_test_price(2400, 2900, 0.1) == 2590, "cap R$ 26,40, charm R$ 25,90"
    assert opportunities.first_test_price(5500, 8200, 0.1) == 5990, "a large gap still moves one step"
    assert opportunities.first_test_price(400, 450, 0.1) == 440, "no ,90 above the own price: the cap itself"
    assert opportunities.first_test_price(2600, 2650, 0.1) == 2650, "the middle caps the step"
    assert opportunities.first_test_price(2600, 2600, 0.1) is None
    assert opportunities.first_test_price(None, 2900, 0.1) is None
    assert opportunities.first_test_price(2990, 3200, 0.1) == 3190, "the ,90 point under the middle"


def test_B01_opportunities_category_role_in_the_own_ladder():
    assert opportunities.category_role(2400, [2400]) == "unico"
    assert opportunities.category_role(2400, [2400, 2600, 3200]) == "porta_de_entrada"
    assert opportunities.category_role(3200, [2400, 2600, 3200]) == "referencia"
    assert opportunities.category_role(2600, [2400, 2600, 3200]) == "no_meio"
    assert opportunities.category_role(890, [890, 890]) == "no_meio"
    assert opportunities.category_role(None, [890]) is None


def test_B01_opportunities_check_accepts_the_test_price_and_step(facts):
    kept = check_opportunity(
        op("Teste R$ 25,90 no X-Burger Sintético", "Está 17% abaixo do meio de R$ 29,00. Subir 8% é um primeiro passo e pode vender menos."),
        facts,
    )
    assert kept is not None
    assert not numbers_ok("Teste R$ 26,90", facts), "a price the facts do not carry is still dropped"


def test_B01_opportunities_request_sends_the_facts_and_no_store_name(facts):
    req = build_request(facts, "m")
    body = llm.request_payload("openai", req)
    assert body == {"fatos": facts.prompt}
    assert "nome_da_loja" not in json.dumps(body) and "store_name" not in json.dumps(body)
    system = req["input"][0]["content"]
    assert "—" not in system, "no long dash in product text, the prompt included"
    for word in ("lucro", "margem", "ganho"):
        assert word in system, "the prompt forbids it by name"
    assert req["text"]["format"] == {"type": "json_schema", "name": "oportunidades", "schema": opportunities.OUTPUT_SCHEMA, "strict": True}


def test_B01_opportunities_facts_hash_is_stable(facts):
    assert facts.hash() == build_facts(RESULT, POSITIONS).hash()
    other = dict(RESULT, radius_km=4)
    assert build_facts(other, POSITIONS).hash() != facts.hash()


# The check -----------------------------------------------------------------------------------------------------------


def test_B01_opportunities_check_accepts_numbers_from_the_facts(facts):
    assert numbers_ok("Suba para R$ 29,00, o meio da vizinhança", facts)
    assert numbers_ok("Está 17% abaixo do meio, em 9 lojas", facts)
    assert numbers_ok("R$ 5,00 de diferença por venda; 4º de 12 lojas", facts)
    assert numbers_ok("Batata Frita Sintética 400 g está acima", facts), "numbers in item names count"
    kept = check_opportunity(op("X-Burger a R$ 24,00", "O meio é R$ 29,00, 17% acima. Subir pode vender menos."), facts)
    assert kept == {
        "title": "X-Burger a R$ 24,00",
        "why": "O meio é R$ 29,00, 17% acima. Subir pode vender menos.",
        "item_ids": [BURGER],
        "lever": "subir_preco",
    }


def test_B01_opportunities_check_rejects_an_invented_number(facts):
    assert not numbers_ok("Suba para R$ 31,00", facts)
    assert not numbers_ok("Está 23% abaixo", facts)
    assert not numbers_ok("Venda 777 por semana", facts)
    assert not numbers_ok("Suba R$ 17,00", facts), "17 is a percent in the facts, never money"
    assert check_opportunity(op("Suba para R$ 31,00", "Fica perto do meio."), facts) is None


def test_B01_opportunities_count_of_cited_items_is_allowed(facts):
    two = op("Lanches abaixo do meio", "Estes 2 itens estão abaixo.", [BURGER, SALADA])
    assert check_opportunity(two, facts) is not None
    three = op("Lanches abaixo do meio", "Estes 3 itens estão abaixo.", [BURGER, SALADA])
    assert check_opportunity(three, facts) is not None, "3 is a count in the facts"
    many = op("Lanches abaixo do meio", "Estes 21 itens estão abaixo.", [BURGER, SALADA])
    assert check_opportunity(many, facts) is None


@pytest.mark.parametrize("word", ["lucro", "Lucro", "MARGEM", "margens", "ganho", "ganhar", "profit"])
def test_B01_opportunities_check_rejects_profit_words(facts, word):
    assert check_opportunity(op(f"Mais {word} no X-Burger", "Subir pode vender menos."), facts) is None
    assert check_opportunity(op("X-Burger abaixo do meio", f"Mais {word} por venda."), facts) is None


def test_B01_opportunities_check_rejects_the_long_dash(facts):
    assert check_opportunity(op("X-Burger — abaixo do meio", "Subir pode vender menos."), facts) is None
    assert check_opportunity(op("X-Burger abaixo do meio", "Subir pode vender menos, sim."), facts) is not None


def test_B01_opportunities_check_items_and_lever(facts):
    assert check_opportunity(op("X", "Y", ["00000000-0000-4000-8000-999999999999"]), facts) is None
    assert check_opportunity(op("X", "Y", lever="baixar_preco"), facts) is None
    assert check_opportunity(op("", "Y"), facts) is None
    assert check_opportunity("texto", facts) is None
    assert check_opportunity(op("X", "Y", [BURGER, BURGER]), facts)["item_ids"] == [BURGER]
    assert check_opportunity(op("Acompanhe a categoria", "Volte no próximo raio-X.", [], "acompanhar"), facts) is not None


def test_B01_opportunities_keep_order_count_dropped_and_cap_at_five(facts):
    good = [op(f"Oportunidade {n}", "Subir pode vender menos.", [BURGER]) for n in (1, 2, 3, 4, 5, 6)]
    bad = op("Mais lucro", "Ganho certo.")
    kept, dropped = check_all([good[0], bad, *good[1:]], facts)
    assert [k["title"] for k in kept] == [f"Oportunidade {n}" for n in (1, 2, 3, 4, 5)]
    assert dropped == 2


# Response and writer -------------------------------------------------------------------------------------------------


def openai_resp(text: str, status: str = "completed", part: str = "output_text") -> dict[str, Any]:
    key = "refusal" if part == "refusal" else "text"
    return {"status": status, "output": [{"type": "message", "content": [{"type": part, key: text}]}]}


class Block:
    def __init__(self, text: str) -> None:
        self.type, self.text = "text", text


class Resp:
    """An Anthropic Messages response (the other provider, D70)."""

    def __init__(self, text: str, stop: str = "end_turn") -> None:
        self.stop_reason, self.content = stop, [Block(text)]


def test_B01_D70_opportunities_parse_refusal_or_cut_answer_is_empty():
    ok = '{"oportunidades": [{"title": "a"}]}'
    assert parse_response(openai_resp(ok, "incomplete")) == []
    assert parse_response(openai_resp("não posso", part="refusal")) == []
    assert parse_response(openai_resp("não é json")) == []
    assert parse_response(openai_resp(ok)) == [{"title": "a"}]
    assert parse_response(Resp(ok, "max_tokens"), "anthropic") == []
    assert parse_response(Resp(ok), "anthropic") == [{"title": "a"}]


def test_B01_D70_opportunities_model_is_a_parameter_and_the_key_is_read_by_name(monkeypatch):
    monkeypatch.delenv("MARGO_AI_PROVIDER", raising=False)
    monkeypatch.delenv("MARGO_OPPORTUNITIES_MODEL", raising=False)
    assert AiOpportunityWriter(client=object()).model == llm.DEFAULT_MODELS["openai"]
    monkeypatch.setenv("MARGO_OPPORTUNITIES_MODEL", "outro-modelo")
    assert AiOpportunityWriter(client=object()).model == "outro-modelo"
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        AiOpportunityWriter()
    assert opportunities.writer_from_env() is None


class FakeClient:
    """Says what the test asks, in the OpenAI Responses shape; never a recorded model answer."""

    def __init__(self, answer: list[dict[str, Any]]) -> None:
        self.answer, self.requests = answer, []

    @property
    def responses(self):
        return self

    def create(self, **kw):
        self.requests.append(kw)
        return openai_resp(json.dumps({"oportunidades": self.answer}, ensure_ascii=False))


class MemoryRepo:
    def __init__(self, result: dict[str, Any] | None = None) -> None:
        self.result = result if result is not None else RESULT
        self.rows: dict[str, dict[str, Any]] = {}

    def has_opportunities(self, xray_id):
        return xray_id in self.rows

    def opportunity_inputs(self, xray_id):
        return self.result, POSITIONS

    def save_opportunities(self, xray_id, items, facts_hash, model, prompt_version, dropped):
        self.rows[xray_id] = {"items": items, "facts_hash": facts_hash, "model": model, "pv": prompt_version, "dropped": dropped}


def test_B01_opportunities_step_saves_the_valid_ones_once():
    client = FakeClient([op("X-Burger abaixo do meio", "Está 17% abaixo."), op("Mais lucro", "x")])
    writer = AiOpportunityWriter(client=client, model="modelo-de-teste", provider="openai")
    repo = MemoryRepo()
    assert opportunities_step(repo, "x1", writer) == {"kept": 1, "dropped": 1}
    row = repo.rows["x1"]
    assert row["pv"] == PROMPT_VERSION and row["model"] == "modelo-de-teste" and row["dropped"] == 1
    assert row["facts_hash"] == build_facts(RESULT, POSITIONS).hash()
    assert opportunities_step(repo, "x1", writer) == {"skipped": "exists"}
    assert len(client.requests) == 1, "one call per run"


def test_B01_opportunities_step_with_none_valid_keeps_an_empty_row():
    repo = MemoryRepo()
    writer = AiOpportunityWriter(client=FakeClient([op("Suba para R$ 31,00", "x")]), model="m", provider="openai")
    assert opportunities_step(repo, "x1", writer) == {"kept": 0, "dropped": 1}
    assert repo.rows["x1"]["items"] == []


def test_B01_opportunities_step_without_key_logs_and_writes_nothing(capsys):
    repo = MemoryRepo()
    assert opportunities_step(repo, "x1", None) == {"skipped": "no_api_key"}
    assert repo.rows == {}
    assert '"event": "skipped_no_key"' in capsys.readouterr().err


def test_B01_opportunities_step_skips_competitor_and_unready_runs():
    writer = AiOpportunityWriter(client=FakeClient([]), model="m", provider="openai")
    for result in (dict(RESULT, target_kind="competitor"), dict(RESULT, status="pairing")):
        repo = MemoryRepo(result)
        assert opportunities_step(repo, "x1", writer) == {"skipped": "not_ready"}
        assert repo.rows == {}


@pytest.mark.parametrize("path", sorted((ROOT / "fixtures" / "ai").glob("opportunities-*.json")) or [None])
def test_B01_D70_opportunities_recorded_answers_parse_and_check(path):
    """Replays every answer Marlon recorded (`uv run record-ai-opportunities`); none yet means nothing to replay."""
    if path is None:
        pytest.skip("no opportunities recording yet: fixtures/ai/README.md")
    rec = json.loads(path.read_text())
    raw = parse_response(rec["response"], rec["provider"])
    result, positions = SCENARIOS[rec.get("scenario") or "base"]
    kept, dropped = check_all(raw, build_facts(result, positions))
    assert len(kept) + dropped == len(raw)


def test_D83_facts_carry_the_menu_weight_ranges_combos_and_dishes_with_no_competitor():
    result = {
        "items": [],
        "menu": [
            {"item_id": "c", "name": "Combo Sintético", "section": "Combos", "price_cents": 8000, "kind": "combo", "reason": None, "most_ordered": True},
            {"item_id": "h", "name": "Burger Sintético", "section": "Lanches", "price_cents": 4000, "kind": "sem", "reason": "hambúrguer artesanal", "most_ordered": False},
            {"item_id": "d", "name": "Dog Sintético", "section": "Lanches", "price_cents": 3000, "kind": "faixa", "reason": "cachorro-quente", "most_ordered": False},
        ],
        "ranges": [
            {"item_id": "c", "name": "Combo Sintético", "own_cents": 8000, "combo_solo_cents": 10000, "low_cents": None, "high_cents": None},
            {"item_id": "d", "name": "Dog Sintético", "own_cents": 3000, "combo_solo_cents": None, "low_cents": 2400, "high_cents": 2800,
             "stores": 9, "position": "acima", "basis": "cachorro-quente"},
            {"item_id": "h", "name": "Burger Sintético", "own_cents": 4000, "combo_solo_cents": None, "low_cents": None, "high_cents": None,
             "basis": "hambúrguer artesanal"},
        ],
    }
    p = opportunities.build_facts(result, None).prompt
    assert [w["secao"] for w in p["peso_do_cardapio"]] == ["Combos", "Lanches"]
    assert p["mais_pedidos"][0]["como_foi_lido"] == "combo"
    assert p["combos"][0]["desconto_pct"] == 20
    assert p["faixas"][0]["posicao"] == "acima"
    assert p["sem_concorrente"] == [{"nome": "Burger Sintético", "tipo": "hambúrguer artesanal"}]


def test_D83_the_prompt_speaks_of_positioning_never_of_cheap():
    assert "nunca use as palavras barato" in opportunities.SYSTEM
    assert "mais_barato" not in opportunities.SYSTEM
