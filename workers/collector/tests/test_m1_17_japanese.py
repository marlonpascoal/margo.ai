"""M1-17 (D85): Japanese dishes compare with the same fish, per piece only against stores that state the pieces, never
with sweet rolls or pieces sold one by one; snacks and tempura only with the same dish. All names are SINTÉTICO."""

from __future__ import annotations

from margo_collector.family import Family, family_key, family_ranges_m1_13, japanese_attrs_m1_17
from margo_collector.rules import Item


def it(i: str, store: str, name: str, cents: int, section: str = "Porções") -> Item:
    return Item(id=i, store_id=store, name=name, price_cents=cents, section=section)


def test_M1_17_reads_pieces_sweetness_single_pieces_and_the_snack():
    a = japanese_attrs_m1_17(it("a", "s", "Hot roll (16 unid.)", 4290))
    assert a.pieces == 16 and not a.sweet
    assert japanese_attrs_m1_17(it("b", "s", "Hot de banana (08 unidades)", 3000)).sweet
    assert japanese_attrs_m1_17(it("c", "s", "N Sashimi - monte o seu!", 199)).single
    assert japanese_attrs_m1_17(it("d", "s", "Edamame trufado (180g)", 5790)).dish == "edamame"
    assert japanese_attrs_m1_17(it("e", "s", "Shimeji na manteiga (210g)", 4690)).dish == "shimeji"
    assert japanese_attrs_m1_17(it("f", "s", "Pipoca de camarão (200g)", 4890)).dish == "camarao"


def test_M1_17_the_same_fish_and_per_piece_only_with_stated_pieces():
    own = it("o", "M", "Sashimi de atum (10 unid.)", 6390)
    atum = Family("sashimi", "atum", "normal")
    salmao = Family("sashimi", "salmao", "normal")
    pool = [
        *[it(f"a{n}", f"A{n}", "Sashimi de atum 10 unid.", 6000 + 100 * n) for n in range(5)],
        *[it(f"s{n}", f"S{n}", "Sashimi de salmão 10 unid.", 5000) for n in range(5)],
        *[it(f"x{n}", f"X{n}", "Sashimi de atum", 4000) for n in range(5)],
    ]
    fams = {family_key(i): (salmao if "salmão" in i.name else atum) for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    # M1-19 (D87): the atum sashimi with no pieces takes the 10 pieces most stores state, and the basis says it.
    assert r.prices == (4000, 4000, 4000, 4000, 4000, 6000, 6100, 6200, 6300, 6400)
    assert "tamanho presumido em 5 lojas" in r.basis


def test_M1_17_no_fallback_to_another_fish():
    own = it("o", "M", "Sashimi de tilápia (15 unid.)", 4290)
    pool = [it(f"s{n}", f"S{n}", "Sashimi de salmão 15 unid.", 6000) for n in range(6)]
    fams = {
        family_key(own): Family("sashimi", "tilapia", "normal"),
        **{family_key(i): Family("sashimi", "salmao", "normal") for i in pool},
    }
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    assert r.range is None


def test_M1_17_a_snack_compares_only_with_the_same_dish():
    own = it("o", "M", "Edamame (200g)", 3600, "Entradas")
    pet = Family("petisco", "vegetal", "normal")
    pool = [
        *[it(f"e{n}", f"E{n}", "Edamame 200g", 3000 + 100 * n, "Entradas") for n in range(4)],
        *[it(f"h{n}", f"H{n}", "Shimeji na manteiga 200g", 2500, "Entradas") for n in range(4)],
    ]
    fams = {family_key(i): pet for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 3)["k"]
    assert r.prices == (3000, 3100, 3200, 3300)


def itd(i: str, store: str, name: str, cents: int, desc: str) -> Item:
    return Item(id=i, store_id=store, name=name, price_cents=cents, section="Entradas", description=desc)


def test_M1_17_the_size_in_the_description_counts_when_the_name_has_none():
    a = japanese_attrs_m1_17(itd("a", "s", "Carpaccio trufado", 4000, "8 fatias de salmão com azeite trufado"))
    assert a.pieces == 8
    b = japanese_attrs_m1_17(itd("b", "s", "Ceviche", 3000, "150g de tilápia marinada"))
    assert b.grams == 150
    c = japanese_attrs_m1_17(itd("c", "s", "Sashimi (10 unid.)", 4000, "20 unid de gengibre"))
    assert c.pieces == 10


def test_M1_17_a_sweet_sauce_on_the_side_is_not_a_sweet_dish():
    assert not japanese_attrs_m1_17(it("a", "s", "Harumaki de queijo com mel trufado ou calda de goiabada (4 unid)", 3690)).sweet
    assert japanese_attrs_m1_17(it("b", "s", "Harumaki de banana com chocolate", 3000)).sweet


def test_M1_17_gohan_and_marinated_salmon_get_their_dish():
    from margo_collector.family import correct_family_m1_17

    other = Family("outro", "sem_proteina", "normal")
    assert correct_family_m1_17(it("g", "s", "Gohan (220g)", 1790), other).family == "petisco"
    fixed = correct_family_m1_17(
        itd("o", "s", "Salmão ao molho de ostras (135g)", 5590, "Cubos de salmão com molho de ostra"),
        Family("outro", "salmao", "normal"),
    )
    assert (fixed.family, fixed.protein) == ("ceviche", "salmao")
    keep = Family("temaki", "salmao", "normal")
    assert correct_family_m1_17(it("t", "s", "Temaki de salmão", 3000), keep) is keep


HOSSO = Family("hossomaki", "salmao", "mini")


def test_M1_19_per_piece_uses_the_pieces_in_the_description():
    own = it("o", "M", "Shake maki (16 unid.)", 4800)
    pool = [itd(f"p{n}", f"P{n}", "Hossomaki salmão", 2000 + 100 * n, "8 unid de hossomaki") for n in range(5)]
    fams = {family_key(i): HOSSO for i in [own, *pool]}
    r = family_ranges_m1_13([("k", own)], pool, fams, 5)["k"]
    # 8 pieces at R$ 20 to 24 is R$ 40 to 48 for 16 pieces, never the 8-piece price.
    assert r.prices == (4000, 4200, 4400, 4600, 4800)
    assert "presumido" not in r.basis


def test_M1_19_a_store_that_states_no_size_takes_the_size_most_stores_state():
    own = it("o", "M", "Shake maki (16 unid.)", 4800)
    stated = [it(f"s{n}", f"S{n}", "Hossomaki salmão 8 unid", 2000, "Porções") for n in range(5)]
    silent = [it(f"q{n}", f"Q{n}", "Hossomaki salmão", 2400, "Porções") for n in range(2)]
    fams = {family_key(i): HOSSO for i in [own, *stated, *silent]}
    r = family_ranges_m1_13([("k", own)], [*stated, *silent], fams, 5)["k"]
    assert r.stores == 7 and 4800 in r.prices
    assert "tamanho presumido em 2 lojas" in r.basis


def test_M1_19_no_presumed_size_when_the_stores_disagree():
    own = it("o", "M", "Shake maki (16 unid.)", 4800)
    stated = [it(f"s{n}", f"S{n}", f"Hossomaki salmão {q} unid", 2000, "Porções") for n, q in enumerate((4, 8, 12, 16, 20))]
    silent = [it(f"q{n}", f"Q{n}", "Hossomaki salmão", 2400, "Porções") for n in range(2)]
    fams = {family_key(i): HOSSO for i in [own, *stated, *silent]}
    r = family_ranges_m1_13([("k", own)], [*stated, *silent], fams, 5)["k"]
    assert "presumido" not in r.basis
