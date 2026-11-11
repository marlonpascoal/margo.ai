"""M1-16 (D84): a skewer compares only with skewers of the same cut, sold as one skewer, never with sweet ones.
All names are SINTÉTICO: generic products, no restaurant's menu."""

from __future__ import annotations

from margo_collector.family import Family, family_key, family_ranges_m1_13, skewer_attrs_m1_16
from margo_collector.rules import Item

ESPETO = Family("espeto", "bovino", "normal")


def it(i: str, store: str, name: str, cents: int) -> Item:
    return Item(id=i, store_id=store, name=name, price_cents=cents, section="Espetos")


def test_M1_16_reads_the_cut():
    cut = lambda n: skewer_attrs_m1_16(it("a", "s", n, 1500)).cut  # noqa: E731
    assert cut("Carne") == "carne"
    assert cut("Espetinho de alcatra") == "carne"
    assert cut("Coração") == "coracao"
    assert cut("Medalhão de frango") == "medalhao_frango"
    assert cut("Medalhão bovino") == "medalhao_bovino"
    assert cut("Medalhão de mandioca") == "mandioca"
    assert cut("Linguiça Cuiabana") == "linguica"
    assert cut("Kafta") == "kafta"
    assert cut("Panceta") == "panceta"
    assert cut("Queijo coalho") == "queijo"
    assert cut("Pão de alho") == "pao_alho"
    assert cut("Frango") == "frango"


def test_M1_16_sweet_skewers_and_portions_stay_out():
    assert skewer_attrs_m1_16(it("a", "s", "Espeto de Uva c/ chocolate", 2099)).sweet
    assert skewer_attrs_m1_16(it("b", "s", "Espeto de Churros com Doce de Leite", 1999)).sweet
    assert skewer_attrs_m1_16(it("c", "s", "Espeto ao Retiro Familiar Compartilhar", 14190)).portion
    assert skewer_attrs_m1_16(it("d", "s", "Michui de filet mignon (unidade -230gr)", 10480)).portion
    assert skewer_attrs_m1_16(it("e", "s", "Kafta 1/2 porção (1 unidade - 100gr)", 4810)).portion
    assert not skewer_attrs_m1_16(it("f", "s", "Espetinho de Carne 100g", 1800)).portion


def test_M1_16_the_range_keeps_the_same_cut_sold_as_one_skewer():
    own = it("o", "P", "Carne", 1590)
    pool = [
        *[it(f"c{n}", f"C{n}", "Espetinho de Carne", 1400 + 100 * n) for n in range(4)],
        *[it(f"h{n}", f"H{n}", "Espeto de Coração", 1500) for n in range(4)],
        *[it(f"d{n}", f"D{n}", "Espeto de Morango c/ chocolate", 2099) for n in range(4)],
        it("p", "X", "Espeto ao Retiro Familiar Compartilhar", 14190),
    ]
    fams = {family_key(i): ESPETO for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    assert r.prices == (1400, 1500, 1600, 1700)
    assert "carne" in r.basis


def test_M1_16_too_few_of_the_same_cut_gives_no_range():
    own = it("o", "P", "Medalhão bovino", 2090)
    pool = [
        *[it(f"c{n}", f"C{n}", "Espetinho de Carne", 1500) for n in range(5)],
        it("m", "M", "Medalhão de carne", 1740),
    ]
    fams = {family_key(i): ESPETO for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    assert r.range is None
