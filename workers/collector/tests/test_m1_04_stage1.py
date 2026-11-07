"""M1-04 Stage 1: categories, beverage attributes, the hard block and min_pairs by store. Acceptance IDs A1 to A4 and B1
to B4 of the pairing redesign (Marlon, 07/nov). All names are SINTÉTICO: generic products, no restaurant's menu."""

from __future__ import annotations

from fractions import Fraction

import pytest
from margo_collector.attributes import (
    beverage_attrs,
    category_m1_04,
    compare_beverages,
    is_combo_m1_04,
    quantity_m1_04,
    section_category,
)
from margo_collector.rules import Item, Settings, pair_item_m1_04
from margo_collector.xray import CalcInput, build_pairs, calculate


def bev(iid: str, store: str, name: str, ml: int | None, cents: int = 1000) -> Item:
    return Item(iid, store, name, cents, "ml" if ml else "un", ml, section="Bebidas")


def stores(name: str, ml: int | None, n: int = 5, start: int = 0) -> list[Item]:
    return [bev(f"{name}-{i}", f"s{i}", name, ml, 1000 + i) for i in range(start, start + n)]


def accepted(p) -> list[str]:
    return [c.item.name for c in p.candidates if c.accepted]


# Categories ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("section", "expected"),
    [
        ("Bebidas bem geladas", "bebidas"),
        ("LANCHES", "lanches"),
        ("Porções", "porcoes"),
        ("Pratos executivos", "pratos"),
        ("Sobremesas", "sobremesas"),
        ("Adicionais", "adicionais"),
        ("Os Mais Vendidos", None),
        ("Promoções da semana", None),
        ("Destaques", None),
        ("Clássicos", None),
        (None, None),
    ],
)
def test_M1_04_section_names_a_category_or_says_nothing(section, expected):
    assert section_category(section) == expected


def test_M1_04_category_source_order_taxonomy_then_section_then_name():
    assert category_m1_04("Cheeseburger", "Bebidas", None, "Sobremesas") == "sobremesas"
    assert category_m1_04("Cheeseburger", "Bebidas") == "bebidas"
    assert category_m1_04("Cheeseburger", "Os Mais Vendidos") == "lanches", "a non-section does not decide"
    assert category_m1_04("Cheeseburger", "Clássicos", None, "ABC") == "lanches"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Refrigerante cola 2 litros", "bebidas"),
        ("Água mineral 500 ml", "bebidas"),
        ("Suco de uva 300 ml", "bebidas"),
        ("X-Tudo da casa", "lanches"),
        ("Batata frita enorme", "porcoes"),
        ("Anéis de cebola", "porcoes"),
        ("Strogonoff de frango", "pratos"),
        ("Brownie com calda", "sobremesas"),
        ("Milkshake 400 ml", "sobremesas"),
        ("Bacon", "adicionais"),
        ("Queijo cheddar extra", "adicionais"),
        ("Adicional de ovo", "adicionais"),
        ("Molho da casa", "adicionais"),
        ("Coisa desconhecida", None),
    ],
)
def test_M1_04_category_from_the_name_when_nothing_else_says(name, expected):
    assert category_m1_04(name) == expected


def test_M1_04_description_decides_only_as_the_last_source():
    assert category_m1_04("Gigante da casa", None, "Pão, blend de 180 g, bacon") == "lanches"
    assert category_m1_04("Gigante da casa", None, "Acompanha refrigerante") is None
    assert category_m1_04("Bacon", None, "Pão de brioche") == "adicionais"


@pytest.mark.parametrize(
    ("name", "section", "expected"),
    [
        ("Combo casal", None, True),
        ("Kit festa", None, True),
        ("X-Tudo + refrigerante", None, True),
        ("Hambúrguer com refrigerante lata", None, True),
        ("Casal feliz", "Combos", True),
        ("Cheeseburger", "Lanches", False),
        ("Refrigerante cola 2 litros", "Bebidas", False),
    ],
)
def test_M1_04_combo_by_its_words_or_section(name, section, expected):
    assert is_combo_m1_04(name, section) is expected


# Beverage attributes ------------------------------------------------------------------------------


def test_M1_04_attrs_read_type_brand_flavor_variant():
    a = beverage_attrs("Refrigerante Coca-Cola lata", 350)
    assert (a.type, a.brand, a.flavor, a.variant, a.size_ml) == (
        "refrigerante",
        "coca_cola",
        "cola",
        "original",
        350,
    )
    assert beverage_attrs("Coca Cola Zero pet", 350).variant == "sem_acucar"
    assert beverage_attrs("Coca sem açúcar", 350).variant == "sem_acucar"
    assert beverage_attrs("Coca-Cola sem açúcar", 350) == beverage_attrs("COCA COLA ZERO PET", 350)
    assert beverage_attrs("Fanta Maracujá", 350).flavor == "maracuja"
    assert beverage_attrs("Guaraná Antarctica", 350).brand == "antarctica"
    assert beverage_attrs("Guaraná Antarctica", 350).type == "refrigerante"
    assert beverage_attrs("Cerveja Antarctica", 350).type == "cerveja"
    assert beverage_attrs("Heineken zero", 330).variant == "sem_alcool"
    assert beverage_attrs("Água fria com gás", 500).variant == "com_gas"
    assert beverage_attrs("Água mineral fria sem gás", 500).variant == "sem_gas"
    assert beverage_attrs("Água mineral", 500).variant == "sem_gas"
    assert beverage_attrs("Suco de laranja com acerola", 300).flavor == "acerola+laranja"


# A1 to A4: must be 0 on accepted pairs ------------------------------------------------------------


@pytest.mark.parametrize(
    ("own_name", "own_ml", "other_name", "other_ml"),
    [
        ("Refrigerante cola lata 350ml", 350, "Refrigerante cola 2 litros", 2000),
        ("Refrigerante cola 900 ml", 900, "Refrigerante cola 1 litro", 1000),
        ("Fanta laranja pet 2l", 2000, "Fanta laranja em lata 350ml", 350),
    ],
)
def test_A1_beverage_never_pairs_a_different_size(own_name, own_ml, other_name, other_ml):
    p = pair_item_m1_04(bev("o", "t", own_name, own_ml), stores(other_name, other_ml), Settings())
    assert p.candidates == ()
    assert p.status == "revisar"


def test_A1_one_litre_is_a_thousand_millilitres():
    p = pair_item_m1_04(
        bev("o", "t", "Refrigerante cola 1 litro", 1000), stores("Refrigerante cola 1000ml", 1000), Settings()
    )
    assert len(accepted(p)) == 5


@pytest.mark.parametrize(
    ("own_name", "other_name"),
    [
        ("Fanta laranja em lata 350ml", "Fanta maracujá pet 350ml"),
        ("Suco de laranja 300ml", "Suco de uva 300ml"),
        ("Coca-Cola sem açúcar em lata 350ml", "Coca-Cola em lata 350ml"),
        ("Coca-Cola em lata 350ml", "Pepsi 350ml"),
        ("Guaraná Antarctica em lata 350ml", "Guaraná Kuat 350ml"),
        ("Água fria com gás 500ml", "Água fria sem gás 500ml"),
    ],
)
def test_A2_beverage_never_pairs_a_different_brand_flavor_or_variant(own_name, other_name):
    p = pair_item_m1_04(bev("o", "t", own_name, 350), stores(other_name, 350), Settings())
    assert p.candidates == ()


def test_A3_a_large_burger_never_pairs_an_add_on_of_the_same_word():
    burger = Item("o", "t", "Gigante bacon", 4800, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Bacon", 500, section="Adicionais") for i in range(5)]
    assert pair_item_m1_04(burger, pool, Settings()).candidates == ()
    addon = Item("o", "t", "Bacon", 500, section="Adicionais")
    pool = [Item(f"b{i}", f"s{i}", "Gigante bacon", 4800, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(addon, pool, Settings()).candidates == ()


def test_A3_add_on_by_name_alone_without_any_section():
    burger = Item("o", "t", "Gigante bacon", 4800, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Bacon", 500) for i in range(5)]
    assert pair_item_m1_04(burger, pool, Settings()).candidates == ()


def test_A3_no_pair_across_categories_even_with_the_same_name():
    own = Item("o", "t", "Frango crispy", 2800, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Frango crispy", 3000, section="Pratos") for i in range(5)]
    assert pair_item_m1_04(own, pool, Settings()).candidates == ()


def test_A3_unknown_category_lists_for_a_founder_but_never_accepts():
    own = Item("o", "t", "Gigante da casa", 2800)
    pool = [Item(f"a{i}", f"s{i}", "Gigante da casa", 3000, section="Lanches") for i in range(5)]
    p = pair_item_m1_04(own, pool, Settings())
    assert (p.status, p.note, len(p.candidates), accepted(p)) == (
        "revisar",
        "categoria não identificada",
        5,
        [],
    )
    addons = [Item(f"b{i}", f"s{i}", "Gigante da casa", 300, section="Adicionais") for i in range(5)]
    assert pair_item_m1_04(own, addons, Settings()).candidates == (), "add-ons never pair with anything else"


def test_A4_a_combo_never_pairs_a_single_item():
    own = Item("o", "t", "Combo cheeseburger", 4000, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Cheeseburger", 2000, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(own, pool, Settings()).candidates == ()
    single = Item("o", "t", "Cheeseburger", 2000, section="Lanches")
    pool = [Item(f"b{i}", f"s{i}", "Cheeseburger + refrigerante", 4000, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(single, pool, Settings()).candidates == ()


def test_A4_combos_stay_with_combos_and_go_to_a_founder():
    own = Item("o", "t", "Combo cheeseburger", 4000, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Combo cheeseburger", 4100, section="Combos") for i in range(5)]
    p = pair_item_m1_04(own, pool, Settings())
    assert (p.status, p.note, len(p.candidates), accepted(p)) == ("revisar", "combos diferentes", 5, [])


def test_A3_combos_of_two_categories_do_not_meet():
    own = Item("o", "t", "Combo salada", 4000, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Combo salada", 4100, section="Pratos") for i in range(5)]
    assert pair_item_m1_04(own, pool, Settings()).candidates == ()


# B1, B2: beverages confirm on their own, or say why not --------------------------------------------


@pytest.mark.parametrize(
    ("own_name", "other_name", "ml"),
    [
        ("Refrigerante limão Sprite 2l", "Sprite garrafa 2 litros", 2000),
        ("Água mineral fria com gás 500ml", "Água com gás 500 ml", 500),
    ],
)
def test_B1_identical_attributes_confirm_with_one_store_and_no_poucos_pares(own_name, other_name, ml):
    p = pair_item_m1_04(bev("o", "t", own_name, ml), stores(other_name, ml, 1), Settings())
    assert p.status == "normalizado"
    assert p.note is None
    assert accepted(p) == [other_name]
    assert p.candidates[0].similarity == 1


def test_B1_only_the_identical_ones_are_accepted():
    pool = (
        stores("Sprite pet 2 lt", 2000, 2)
        + stores("Sprite pet 350ml", 350, 3, 2)
        + stores("Fanta uva 2 l", 2000, 2, 5)
    )
    p = pair_item_m1_04(bev("o", "t", "Sprite pet 2 litros", 2000), pool, Settings())
    assert accepted(p) == ["Sprite pet 2 lt", "Sprite pet 2 lt"]
    assert len(p.candidates) == 2


def test_B2_no_store_sells_the_same_attributes_says_so():
    p = pair_item_m1_04(bev("o", "t", "Sprite pet 2 litros", 2000), stores("Sprite 350 ml", 350), Settings())
    assert (p.status, p.note) == ("revisar", "nenhuma loja com os mesmos atributos")


def test_B2_missing_size_on_own_side_never_pairs_and_says_so():
    p = pair_item_m1_04(bev("o", "t", "Sprite em lata", None), stores("Sprite em lata", None), Settings())
    assert (p.status, p.note, accepted(p)) == ("revisar", "tamanho ilegível", [])
    assert len(p.candidates) == 5, "a founder can still look at them"


def test_B2_missing_size_on_the_other_side_never_auto_pairs():
    p = pair_item_m1_04(bev("o", "t", "Sprite 350 ml", 350), stores("Sprite em lata", None), Settings())
    assert (p.status, accepted(p)) == ("revisar", [])
    assert p.note == "nenhuma loja com os mesmos atributos"


def test_B2_unreadable_type_and_brand_say_so():
    p = pair_item_m1_04(
        bev("o", "t", "Bebida da casa 300 ml", 300), stores("Bebida da casa 300 ml", 300), Settings()
    )
    assert (p.status, p.note) == ("revisar", "tipo ilegível")
    p = pair_item_m1_04(
        bev("o", "t", "Refrigerante pet 2 litros", 2000), stores("Sprite pet 2 litros", 2000), Settings()
    )
    assert (p.status, p.note) == ("revisar", "marca ilegível")
    p = pair_item_m1_04(bev("o", "t", "Fanta pet 2 litros", 2000), stores("Fanta uva 2 litros", 2000), Settings())
    assert (p.status, p.note) == ("revisar", "sabor ilegível")


def test_B2_the_size_comes_from_the_m1_03_parser_when_the_unit_says_nothing():
    own = Item("o", "t", "Sprite pet 2 litros", 1000, section="Bebidas", size_from_name_ml=2000)
    pool = [
        Item(f"a{i}", f"s{i}", "Sprite 2l", 1000, section="Bebidas", size_from_name_ml=2000) for i in range(2)
    ]
    assert len(accepted(pair_item_m1_04(own, pool, Settings()))) == 2


def test_M1_04_a_generic_soda_matches_only_another_generic_one():
    p = pair_item_m1_04(
        bev("o", "t", "Refrigerante lata 350 ml", 350), stores("Refrigerante em lata 350ml", 350), Settings()
    )
    assert len(accepted(p)) == 5
    p = pair_item_m1_04(
        bev("o", "t", "Refrigerante lata 350 ml", 350), stores("Sprite em lata 350 ml", 350), Settings()
    )
    assert accepted(p) == []


def test_M1_04_other_categories_keep_name_similarity_and_count_stores():
    own = Item("o", "t", "Cheeseburger", 2000, section="Lanches")
    same_store = [Item(f"a{i}", "s0", "Cheeseburger", 2100 + i, section="Lanches") for i in range(5)]
    p = pair_item_m1_04(own, same_store, Settings())
    assert (p.status, p.note, accepted(p)) == ("revisar", "poucos pares", []), (
        "five rows of one store are one store"
    )
    many = [Item(f"a{i}", f"s{i}", "Cheeseburger", 2100, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(own, many, Settings()).status == "auto"


# B3: parity counts stores --------------------------------------------------------------------------


def one(own: Item, pool: list[Item], *, min_pairs: int = 5, reviewed: bool = False):
    return calculate([CalcInput("k", own, tuple(pool), None, reviewed=reviewed)], min_pairs=min_pairs).rows[0]


def test_B3_parity_needs_min_pairs_distinct_stores():
    own = bev("o", "t", "Sprite pet 2 litros", 2000)
    assert one(own, stores("Sprite pet 2 lt", 2000, 4)).parity_cents is None
    assert one(own, stores("Sprite pet 2 lt", 2000, 5)).parity_cents == 1002


def test_B3_duplicates_in_one_store_do_not_count_twice():
    own = bev("o", "t", "Sprite pet 2 litros", 2000, 900)
    dup = [bev(f"d{i}", "s0", "Sprite pet 2 lt", 2000, 1000) for i in range(5)]
    assert one(own, dup).parity_cents is None
    # Three identical rows in one store would pull the median to 1000; the store counts once, so 2000 wins.
    mixed = dup[:3] + [bev(f"e{i}", f"s{i + 1}", "Sprite pet 2 lt", 2000, 2000) for i in range(4)]
    assert one(own, mixed).parity_cents == 2000


def test_B3_a_store_with_two_prices_counts_once():
    own = bev("o", "t", "Sprite pet 2 litros", 2000, 900)
    rows = [bev("x", "s0", "Sprite pet 2 lt", 2000, 1000), bev("y", "s0", "Sprite 2l", 2000, 3000)]
    assert one(own, rows, min_pairs=2).parity_cents is None
    rows.append(bev("z", "s1", "Sprite pet 2 lt", 2000, 1000))
    assert one(own, rows, min_pairs=2).parity_cents == 1000


def test_B3_a_founder_review_waives_the_store_count_as_it_does_today():
    own = Item("o", "t", "Sundae", 1190, section="Sobremesas")
    pool = [Item(f"a{i}", f"s{i}", "Sundae", 1340, section="Sobremesas") for i in range(3)]
    assert one(own, pool).parity_cents is None
    assert one(own, pool, reviewed=True).parity_cents == 1340


# Founder decisions, also on a re-run ---------------------------------------------------------------


def test_M1_04_a_founder_accepted_pair_survives_even_if_the_rule_now_blocks_it():
    own = bev("o", "t", "Sprite pet 2 litros", 2000)
    other = bev("c", "s0", "Sprite 350 ml", 350)
    rows = build_pairs([own], [other], Settings(), {("o", "c"): (True, "fundador")})
    (row,) = rows
    assert [(p.public_menu_item_id, p.accepted, p.by) for p in row.pairs] == [("c", True, "fundador")]


def test_M1_04_a_founder_rejected_identical_pair_stays_rejected():
    own = bev("o", "t", "Sprite pet 2 litros", 2000)
    pool = [bev("a", "s0", "Sprite pet 2 lt", 2000), bev("b", "s1", "Sprite 2l", 2000)]
    (row,) = build_pairs([own], pool, Settings(), {("o", "a"): (False, "fundador")})
    assert {p.public_menu_item_id: (p.accepted, p.by) for p in row.pairs} == {
        "a": (False, "fundador"),
        "b": (True, None),
    }


def test_M1_04_a_decision_on_a_store_that_left_the_set_leaves_with_it():
    own = bev("o", "t", "Sprite pet 2 litros", 2000)
    (row,) = build_pairs([own], [], Settings(), {("o", "gone"): (True, "fundador")})
    assert row.pairs == ()


def test_M1_04_compare_is_symmetric():
    names = ["Sprite pet 2 lt", "Refrigerante 2 l", "Fanta 2 l", "Fanta uva 2 l", "Água 2 l", "Bebida da casa 2 l"]
    attrs = [beverage_attrs(n, 2000) for n in names]
    for a in attrs:
        for b in attrs:
            assert compare_beverages(a, b) == compare_beverages(b, a)
    assert Fraction(1) == attrs[0].size_ml / 2000


# Shapes learned from real menus, with invented names ------------------------------------------------


@pytest.mark.parametrize(
    ("section", "combo"),
    [
        ("Lanches & Combos da casa", False),
        ("Dogs: Combos & Individuais", False),
        ("Combos do chef", True),
        ("COMBO coca / porções", True),
        ("Promo!! só refrigerantes", False),
    ],
)
def test_A4_a_section_marks_a_combo_only_when_it_opens_with_the_word(section, combo):
    assert is_combo_m1_04("Cheese peixe", section) is combo


def test_A4_a_burger_under_a_mixed_section_pairs_as_a_single_item():
    own = Item("o", "t", "Cheese peixe", 2000, section="Lanches & Combos da casa")
    pool = [Item(f"a{i}", f"s{i}", "Cheese peixe", 2100, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(own, pool, Settings()).status == "auto"


@pytest.mark.parametrize(
    ("section", "expected"),
    [
        ("Dogão da chapa", "lanches"),
        ("Sobremessas da casa", "sobremesas"),
        ("Espetinhos", "pratos"),
        ("Cappuccino cremoso", "bebidas"),
        ("Atenção, clientes!", None),
    ],
)
def test_M1_04_sections_as_written_in_menus(section, expected):
    assert section_category(section) == expected


def test_A2_a_fruit_alone_in_the_drinks_section_is_a_juice():
    a = beverage_attrs("Uva com pêssego", None)
    assert (a.type, a.flavor) == ("suco", "pessego+uva")
    assert beverage_attrs("Goiaba natural", 300).type == "suco"


def test_A2_juice_with_water_is_no_water_and_differs_from_juice_with_milk():
    water = beverage_attrs("Goiaba com água", 300)
    milk = beverage_attrs("Goiaba com leite", 300)
    assert (water.type, water.flavor, water.variant) == ("suco", "goiaba", "com_agua")
    assert milk.variant == "com_leite"
    assert compare_beverages(water, milk) == "conflict"


def test_A2_spellings_of_one_thing_are_one_thing():
    assert beverage_attrs("Soda s/açúcar lt", 300).variant == "sem_acucar"
    assert beverage_attrs("Citrus Scheweppes", 300).brand == beverage_attrs("Schweppes citrus", 300).brand
    assert beverage_attrs("Água cristal", 500).brand == beverage_attrs("Água Crystal", 500).brand
    assert beverage_attrs("Isotônico power ade", 500).brand == beverage_attrs("Powerade", 500).brand


def test_B1_a_size_on_a_juice_brand_without_the_word_juice_confirms():
    p = pair_item_m1_04(
        bev("o", "t", "Natu abacaxi 700 ml", 700),
        stores("Suco pronto Natu abacaxi 700ml", 700, 1),
        Settings(),
    )
    assert len(accepted(p)) == 1


def test_B2_a_name_far_away_is_not_listed_for_a_founder():
    p = pair_item_m1_04(bev("o", "t", "Bebida da casa", None), stores("Sprite em lata", None), Settings())
    assert p.candidates == ()


def test_B3_a_name_with_a_rank_number_still_counts_per_store():
    own = Item("o", "t", "Dog peixe", 2000, section="Lanches")
    pool = [Item(f"a{i}", "s0", f"{i:02d} - Dog peixe", 2100, section="Lanches") for i in range(9)]
    assert pair_item_m1_04(own, pool, Settings()).note == "poucos pares"


@pytest.mark.parametrize("name", ["Dogão peixe", "Dog peixe", "Cheese peixe", "X peixe", "XBacon"])
def test_M1_04_lanches_by_name(name):
    assert category_m1_04(name) == "lanches"


def test_M1_04_x_only_opens_a_lanche_as_its_own_word():
    assert category_m1_04("Xarope da casa") is None


# Failure shapes of the old rule on real data, with invented names ------------------------------------


def test_A1_a_drink_filed_under_another_section_never_mixes_sizes_by_price_per_ml():
    own = Item("o", "t", "Pepsi pet 1 litro", 900, "ml", 1000, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", "Pepsi pet 300ml", 400, "ml", 300, section="Lanches") for i in range(5)]
    assert category_m1_04(own.name, own.section) == "bebidas"
    assert pair_item_m1_04(own, pool, Settings()).candidates == ()


def test_A1_normalized_beverages_with_every_size_accept_only_their_own():
    pool = [bev(f"a{ml}-{i}", f"s{i}", f"Pepsi pet {ml}ml", ml) for ml in (200, 300, 900, 2000, 350) for i in range(3)]
    p = pair_item_m1_04(bev("o", "t", "Pepsi em pet 350 ml", 350), pool, Settings())
    assert p.status == "normalizado"
    assert {c.item.unit_qty for c in p.candidates} == {350}


def test_A2_gas_or_no_gas_whatever_the_word_order():
    for sparkling in ("Água com gás Marca", "Com gás água Crystal", "Água Crystal c/ gás", "Crystal água gaseificada"):
        assert beverage_attrs(sparkling, 500).variant == "com_gas", sparkling
    for still in ("Água sem gás Crystal", "Crystal água s/ gás", "Água Crystal"):
        assert beverage_attrs(still, 500).variant == "sem_gas", still
    assert compare_beverages(beverage_attrs("Crystal água com gás", 500), beverage_attrs("Água sem gás Crystal", 500)) == "conflict"


@pytest.mark.parametrize(
    "name",
    [
        "2 Burger peixe +Pepsi 500ml",
        "3 - Burger duplo + 2 Fritas + 1 Refri 500ml",
        "Burger peixe 2 fritas 2 sodas",
        "Burger peixe com batata",
        "Burger peixe e Pepsi",
        "Burger peixe 2 latas",
    ],
)
def test_A4_a_combo_without_the_word_combo(name):
    assert is_combo_m1_04(name), name
    single = Item("o", "t", "Burger peixe", 2000, section="Lanches")
    pool = [Item(f"a{i}", f"s{i}", name, 4000, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(single, pool, Settings()).candidates == ()


@pytest.mark.parametrize("name", ["Burger peixe 180g", "Refri 2 litros", "Soda 600 ml", "03 - Burger peixe"])
def test_A4_a_size_or_a_menu_code_is_no_combo(name):
    assert not is_combo_m1_04(name), name


@pytest.mark.parametrize(
    ("name", "qty"),
    [
        ("4 Burger peixe", 4),
        ("2 - Burger peixe", 2),
        ("3x Burger peixe", 3),
        ("Dois burgers de peixe", 2),
        ("Burger peixe 2x", 2),
        ("Burger peixe", 1),
        ("03 - Burger peixe", 1),
        ("12 - Burger peixe", 1),
        ("4 queijos", 1),
        ("7up 350ml", 1),
    ],
)
def test_A5_a_leading_count_is_a_quantity_a_code_is_not(name, qty):
    assert quantity_m1_04(name) == qty


@pytest.mark.parametrize("section", ["Lanches", "Porções", "Sobremesas", "Pratos"])
def test_A5_a_quantity_never_pairs_a_single_item_in_any_category(section):
    single = Item("o", "t", "Batata peixe", 2000, section=section)
    pool = [Item(f"a{i}", f"s{i}", "4 Batata peixe", 4000, section=section) for i in range(5)]
    assert pair_item_m1_04(single, pool, Settings()).candidates == ()
    code = [Item(f"b{i}", f"s{i}", "03 - Batata peixe", 2100, section=section) for i in range(5)]
    assert len(pair_item_m1_04(single, code, Settings()).candidates) == 5
    same = Item("o", "t", "4 Batata peixe", 4000, section=section)
    assert len(pair_item_m1_04(same, pool, Settings()).candidates) == 5


def test_A5_a_quantity_of_a_drink_never_pairs_a_single_one():
    own = bev("o", "t", "Pepsi pet 300ml", 300)
    assert pair_item_m1_04(own, stores("2 - Pepsi pet 300ml", 300), Settings()).candidates == ()


def test_B1_original_means_the_default_and_spacing_does_not_count():
    a, b = beverage_attrs("Sprite   Original pet", 2000), beverage_attrs("Sprite pet", 2000)
    assert a == b
    p = pair_item_m1_04(bev("o", "t", "Sprite  pet 2  litros", 2000), stores("Sprite Original em pet", 2000, 1), Settings())
    assert len(accepted(p)) == 1


def test_B2_the_note_says_why_for_every_category():
    # Stage 2 reads every category by attributes (test_m1_04_stage2.py); an item with no category keeps its note.
    own = Item("o", "t", "Moqueca de peixe", 2000, section="Pratos")
    far = [Item(f"a{i}", f"s{i}", "Pizza grande", 3000, section="Pratos") for i in range(5)]
    assert pair_item_m1_04(own, far, Settings()).note == "exclusivo, sem comparação"
    near = [Item("a", "s0", "Moqueca de peixe", 2100, section="Pratos")]
    assert pair_item_m1_04(own, near, Settings()).note == "poucos pares"
    unknown = Item("o", "t", "Coisa desconhecida", 2000)
    assert pair_item_m1_04(unknown, far, Settings()).note == "categoria não identificada"
    burger = Item("o", "t", "Burger peixe", 2000, section="Lanches")
    far = [Item(f"a{i}", f"s{i}", "Pizza grande", 3000, section="Lanches") for i in range(5)]
    assert pair_item_m1_04(burger, far, Settings()).note == "exclusivo, sem comparação"
    near = [Item("a", "s0", "Burger peixe", 2100, section="Lanches")]
    assert pair_item_m1_04(burger, near, Settings()).note == "poucos pares"
