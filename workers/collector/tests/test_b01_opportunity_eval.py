"""B01 P23 "Oportunidades" offline evaluation (D68, D70): the SINTÉTICO scenarios the recorder sends, the deterministic
scorer for recorded answers, and the recorder's arguments. No test calls an API: the writer is a fake client that says
what the test asks, never a recorded model answer."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import pytest
from margo_collector import opportunity_eval, record_opportunities
from margo_collector.opportunities import AiOpportunityWriter, build_facts
from margo_collector.opportunity_eval import SCENARIOS, score_answer, score_recording

BURGER = "00000000-0000-4000-8000-000000000001"
SALADA = "00000000-0000-4000-8000-000000000002"
BATATA = "00000000-0000-4000-8000-000000000004"
BACON = "00000000-0000-4000-8000-000000000003"


def op(title: str, why: str, ids: list[str], lever: str) -> dict[str, Any]:
    return {"title": title, "why": why, "item_ids": ids, "lever": lever}


GOOD = [
    op("Teste R$ 25,90 no X-Burger Sintético", "Está 17% abaixo do meio de R$ 29,00. É um primeiro passo de 8% e pode vender menos.", [BURGER], "subir_preco"),
    op("Confira o custo da Batata Frita Sintética 400 g", "Está 22% acima do meio de R$ 32,00. Baixar pode vender mais, mas só o custo diz se compensa.", [BATATA], "rever_custo"),
    op("Mantenha o X-Bacon Sintético", "Está no meio da vizinhança. Não mexa agora.", [BACON], "manter"),
]


@pytest.fixture
def base_facts():
    return build_facts(*SCENARIOS["base"])


# Scenarios -----------------------------------------------------------------------------------------------------------


def test_B01_opportunity_eval_base_is_the_recorded_run():
    assert record_opportunities.RESULT is SCENARIOS["base"][0]
    assert record_opportunities.POSITIONS is SCENARIOS["base"][1]


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_B01_opportunity_eval_scenarios_are_consistent_and_synthetic(name):
    result, positions = SCENARIOS[name]
    items = result["items"]
    assert result["status"] == "ready" and result["target_kind"] == "own"
    assert all("Sintétic" in it["name"] for it in items), "SINTÉTICO names only"
    assert "—" not in json.dumps(result, ensure_ascii=False)
    assert len({it["item_id"] for it in items}) == len(items)
    for it in items:
        gap = it["gap_pct"]
        expected = "nao_mexer" if gap >= 0.1 else ("pode_subir" if gap <= -0.1 else "na_media")
        assert it["reading"] == expected, f"M1-07 reading of {it['name']}"
    assert result["below"] == sum(it["reading"] == "pode_subir" for it in items)
    assert result["above"] == sum(it["reading"] == "nao_mexer" for it in items)
    assert sum(c["items_compared"] for c in result["by_category"]) == result["items_analyzed"] == len(items)
    facts = build_facts(result, positions)
    assert 3 <= len(facts.prompt["itens"]) <= 80


def test_B01_opportunity_eval_scenarios_cover_the_shapes():
    def strengths(name: str) -> set[str]:
        return {i["comparacao"] for i in build_facts(*SCENARIOS[name]).prompt["itens"]}

    many = SCENARIOS["muitos_pode_subir"][0]
    assert many["below"] > many["items_analyzed"] / 2
    most = SCENARIOS["maioria_nao_mexer"][0]
    assert most["above"] > most["items_analyzed"] / 2
    assert strengths("poucas_lojas") == {"poucas_lojas"}
    assert "precos_espalhados" in strengths("porcao_espalhada")
    drinks = build_facts(*SCENARIOS["bebidas_pouco_acima"]).prompt["itens"]
    cans = [i for i in drinks if "Lata" in i["nome"]]
    assert cans and all(i["leitura"] == "nao_mexer" and i["tamanho_da_diferenca"] == "moderada" for i in cans)


# Scorer --------------------------------------------------------------------------------------------------------------


def test_B01_opportunity_eval_score_good_answer(base_facts):
    s = score_answer(GOOD, base_facts)
    assert s["ok"] and s["pass_rate"] == 1.0 and s["dropped"] == 0
    assert s["levers"] == {"subir_preco": 1, "manter": 1, "rever_custo": 1} and s["lever_spread"] == 3
    assert s["issues"] == {}


def test_B01_opportunity_eval_score_counts_dropped_and_forbidden(base_facts):
    bad = op("Mais lucro no X-Burger Sintético", "Suba para R$ 31,00 — ganho certo.", [BURGER], "subir_preco")
    s = score_answer([*GOOD, bad], base_facts)
    assert s["pass_rate"] == 0.75 and s["dropped"] == 1 and not s["ok"]
    assert s["issues"]["forbidden_words"] == 1 and s["issues"]["long_dash"] == 1


def test_B01_opportunity_eval_score_count_length_and_repeats(base_facts):
    assert score_answer(GOOD[:2], base_facts)["issues"] == {"count_out_of_range": True}
    long_title = op("X-Burger Sintético " + "muito " * 12, "Está abaixo. Pode vender menos.", [BURGER], "subir_preco")
    three = op("X-Salada Sintético", "Está abaixo. Suba devagar. Pode vender menos.", [SALADA], "subir_preco")
    again = op("De novo o X-Burger Sintético", "Pode vender menos.", [BURGER], "subir_preco")
    s = score_answer([*GOOD, long_title, three], base_facts)
    assert s["issues"] == {"title_too_long": 1, "why_too_long": 1, "item_repeated": 1}
    assert score_answer([*GOOD[1:], again, GOOD[0]], base_facts)["issues"] == {"item_repeated": 1}


def test_B01_opportunity_eval_score_money_free_framing(base_facts):
    raise_only = op("Teste R$ 25,90 no X-Burger Sintético", "Está 17% abaixo do meio.", [BURGER], "subir_preco")
    cost_less = op("Batata Frita Sintética 400 g acima", "Está 22% acima do meio.", [BATATA], "rever_custo")
    s = score_answer([raise_only, cost_less, GOOD[2]], base_facts)
    assert s["issues"] == {"raise_without_sells_less": 1, "cost_lever_without_cost": 1}


def test_B01_opportunity_eval_score_caveat_on_weak_comparisons():
    """Marlon, 08/nov: a weak comparison says sizes may differ or more stores will firm it up."""
    facts = build_facts(*SCENARIOS["poucas_lojas"])
    art = "00000000-0000-4000-8003-000000000001"
    duplo = "00000000-0000-4000-8003-000000000002"
    brownie = "00000000-0000-4000-8003-000000000004"
    without = op("Acompanhe o Hambúrguer Artesanal Sintético", "Está 16% abaixo do meio. Veja de novo depois.", [art], "acompanhar")
    with_it = op("Acompanhe o Hambúrguer Duplo Sintético", "Poucas lojas vendem igual. Com mais lojas comparadas a leitura fica mais firme.", [duplo], "acompanhar")
    portion = op("Acompanhe o Brownie Sintético", "O tamanho dos vizinhos pode ser diferente. O preço de face já mostra a diferença.", [brownie], "acompanhar")
    s = score_answer([without, with_it, portion], facts)
    assert s["issues"] == {"caveat_missing": 1}


def test_B01_opportunity_eval_score_empty_answer_is_not_ok(base_facts):
    s = score_answer([], base_facts)
    assert not s["ok"] and s["pass_rate"] == 0.0 and s["issues"] == {"count_out_of_range": True}


def openai_resp(answer: list[dict[str, Any]]) -> dict[str, Any]:
    text = json.dumps({"oportunidades": answer}, ensure_ascii=False)
    return {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}


def test_B01_opportunity_eval_score_recording_uses_its_scenario():
    rec = {"provider": "openai", "scenario": "base", "prompt_version": "oportunidades.v3", "request": {"model": "m"}, "response": openai_resp(GOOD)}
    s = score_recording(rec)
    assert s["scenario"] == "base" and s["model"] == "m" and s["ok"]
    old = {"provider": "openai", "request": {"model": "m"}, "response": openai_resp(GOOD)}
    assert score_recording(old)["scenario"] == "base", "a v2 recording has no scenario key"


# Recorder ------------------------------------------------------------------------------------------------------------


def test_B01_opportunity_eval_recorder_arguments():
    parse = record_opportunities.parse_args
    assert parse([]) == (["base"], None)
    assert parse(["outro-modelo"]) == (["base"], "outro-modelo")
    assert parse(["--all"]) == (list(SCENARIOS), None)
    assert parse(["--all", "outro-modelo"]) == (list(SCENARIOS), "outro-modelo")
    assert parse(["--scenario", "poucas_lojas"]) == (["poucas_lojas"], None)
    with pytest.raises(SystemExit, match="unknown scenario"):
        parse(["--scenario", "nao_existe"])


class FakeClient:
    """Says what the test asks, in the OpenAI Responses shape; never a recorded model answer."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    @property
    def responses(self):
        return self

    def create(self, **kw):
        self.requests.append(kw)
        return openai_resp(GOOD)


def test_B01_opportunity_eval_recorder_writes_one_file_per_scenario_and_the_scorer_reads_them(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(record_opportunities, "OUT", tmp_path)
    client = FakeClient()
    ai = AiOpportunityWriter(client=client, model="modelo-de-teste", provider="openai").ai
    paths = [record_opportunities.record(ai, name) for name in SCENARIOS]
    assert len(client.requests) == len(SCENARIOS) and len({p.name for p in paths}) == len(SCENARIOS)
    rec = json.loads(paths[0].read_text())
    assert rec["scenario"] == "base" and rec["prompt_version"] == "oportunidades.v3" and rec["provider"] == "openai"
    assert "api_key" not in json.dumps(rec)
    assert opportunity_eval.main([str(p) for p in paths]) == 0
    out = capsys.readouterr().out
    assert "base" in out and "oportunidades.v3  modelo-de-teste: 1 of 6 recordings pass" in out


def test_B01_opportunity_eval_scenario_facts_feed_the_check():
    facts = build_facts(*SCENARIOS["porcao_espalhada"])
    isca = next(i for i in facts.prompt["itens"] if i["nome"] == "Isca de Peixe Sintética")
    assert isca["comparacao"] == "precos_espalhados" and isca["preco_para_testar"] == "R$ 59,90"
    assert Decimal("59.90") in facts.money and Decimal(isca["aumento_do_teste_pct"]) in facts.percents
