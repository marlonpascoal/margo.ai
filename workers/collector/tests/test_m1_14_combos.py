"""M1-14 (D81): a combo compares by the sum of its parts. All names are SINTÉTICO: generic products."""

from __future__ import annotations

from margo_collector.combo import ComboPart, PartRef, combo_m1_14, match_part_m1_14, split_combo_m1_14
from margo_collector.rules import Item
from margo_collector.xray import CalcInput, calculate


def it(item_id: str, name: str, cents: int, section: str = "Lanches") -> Item:
    return Item(id=item_id, store_id="T", name=name, price_cents=cents, section=section)


MENU = [
    it("dog", "Dog queijo", 2200),
    it("dogb", "Dog bacon", 2500),
    it("burg", "Burguer 160", 3200),
    it("frita", "Batata Frita Simples", 1490, "Porções"),
    it("fritac", "Batata Frita com cheddar", 2490, "Porções"),
    it("aneis", "Anéis de cebola", 1890, "Porções"),
    it("lata", "Refrigerante lata 350ml", 790, "Bebidas"),
    it("coca2", "Coca Cola 2 litros", 1600, "Bebidas"),
    it("coca6", "Coca Cola 600 ml", 1000, "Bebidas"),
]


def test_M1_14_splits_parts_with_their_quantities():
    assert split_combo_m1_14("4 Dog queijo + Coca Cola 2 litros") == (
        ComboPart(4, "dog queijo"),
        ComboPart(1, "coca cola 2 litro"),
    )
    assert split_combo_m1_14("Combo Top - 2 Burguer + Fritas E Anéis") == (
        ComboPart(2, "burguer"),
        ComboPart(1, "fritas"),
        ComboPart(1, "aneis"),
    )
    assert split_combo_m1_14("Dog bacon + batata + bebida lata") == (
        ComboPart(1, "dog bacon"),
        ComboPart(1, "batata"),
        ComboPart(1, "bebida lata"),
    )
    assert split_combo_m1_14("Porção - Trio Top - Batata + Frango") == (
        ComboPart(1, "batata"),
        ComboPart(1, "frango"),
    )


def test_M1_14_finds_each_part_in_the_own_menu():
    def name(text: str) -> str | None:
        m = match_part_m1_14(text, MENU)
        return m.id if m else None

    assert name("dog queijo") == "dog"
    assert name("coca cola 2 litros") == "coca2"
    assert name("coca 600 ml") == "coca6"
    assert name("fritas") == "frita"  # the plain one, not the one with cheddar
    assert name("batata") == "frita"
    assert name("aneis") == "aneis"
    assert name("bebida lata") == "lata"
    assert name("bebida") == "lata"
    with_ref = match_part_m1_14(
        "bebida lata", [*MENU, it("tub", "Tubaína lata 350ml", 590, "Bebidas")], {"lata"}
    )
    assert (
        with_ref is not None and with_ref.id == "lata"
    )  # a can with a reference beats a cheaper one without
    assert name("pastel de vento") is None
    assert name("dog burguer frango") is None  # not "Dog bacon": every word must be there


def test_M1_14_reads_the_combo_discount_and_the_neighbors_sum():
    combo = it("c", "4 Dog queijo + Coca Cola 2 litros", 6990, "Combos")
    refs = {"dog": PartRef(2000, 2600, 5), "coca2": PartRef(1500, 1500, 7)}
    r = combo_m1_14(combo, MENU, refs)
    assert r is not None
    assert r.solo_cents == 4 * 2200 + 1600
    assert (r.range.low_cents, r.range.high_cents, r.range.position) == (
        4 * 2000 + 1500,
        4 * 2600 + 1500,
        "abaixo",
    )
    assert r.stores == 5
    assert [p["item"] for p in r.parts] == ["Dog queijo", "Coca Cola 2 litros"]


def test_M1_14_a_part_not_found_gives_no_number():
    combo = it("c", "Dog queijo + Pastel de vento", 3000, "Combos")
    r = combo_m1_14(combo, MENU, {"dog": PartRef(2000, 2600, 5)})
    assert r is None


def test_M1_14_a_part_without_reference_keeps_the_discount_only():
    combo = it("c", "Dog queijo + bebida lata", 2600, "Combos")
    r = combo_m1_14(combo, MENU, {"dog": PartRef(2000, 2600, 5)})
    assert r is not None and r.solo_cents == 2990 and r.range is None


def test_M1_14_calculate_gives_a_combo_its_sum_range():
    combo = it("c", "Dog queijo + Coca Cola 600 ml", 3000, "Combos")

    def n(i: str, s: str, name: str, c: int, sec: str = "Lanches") -> Item:
        return Item(id=i, store_id=s, name=name, price_cents=c, section=sec)

    dog = CalcInput(
        "k-dog", MENU[0], tuple(n(f"d{s}", f"S{s}", "Dog queijo", 2000 + 100 * s) for s in range(5)), None
    )
    coca = CalcInput(
        "k-coca",
        MENU[8],
        tuple(n(f"c{s}", f"S{s}", "Coca Cola 600 ml", 900, "Bebidas") for s in range(5)),
        None,
    )
    c = CalcInput("k-c", combo, (), None)
    menu = CalcInput("k-x", MENU[3], (), None)
    rows = {r.key: r for r in calculate([dog, coca, c, menu], min_pairs=3, two_tiers=True).rows}
    row = rows["k-c"]
    assert row.tier == "faixa"
    assert row.combo_solo_cents == 2200 + 1000
    assert (row.range_low_cents, row.range_high_cents) is not None
    assert row.range_basis == "soma das partes"
    assert row.range_stores == 5


def test_M1_13_a_range_keeps_one_price_per_store_for_the_chart():
    own = it("o", "Dog queijo", 2200)
    acc = tuple(
        Item(id=f"d{s}", store_id=f"S{s}", name="Dog queijo", price_cents=p, section="Lanches")
        for s, p in enumerate([2600, 2000, 2400])
    )
    row = calculate([CalcInput("k", own, acc, None)], min_pairs=3, two_tiers=True).rows[0]
    assert row.range_prices == (2000, 2400, 2600)
    assert row.range_stores == 3
