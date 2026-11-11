"""M1-15 (D82): a sandwich compares only with sandwiches of the same segment, the same number of patties and a
similar weight of meat. All names are SINTÉTICO: generic products, no restaurant's menu."""

from __future__ import annotations

from margo_collector.family import (
    Family,
    dog_protein_m1_15,
    family_key,
    family_ranges_m1_13,
    sandwich_attrs_m1_15,
    store_segments_m1_15,
)
from margo_collector.rules import Item


def it(i: str, store: str, name: str, cents: int, section: str = "Lanches") -> Item:
    return Item(id=i, store_id=store, name=name, price_cents=cents, section=section)


BURGER = Family("hamburguer", "bovino", "normal")
DOG = Family("cachorro_quente", "linguica", "normal")


def test_M1_15_reads_patties_grams_and_segment_from_the_name():
    a = sandwich_attrs_m1_15(it("a", "s", "Burguer 160", 3999))
    assert (a.segment, a.patties, a.grams) == ("artesanal", 1, 160)
    assert sandwich_attrs_m1_15(it("b", "s", "X-Salada", 1990)).segment == "lanchonete"
    assert sandwich_attrs_m1_15(it("c", "s", "Xis Bacon", 3100)).segment == "lanchonete"
    assert sandwich_attrs_m1_15(it("d", "s", "Smash Burger Duplo", 3390)).segment == "smash"
    assert sandwich_attrs_m1_15(it("d", "s", "Smash Burger Duplo", 3390)).patties == 2
    assert sandwich_attrs_m1_15(it("e", "s", "Burger Kids", 2500)).segment == "infantil"
    assert sandwich_attrs_m1_15(it("f", "s", "Duplo Maluco 360gr carne", 6599)).grams == 360
    assert sandwich_attrs_m1_15(it("g", "s", "Triplo bacon", 5500)).patties == 3
    assert sandwich_attrs_m1_15(it("h", "s", "Mega bacon", 4800)).segment is None


def test_M1_15_a_store_that_states_its_blend_is_artesanal_for_its_other_burgers():
    menu = [
        it("1", "P", "Burguer 160", 3999),
        it("2", "P", "Burguer bacon 160", 4200),
        it("3", "P", "Mega bacon", 4800),
    ]
    fams = {family_key(i): BURGER for i in menu}
    assert store_segments_m1_15(menu, fams) == {"P": "artesanal"}


def test_M1_15_not_a_hot_dog_and_sweet_dogs_stay_out():
    assert sandwich_attrs_m1_15(it("x", "s", "Xis Simples", 3100), DOG).excluded
    assert sandwich_attrs_m1_15(it("y", "s", "Dog chocolate branco", 2618), DOG).excluded
    assert not sandwich_attrs_m1_15(it("z", "s", "Dog bacon", 2199), DOG).excluded


def test_M1_15_the_range_keeps_only_the_same_segment_and_patties():
    own = it("o", "P", "Burguer 160", 3999)
    pool = [
        *[it(f"a{n}", f"A{n}", "Burger artesanal 150g", 3500 + 100 * n) for n in range(5)],
        *[it(f"x{n}", f"X{n}", "X-Salada", 1990) for n in range(5)],
        *[it(f"d{n}", f"D{n}", "Burger duplo 150g", 5500) for n in range(5)],
    ]
    fams = {family_key(i): BURGER for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    assert r.prices == (3500, 3600, 3700, 3800, 3900)
    assert "artesanal" in r.basis


def test_M1_15_too_few_comparable_stores_gives_no_range_rather_than_a_wider_one():
    own = it("o", "P", "Burguer 160", 3999)
    pool = [*[it(f"x{n}", f"X{n}", "X-Salada", 1990) for n in range(6)], it("a", "A", "Burger 150g", 3500)]
    fams = {family_key(i): BURGER for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    assert r.range is None and r.prices == ()


def test_M1_15_hot_dogs_compare_by_sausages_not_by_the_store_segment():
    own = it("o", "P", "Dog duplo bacon", 3200, "Hot Dog")
    burgers = [it("b1", "P", "Burguer 160", 3999), it("b2", "P", "Burguer bacon 160", 4200)]
    dogs = [it(f"d{n}", f"D{n}", "Dog duplo", 2600 + 100 * n, "Hot Dog") for n in range(4)]
    pool = [*dogs, it("s", "S", "Dog simples", 1800, "Hot Dog")]
    fams = {family_key(i): (DOG if "Dog" in i.name else BURGER) for i in [own, *burgers, *pool]}
    r = family_ranges_m1_13([("k", own), ("b", burgers[0])], pool, fams, 3)["k"]
    assert r.prices == (2600, 2700, 2800, 2900)


def test_M1_15_a_hot_dog_is_salsicha_plus_its_filling_unless_the_name_says_linguica():
    assert dog_protein_m1_15(it("a", "s", "Dog bacon", 3100), DOG).protein == "salsicha_bacon"
    assert dog_protein_m1_15(it("b", "s", "Dog duplo frango", 3200), DOG).protein == "salsicha_frango"
    assert dog_protein_m1_15(it("c", "s", "Cachorro quente", 2000), DOG).protein == "salsicha"
    assert dog_protein_m1_15(it("d", "s", "Dog calabresa", 3145), DOG).protein == "linguica"


def test_M1_18_three_or_four_comparable_stores_give_an_indicative_range():
    own = it("o", "P", "Burguer 160", 3999)
    pool = [it(f"a{n}", f"A{n}", "Burger artesanal 150g", 3500 + 100 * n) for n in range(3)]
    fams = {family_key(i): BURGER for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 5)["k"]
    assert r.range is not None and r.indicative and r.stores == 3


def test_M1_18_two_stores_are_still_no_range():
    own = it("o", "P", "Burguer 160", 3999)
    pool = [it(f"a{n}", f"A{n}", "Burger artesanal 150g", 3500 + 100 * n) for n in range(2)]
    fams = {family_key(i): BURGER for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 5)["k"]
    assert r.range is None and not r.indicative
