"""M1-12 (D73): the AI review of the automatic pairs. No test calls the API: the reviewer is a fake that applies a
fixed judgment. All names are SINTÉTICO: generic products, no restaurant's menu."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from margo_collector.pair_review import (
    CHECKS,
    DOUBT_NOTE,
    AiPairReviewer,
    ReviewAnswers,
    ReviewPair,
    Verdict,
    build_call,
    learned_verdict,
    pair_pattern,
    parse_answer,
    review_pairing_m1_12,
)
from margo_collector.pair_review_eval import LABELED, score_answers
from margo_collector.repo import MemoryXrayRepo
from margo_collector.rules import Item, Settings
from margo_collector.steps import XrayRun, pair_step
from margo_collector.xray import StoreRow


def verdict(ok: bool = True, failed: str = "mesmo_tipo") -> Verdict:
    return Verdict({c: ok or c != failed for c in CHECKS})


class Fake:
    """Rejects a candidate whose name holds a banned word; answers nothing for a silent one."""

    model = "fake-model"
    prompt_version = "teste"

    def __init__(self, banned: Sequence[str] = (), silent: Sequence[str] = (), failed: str = "mesmo_tipo") -> None:
        self.banned, self.silent, self.failed = banned, silent, failed
        self.calls: list[list[ReviewPair]] = []

    def review(self, pairs: Sequence[ReviewPair]) -> ReviewAnswers:
        self.calls.append(list(pairs))
        out = {}
        for p in pairs:
            if any(w in p.candidate.name for w in self.silent):
                continue
            out[p.ref] = verdict(not any(w in p.candidate.name for w in self.banned), self.failed)
        return out


def item(item_id: str, store: str, name: str, cents: int = 2000, section: str = "Pratos") -> Item:
    return Item(id=item_id, store_id=store, name=name, price_cents=cents, section=section)


OWN = [item("own", "T", "Espeto de frango", 1590)]


def stores(names: Sequence[str]) -> list[Item]:
    return [item(f"c{i}", f"S{i}", n) for i, n in enumerate(names)]


FIVE_GOOD = stores(["Espeto de frango"] * 5)


def run(pool: Sequence[Item], reviewer: Any, **kw: Any):
    return review_pairing_m1_12(OWN, list(pool), Settings(), {}, {}, reviewer, {}, **kw)


def accepted(rows) -> set[str]:
    return {p.public_menu_item_id for r in rows for p in r.pairs if p.accepted}


def test_M1_12_a_verdict_is_derived_from_the_checklist():
    assert verdict().approved is True
    v = verdict(False, "mesmo_servico")
    assert v.approved is False
    assert v.failed == ("mesmo_servico",)


def test_M1_12_good_pairs_are_adequate_and_stop_after_one_round():
    fake = Fake()
    r = run(FIVE_GOOD, fake)
    assert r.status == "adequado"
    assert r.score == 1
    assert r.rounds == 1
    assert len(fake.calls) == 1
    assert accepted(r.rows) == {f"c{i}" for i in range(5)}
    assert r.rows[0].pair_status == "auto"


def test_M1_12_a_rejected_pair_leaves_and_the_item_loses_its_parity_stores():
    r = run(stores(["Espeto de frango"] * 4 + ["Espeto de frango ruim"]), Fake(banned=["ruim"]))
    assert accepted(r.rows) == set()
    assert r.rows[0].pair_status == "revisar"
    assert r.rows[0].pair_note == "poucos pares"
    assert r.rejected == 1
    assert r.first_round_score == 4 / 5
    assert r.detail[0]["candidate_item_id"] == "c4"
    assert r.detail[0]["motivo"] == "mesmo_tipo"


def test_M1_12_iterates_on_what_changed_only():
    # S0 sells two matches: the closest name wins the store, is rejected, and the next one is reviewed in round 2.
    pool = [
        item("best", "S0", "Espeto de frango ruim"),
        item("next", "S0", "Espeto frango grande sabor bom"),
        *[item(f"c{i}", f"S{i}", "Espeto de frango") for i in range(1, 6)],
    ]
    fake = Fake(banned=["ruim"])
    r = run(pool, fake)
    assert r.rounds == 2
    assert [p.candidate.id for p in fake.calls[1]] == ["next"]
    assert "next" in accepted(r.rows)
    assert "best" not in accepted(r.rows)


def test_M1_12_what_stays_unreviewed_after_the_last_round_goes_to_the_doubts():
    pool = [*stores(["Espeto de frango"] * 5), item("x", "S9", "Espeto de frango mudo")]
    r = run(pool, Fake(silent=["mudo"]), max_rounds=2)
    assert "x" not in accepted(r.rows)
    assert r.sent_to_doubts == 1
    assert r.score == 5 / 6
    assert r.status == "abaixo_da_meta"


def test_M1_12_an_item_left_with_too_few_reviewed_stores_is_a_doubt():
    pool = stores(["Espeto de frango"] * 4 + ["Espeto de frango mudo"])
    r = run(pool, Fake(silent=["mudo"]), max_rounds=2)
    assert r.rows[0].pair_status == "revisar"
    assert r.rows[0].pair_note == DOUBT_NOTE


def test_M1_12_a_person_decision_is_never_sent_nor_changed():
    fake = Fake(banned=["Espeto"])
    decisions = {("own", "c0"): (True, "pessoa")}
    r = review_pairing_m1_12(OWN, list(FIVE_GOOD), Settings(), decisions, {}, fake, {})
    assert "c0" in accepted(r.rows)
    assert all(p.candidate.id != "c0" for call in fake.calls for p in call)


def test_M1_12_without_a_reviewer_the_rules_stand_and_it_says_so():
    r = run(FIVE_GOOD, None)
    assert r.status == "sem_ia"
    assert r.score is None
    assert accepted(r.rows) == {f"c{i}" for i in range(5)}


def test_M1_12_no_answer_at_all_keeps_the_rules_and_says_so():
    r = run(FIVE_GOOD, Fake(silent=["Espeto"]))
    assert r.status == "sem_resposta"
    assert r.rows[0].pair_status == "auto"


def test_M1_12_ai_never_creates_a_pair():
    assert accepted(run(stores(["Pizza grande"] * 5), Fake()).rows) == set()


def _pattern(cand_name: str = "Espeto de frango") -> str:
    return pair_pattern(OWN[0], item("x", "Sx", cand_name))


def test_M1_12_a_pattern_applies_after_min_runs_with_one_verdict():
    assert learned_verdict({"a": True, "b": True}, 3) is None
    assert learned_verdict({"a": True, "b": True, "c": True}, 3) is True
    assert learned_verdict({"a": False, "b": False, "c": False}, 3) is False
    assert learned_verdict({"a": True, "b": False, "c": True}, 3) is None


def test_M1_12_learned_patterns_need_no_call():
    fake = Fake()
    learnings = {_pattern(): {"a": True, "b": True, "c": True}}
    r = review_pairing_m1_12(OWN, list(FIVE_GOOD), Settings(), {}, {}, fake, learnings)
    assert fake.calls == []
    assert r.from_learnings == 5
    assert r.status == "adequado"


def test_M1_12_answers_are_kept_but_a_price_or_portion_rejection_is_not():
    r = run(stores(["Espeto de frango"] * 5), Fake(banned=["Espeto"], failed="preco_plausivel"))
    assert r.answers == {}
    r = run(stores(["Espeto de frango"] * 5), Fake(banned=["Espeto"], failed="mesmo_servico"))
    assert r.answers == {_pattern(): False}
    r = run(FIVE_GOOD, Fake())
    assert r.answers == {_pattern(): True}


def test_M1_12_only_business_data_goes_out():
    pair = ReviewPair("0", "pratos", OWN[0], item("c", "Loja Secreta", "Espeto de frango"))
    payload = str(build_call([pair]).payload)
    assert "Loja Secreta" not in payload
    assert "Espeto de frango" in payload


def test_M1_12_parse_keeps_only_known_refs_with_every_check():
    good = {"ref": "0", **dict.fromkeys(CHECKS, True)}
    partial = {"ref": "1", "mesmo_tipo": True}
    unknown = {"ref": "9", **dict.fromkeys(CHECKS, True)}
    got = parse_answer({"pares": [good, partial, unknown]}, {"0", "1"})
    assert set(got) == {"0"}
    assert parse_answer(None, {"0"}) == {}


def test_M1_12_the_real_reviewer_splits_large_runs():
    reviewer = AiPairReviewer.__new__(AiPairReviewer)
    seen: list[int] = []

    class Ai:
        def ask(self, call):
            pairs = call.payload["pares"]
            seen.append(len(pairs))
            return {"pares": [{"ref": p["ref"], **dict.fromkeys(CHECKS, True)} for p in pairs]}

    reviewer.ai = Ai()
    pairs = [ReviewPair(str(i), "pratos", OWN[0], OWN[0]) for i in range(250)]
    assert len(reviewer.review(pairs)) == 250
    assert seen == [100, 100, 50]


def test_M1_12_pair_step_saves_the_review_and_its_answers():
    repo = MemoryXrayRepo()
    x = "x1"
    repo.xrays[x] = XrayRun(x, None, "T", None, 3, [], {}, None)
    repo.hood[x] = [StoreRow(f"S{n}", 100, None, True, None) for n in range(5)]
    repo.items = {i.id: i for i in [*OWN, *FIVE_GOOD]}
    out = pair_step(repo, x, None, Fake())
    assert out["review_status"] == "adequado"
    assert repo.pair_reviews[x].score == 1
    assert repo.pair_review_answers[_pattern()][x] is True


def test_M1_12_eval_scores_a_perfect_and_a_lenient_reviewer():
    perfect = {p.ref: ok for p, ok in LABELED}
    assert score_answers(perfect)["acerto"] == 1
    lenient = score_answers({p.ref: True for p, _ in LABELED})
    assert lenient["ruins_que_passaram"] == sum(1 for _, ok in LABELED if not ok)
    assert lenient["bons_reprovados"] == 0


def test_M1_12_eval_pairs_hold_good_and_bad_cases():
    assert {True, False} == {ok for _, ok in LABELED}
    assert "Item" not in str(build_call([p for p, _ in LABELED]).payload)
