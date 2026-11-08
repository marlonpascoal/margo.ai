"""M1-13 (D74): shelf items and food with a known size compare exactly; food with no size gets only a price range.
All names are SINTÉTICO: generic products, no restaurant's menu."""

from __future__ import annotations

from fractions import Fraction

from margo_collector.rules import (
    Item,
    comparison_tier_m1_13,
    count_from_text_m1_03,
    normalize_m1_03,
    range_m1_13,
)
from margo_collector.xray import CalcInput, calculate


def food(item_id: str, store: str, name: str, cents: int, desc: str | None = None, section: str = "Porções") -> Item:
    return Item(id=item_id, store_id=store, name=name, price_cents=cents, section=section, description=desc)


def test_M1_03_reads_piece_counts_the_catalog_left_out():
    assert count_from_text_m1_03(food("a", "s", "Uramaki de salmão 8 Peças", 3000)) == 8
    assert count_from_text_m1_03(food("a", "s", "Sashimi 40pçs", 3000)) == 40
    assert count_from_text_m1_03(food("a", "s", "Ichigo Morango (4 Uni)", 3000)) == 4
    assert count_from_text_m1_03(food("a", "s", "Dadinho de queijo 05unid", 3000)) == 5


def test_M1_03_reads_a_count_from_the_description_when_the_name_has_none():
    assert count_from_text_m1_03(food("a", "s", "Nuggets de frango", 3000, "Porção com 10 unidades.")) == 10


def test_M1_03_never_reads_an_ambiguous_count():
    assert count_from_text_m1_03(food("a", "s", "Sashimi 30pçs+10u harumaki", 3000)) is None
    assert count_from_text_m1_03(food("a", "s", "Sashimi 8 peças ou 16 peças", 3000)) is None
    assert count_from_text_m1_03(food("a", "s", "Roll queijo R$4,49unidade", 3000)) is None
    assert count_from_text_m1_03(food("a", "s", "Frango", 3000, "140 gramas de filé")) is None


def test_M1_03_a_count_already_stored_wins_and_beverages_are_left_alone():
    item = Item(id="a", store_id="s", name="Sashimi 8 peças", price_cents=800, unit_qty=10, section="Porções")
    assert normalize_m1_03(item).own_base_qty == 10
    assert count_from_text_m1_03(food("a", "s", "Cerveja 6 un", 3000, section="Bebidas")) is None


def test_M1_03_a_count_read_from_text_prices_per_piece():
    n = normalize_m1_03(food("a", "s", "Uramaki de salmão 8 Peças", 3200))
    assert (n.unit, n.per_base, n.by_weight_or_pack) == ("un", Fraction(400), True)


def test_M1_13_tiers():
    assert comparison_tier_m1_13(food("a", "s", "Coca 350ml", 800, section="Bebidas")) == "exata"
    assert comparison_tier_m1_13(food("a", "s", "Sashimi 10 peças", 800)) == "exata"
    weighed = Item(id="a", store_id="s", name="Ceviche", price_cents=800, unit="g", unit_qty=150, section="Entradas")
    assert comparison_tier_m1_13(weighed) == "exata"
    assert comparison_tier_m1_13(food("a", "s", "Sashimi de salmão", 800)) == "faixa"


def test_M1_13_the_range_is_the_middle_of_real_prices():
    r = range_m1_13(2000, [1000, 2000, 3000, 4000, 5000])
    assert (r.low_cents, r.high_cents, r.position) == (2000, 4000, "dentro")
    assert range_m1_13(1000, [2000, 3000, 4000, 5000, 6000]).position == "abaixo"
    assert range_m1_13(9000, [2000, 3000, 4000, 5000, 6000]).position == "acima"


def _input(key: str, own: Item, n: int, reviewed: bool = False) -> CalcInput:
    accepted = tuple(food(f"{key}{i}", f"S{i}", own.name, 2000 + i * 500, section=own.section or "") for i in range(n))
    return CalcInput(key, own, accepted, None, reviewed=reviewed)


def test_M1_13_food_with_no_size_has_a_range_and_no_parity():
    row = calculate([_input("k", food("o", "T", "Sashimi de salmão", 1500), 5)], min_pairs=5, two_tiers=True).rows[0]
    assert (row.parity_cents, row.reading, row.loss_cents) == (None, None, None)
    assert (row.tier, row.range_low_cents, row.range_high_cents, row.range_stores) == ("faixa", 2500, 3500, 5)
    assert row.range_position == "abaixo"


def test_M1_13_too_few_stores_means_no_range_even_when_a_person_confirmed():
    row = calculate([_input("k", food("o", "T", "Linguiça", 1500), 1, True)], min_pairs=5, two_tiers=True).rows[0]
    assert (row.tier, row.parity_cents, row.range_low_cents) == ("faixa", None, None)


def test_M1_13_shelf_items_keep_their_parity():
    own = food("o", "T", "Refrigerante cola 350ml", 800, section="Bebidas")
    row = calculate([_input("k", own, 5)], min_pairs=5, two_tiers=True).rows[0]
    assert row.tier == "exata"
    assert row.parity_cents is not None


def test_M1_13_off_keeps_the_old_calculation():
    row = calculate([_input("k", food("o", "T", "Sashimi de salmão", 1500), 5)], min_pairs=5).rows[0]
    assert row.parity_cents is not None
    assert row.tier is None
