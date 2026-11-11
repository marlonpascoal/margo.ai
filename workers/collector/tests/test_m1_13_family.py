"""M1-13 (D75): dish families and the range built on them. No test calls the API. All names are SINTÉTICO."""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction

from margo_collector.attributes import category_m1_04
from margo_collector.family import (
    Family,
    FamilyAsk,
    build_call,
    classify_step_m1_13,
    family_key,
    family_ranges_m1_13,
    menu_term_shares_m1_02,
    parse_answer,
)
from margo_collector.repo import MemoryXrayRepo
from margo_collector.rules import Item, Ranked, balance_rank_m1_11
from margo_collector.steps import XrayRun, calc_step, collect_step, pair_step
from margo_collector.xray import CalcInput, StoreRow, calculate


def item(i: str, store: str, name: str, cents: int, section: str = "Temakis", qty: int | None = None) -> Item:
    return Item(id=i, store_id=store, name=name, price_cents=cents, section=section, unit_qty=qty)


class Fake:
    model = "fake"

    def __init__(self) -> None:
        self.asked: list[str] = []

    def classify(self, items: Sequence[FamilyAsk]) -> dict[str, Family]:
        self.asked += [i.name for i in items]
        out = {}
        for i in items:
            size = "mini" if "mini" in i.name.lower() else "normal"
            protein = "atum" if "atum" in i.name.lower() else "salmao"
            out[i.ref] = Family("temaki", protein, size)
        return out


def fam(*items: Item, family: str = "temaki", protein: str = "salmao", size: str = "normal") -> dict[str, Family]:
    return {family_key(i): Family(family, protein, size) for i in items}


NEAR = [item(f"n{i}", f"S{i}", "Temaki de salmão", 3000 + i * 500) for i in range(5)]
OWN = item("own", "T", "Temaki de salmão", 2500)


def test_M1_04_a_japanese_dish_under_a_portions_section_is_a_prato():
    assert category_m1_04("Sashimi de salmão (10 unid.)", "Porções") == "pratos"
    assert category_m1_04("Uramaki filadélfia", "Entradas") == "pratos"
    assert category_m1_04("Batata frita", "Porções") == "porcoes"
    assert category_m1_04("Sushi doce", "Sobremesas") == "sobremesas"


def test_M1_13_range_of_the_same_family_and_protein():
    r = family_ranges_m1_13([("k", OWN)], NEAR, fam(OWN, *NEAR), 5)["k"]
    assert (r.range.low_cents, r.range.high_cents, r.range.position, r.stores) == (3500, 4500, "abaixo", 5)
    assert r.basis == "temaki de salmão"


def test_M1_17_a_japanese_dish_never_falls_back_to_another_fish():
    # Was M1-13's fallback to the family; M1-17 (D85): tuna is not compared with salmon.
    own = item("own", "T", "Temaki de atum", 2500)
    families = {**fam(*NEAR), **fam(own, protein="atum")}
    r = family_ranges_m1_13([("k", own)], NEAR, families, 5)["k"]
    assert r.range is None and r.basis == "temaki de atum"


def test_M1_13_mini_only_compares_with_mini():
    own = item("own", "T", "Temaki mini de salmão", 2500)
    r = family_ranges_m1_13([("k", own)], NEAR, {**fam(*NEAR), **fam(own, size="mini")}, 5)
    assert "k" not in r or r["k"].range is None


def test_M1_13_individual_and_normal_are_one_group():
    own = item("own", "T", "Temaki individual de salmão", 2500)
    assert "k" in family_ranges_m1_13([("k", own)], NEAR, {**fam(*NEAR), **fam(own, size="individual")}, 5)


def test_M1_13_a_store_counts_once_and_never_the_store_itself():
    near = [*NEAR, item("x", "S0", "Temaki salmão", 9000), item("y", "T", "Temaki salmão", 9000)]
    assert family_ranges_m1_13([("k", OWN)], near, fam(OWN, *near), 5)["k"].stores == 5


def test_M1_13_a_sized_item_compares_per_piece_only_with_sized_items():
    own = item("own", "T", "Temaki 10 unid", 3000, qty=10)
    sized = [item(f"n{i}", f"S{i}", "Temaki 20 unid", 8000, qty=20) for i in range(5)]
    r = family_ranges_m1_13([("k", own)], [*sized, *NEAR], fam(own, *sized, *NEAR), 5)["k"]
    assert (r.range.low_cents, r.stores) == (4000, 5)


def test_M1_13_other_is_not_a_family():
    assert family_ranges_m1_13([("k", OWN)], NEAR, fam(OWN, *NEAR, family="outro"), 5) == {}


def test_M1_13_each_pattern_is_asked_once_and_known_ones_never():
    fake = Fake()
    twin = item("t", "S1", "Temaki de salmão", 1000)
    other = item("o", "S2", "Temaki de atum", 1000)
    known = fam(other, protein="atum")
    found = classify_step_m1_13([OWN, twin, other], known, fake)
    assert fake.asked == ["Temaki de salmão"]
    assert found == {family_key(OWN): Family("temaki", "salmao", "normal")}


def test_M1_13_no_classifier_means_nothing_asked():
    assert classify_step_m1_13([OWN], {}, None) == {}


def test_M1_13_only_business_data_goes_out():
    payload = str(build_call([FamilyAsk("0", "Temaki", None, "Temakis")]).payload)
    assert "price" not in payload and "store" not in payload


def test_M1_13_parse_keeps_only_listed_words():
    good = {"ref": "0", "familia": "temaki", "proteina": "salmao", "tamanho": "mini"}
    bad = {"ref": "1", "familia": "inventada", "proteina": "salmao", "tamanho": "mini"}
    assert set(parse_answer({"itens": [good, bad]}, {"0", "1"})) == {"0"}


def test_M1_13_the_family_range_replaces_the_pair_range_and_covers_a_doubt():
    fr = family_ranges_m1_13([("k", OWN)], NEAR, fam(OWN, *NEAR), 5)
    row = calculate([CalcInput("k", OWN, (), None, skipped=True)], min_pairs=5, two_tiers=True, family_ranges=fr).rows[0]
    assert (row.tier, row.range_low_cents, row.range_basis) == ("faixa", 3500, "temaki de salmão")
    assert row.parity_cents is None


def test_M1_13_a_sized_food_with_no_parity_is_range_too():
    own = item("own", "T", "Sashimi 10 unid", 3000, section="Porções", qty=10)
    row = calculate([CalcInput("k", own, (), None)], min_pairs=5, two_tiers=True).rows[0]
    assert row.tier == "faixa"


def _repo(two_tiers: bool) -> MemoryXrayRepo:
    repo = MemoryXrayRepo()
    repo.xrays["x"] = XrayRun("x", None, "T", None, 3, [], {}, None)
    repo.hood["x"] = [StoreRow(f"S{i}", 100, None, True, None) for i in range(5)]
    repo.items = {i.id: i for i in [OWN, *NEAR]}
    repo.two_tiers_on = two_tiers
    return repo


def test_M1_13_pair_step_classifies_and_calc_step_uses_it():
    repo = _repo(True)
    pair_step(repo, "x", None, None, Fake())
    assert family_key(OWN) in repo.families
    calc_step(repo, "x")
    row = next(r for r in repo.calc["x"].rows)
    assert row.tier == "faixa"
    assert row.range_basis == "temaki de salmão"


def test_M1_13_with_the_flag_off_nothing_is_classified():
    repo = _repo(False)
    fake = Fake()
    pair_step(repo, "x", None, None, fake)
    assert fake.asked == []


# Neighbors by the store's own menu (D76) ------------------------------------------------------------------------


def test_M1_17_a_japanese_dish_with_pieces_compares_only_with_stated_pieces():
    # Was D75's whole-portion fallback; M1-17 (D85): 10 pieces are not compared with a temaki of unknown size.
    own = item("own", "T", "Temaki 10 unid", 3000, qty=10)
    r = family_ranges_m1_13([("k", own)], NEAR, fam(own, *NEAR), 5)["k"]
    assert r.range is None


def _menu(*names: str) -> list[Item]:
    return [item(f"m{n}", "T", name, 1000, "Espetos") for n, name in enumerate(names)]


def test_D76_terms_follow_the_menu_and_drop_noise():
    menu = _menu(*[f"Espeto {n}" for n in range(8)], "Burger 1", "Burger 2", "Pudim")
    families = {
        **{family_key(i): Family("espeto", "bovino", "normal") for i in menu[:8]},
        **{family_key(i): Family("hamburguer", "bovino", "normal") for i in menu[8:10]},
        family_key(menu[10]): Family("doce", "sem_proteina", "normal"),
    }
    shares = menu_term_shares_m1_02(menu, families)
    assert set(shares) == {"Carnes", "Hambúrguer"}
    assert round(shares["Carnes"], 2) == 0.73


def _ranked(n: int) -> list[Ranked]:
    return [Ranked(f"s{i}", Fraction(100 - i), i + 1) for i in range(n)]


def test_D76_capture_places_follow_the_menu_share():
    terms = {f"s{i}": ["Hambúrguer"] for i in range(30)} | {f"s{i}": ["Carnes"] for i in range(30, 40)}
    order = balance_rank_m1_11(_ranked(40), terms, {"Carnes": 0.7, "Hambúrguer": 0.3}, 30)
    first = {r.store_id for r in order if r.rank <= 30}
    assert sum(1 for s in first if terms[s] == ["Carnes"]) == 10
    assert sum(1 for s in first if terms[s] == ["Hambúrguer"]) == 20
    assert sorted(r.rank for r in order) == list(range(1, 41))


def test_D76_no_menu_captures_it_first_and_does_not_discover():
    repo = _repo(True)
    repo.items = {}
    assert collect_step(repo, "x", "sandbox", Fake()) == {"menu_first": 1}
    assert repo.queued == []
    assert collect_step(repo, "x", "sandbox", Fake()) == {"menu_first": 1}


def test_D76_a_failed_menu_capture_still_discovers():
    repo = _repo(True)
    repo.items = {}
    repo.menu_first["x"] = "finished"
    assert collect_step(repo, "x", "sandbox", Fake()) == {"queued": 1}


def test_D76_with_a_menu_the_terms_join_the_categories():
    repo = _repo(True)
    collect_step(repo, "x", "sandbox", Fake())
    assert "Japonesa" in repo.xrays["x"].categories
    assert repo.xrays["x"].rules["menu_term_shares"] == {"Japonesa": 1.0}
    assert repo.queued


def test_D76_with_the_flag_off_the_flow_is_as_before():
    repo = _repo(False)
    assert collect_step(repo, "x", "sandbox", Fake()) == {"queued": 1}
    assert repo.xrays["x"].categories == []


def test_D76_a_store_of_that_cuisine_comes_before_one_the_search_surfaced():
    terms = {f"s{i}": ["Japonesa"] for i in range(40)}
    categories = {f"s{i}": ("Pizza" if i < 10 else "Comida Japonesa") for i in range(40)}
    order = balance_rank_m1_11(_ranked(40), terms, {"Japonesa": 1.0}, 30, categories)
    first = {r.store_id for r in order if r.rank <= 30}
    assert not any(categories[s] == "Pizza" for s in first)
