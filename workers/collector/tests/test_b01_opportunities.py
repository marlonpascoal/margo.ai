"""B01 P23 "Oportunidades" (Marlon, 08/nov): the run's facts for the AI, and the deterministic check that keeps only
opportunities whose numbers exist in the facts, with no profit words and no long dash. The writer is a fake: no test
calls the API or replays an invented answer (D40); recorded answers in fixtures/anthropic are replayed when present.
All items are SINTÉTICO."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from margo_collector import opportunities
from margo_collector.opportunities import (
    PROMPT_VERSION,
    ClaudeOpportunityWriter,
    brl,
    build_facts,
    build_request,
    check_all,
    check_opportunity,
    numbers_ok,
    opportunities_step,
    parse_response,
)
from margo_collector.record_opportunities import POSITIONS, RESULT

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
    }
    lanches = p["categorias"][0]
    assert lanches["grupo"] == "Lanches" and lanches["pode_subir"] == 2 and lanches["comparados"] == 3
    assert lanches["diferenca_por_venda_dos_que_podem_subir"] == "R$ 9,00"
    assert lanches["posicao_na_categoria"] == 3 and lanches["lojas_na_categoria"] == 9
    assert p["posicao_da_loja"] == 4 and p["lojas_no_ranking"] == 12
    assert p["itens_so_seus"] == 2 and p["itens_alinhados_pct"] == 50 and p["faixa_da_media_pct"] == 10
    assert facts.item_ids == {i["item_id"] for i in RESULT["items"]}
    assert Decimal("24") in facts.money and Decimal("17") in facts.percents and Decimal("400") in facts.plain


def test_B01_opportunities_request_sends_the_facts_and_no_store_name(facts):
    req = build_request(facts, "m")
    body = json.loads(req["messages"][0]["content"])
    assert body == {"fatos": facts.prompt}
    assert "nome_da_loja" not in json.dumps(body) and "store_name" not in json.dumps(body)
    assert "—" not in req["system"], "no long dash in product text, the prompt included"
    for word in ("lucro", "margem", "ganho"):
        assert word in req["system"], "the prompt forbids it by name"


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


class Block:
    def __init__(self, text: str) -> None:
        self.type, self.text = "text", text


class Resp:
    def __init__(self, text: str, stop: str = "end_turn") -> None:
        self.stop_reason, self.content = stop, [Block(text)]


def test_B01_opportunities_parse_refusal_or_cut_answer_is_empty():
    assert parse_response(Resp('{"oportunidades": [{"title": "a"}]}', "max_tokens")) == []
    assert parse_response(Resp("não é json")) == []
    assert parse_response(Resp('{"oportunidades": [{"title": "a"}]}')) == [{"title": "a"}]


def test_B01_opportunities_model_is_a_parameter_and_the_key_is_read_by_name(monkeypatch):
    assert ClaudeOpportunityWriter(client=object()).model == opportunities.DEFAULT_MODEL
    monkeypatch.setenv("MARGO_OPPORTUNITIES_MODEL", "outro-modelo")
    assert ClaudeOpportunityWriter(client=object()).model == "outro-modelo"
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        ClaudeOpportunityWriter()
    assert opportunities.writer_from_env() is None


class FakeClient:
    """Says what the test asks; never a recorded model answer."""

    def __init__(self, answer: list[dict[str, Any]]) -> None:
        self.answer, self.requests = answer, []

    @property
    def messages(self):
        return self

    def create(self, **kw):
        self.requests.append(kw)
        return Resp(json.dumps({"oportunidades": self.answer}, ensure_ascii=False))


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
    writer = ClaudeOpportunityWriter(client=client, model="modelo-de-teste")
    repo = MemoryRepo()
    assert opportunities_step(repo, "x1", writer) == {"kept": 1, "dropped": 1}
    row = repo.rows["x1"]
    assert row["pv"] == PROMPT_VERSION and row["model"] == "modelo-de-teste" and row["dropped"] == 1
    assert row["facts_hash"] == build_facts(RESULT, POSITIONS).hash()
    assert opportunities_step(repo, "x1", writer) == {"skipped": "exists"}
    assert len(client.requests) == 1, "one call per run"


def test_B01_opportunities_step_with_none_valid_keeps_an_empty_row():
    repo = MemoryRepo()
    writer = ClaudeOpportunityWriter(client=FakeClient([op("Suba para R$ 31,00", "x")]), model="m")
    assert opportunities_step(repo, "x1", writer) == {"kept": 0, "dropped": 1}
    assert repo.rows["x1"]["items"] == []


def test_B01_opportunities_step_without_key_logs_and_writes_nothing(capsys):
    repo = MemoryRepo()
    assert opportunities_step(repo, "x1", None) == {"skipped": "no_api_key"}
    assert repo.rows == {}
    assert '"event": "skipped_no_key"' in capsys.readouterr().err


def test_B01_opportunities_step_skips_competitor_and_unready_runs():
    writer = ClaudeOpportunityWriter(client=FakeClient([]), model="m")
    for result in (dict(RESULT, target_kind="competitor"), dict(RESULT, status="pairing")):
        repo = MemoryRepo(result)
        assert opportunities_step(repo, "x1", writer) == {"skipped": "not_ready"}
        assert repo.rows == {}


@pytest.mark.parametrize("path", sorted((ROOT / "fixtures" / "anthropic").glob("opportunities-*.json")) or [None])
def test_B01_opportunities_recorded_answers_parse_and_check(path):
    """Replays every answer Marlon recorded (`uv run record-anthropic-opportunities`); none yet means nothing to replay."""
    if path is None:
        pytest.skip("no opportunities recording yet: fixtures/anthropic/README.md")
    rec = json.loads(path.read_text())

    class R:
        stop_reason = rec["response"]["stop_reason"]
        content = [Block(b.get("text", "")) for b in rec["response"]["content"] if b.get("type") == "text"]

    kept, dropped = check_all(parse_response(R()), build_facts(RESULT, POSITIONS))
    assert len(kept) + dropped == len(parse_response(R()))
