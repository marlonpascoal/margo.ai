"""M1-01 to M1-08 (spec/04-rules.md §1) on small hand-made rows. The G-SYN numbers are in test_b01_*."""

from datetime import UTC, datetime
from decimal import Decimal
from fractions import Fraction

import pytest
from margo_collector.rules import (
    Item,
    RankCandidate,
    RankWeights,
    Settings,
    Store,
    distance_m_m1_01,
    exclusion_m1_02,
    gap_m1_06,
    loss_m1_08,
    median,
    name_tokens,
    neighborhood_m1_01,
    normalize_m1_03,
    pair_item_m1_04,
    pareto_m1_08,
    parity_m1_05,
    percent_label,
    rank_m1_11,
    reading_m1_07,
    round_half_away,
    similarity_m1_04,
)
from margo_collector.xray import CalcInput, build_neighborhood, calculate

TARGET = Store("t", "Alvo", "Lanches", Decimal("-23.330000"), Decimal("-51.150000"))
COLLECTED = datetime(2026, 10, 28, 13, 0, tzinfo=UTC)


def at_km(id_: str, km_north: float, **kw) -> Store:
    # One degree of latitude is 111.195 km on the mean sphere.
    return Store(
        id_, id_, "Lanches", Decimal(str(-23.33 + km_north / 111.19508)), Decimal("-51.150000"), **kw
    )


def test_M1_01_distance_is_great_circle_in_metres():
    assert distance_m_m1_01(-23.33, -51.15, -23.33, -51.15) == 0
    assert abs(distance_m_m1_01(-23.33, -51.15, -23.33 + 1 / 111.19508, -51.15) - 1000) <= 1


def test_M1_01_neighborhood_keeps_stores_within_radius_nearest_first():
    stores = [
        at_km("far", 3.2),
        at_km("b", 2.9),
        at_km("a", 0.4),
        at_km("edge", 2.999),
        TARGET,
        Store("nocoords", "x", "Lanches", None, None),
    ]
    got = neighborhood_m1_01(TARGET, stores, 3)
    assert [s.id for s, _ in got] == ["a", "b", "edge"]
    assert [round(d / 100) / 10 for _, d in got] == [0.4, 2.9, 3.0]
    assert [s.id for s, _ in neighborhood_m1_01(TARGET, stores, 5)][-1] == "far"


def test_M1_02_national_chain_closed_and_not_delivering_are_excluded_in_order():
    s = Settings()
    chain = at_km("c", 1, is_national_chain=True, last_seen_open_at=datetime(2026, 9, 1, tzinfo=UTC))
    assert (
        exclusion_m1_02(chain, collected_at=COLLECTED, delivers_to_target=None, settings=s)
        == "regra: rede tabelada"
    )
    closed = at_km("k", 1, last_seen_open_at=datetime(2026, 9, 18, 15, tzinfo=UTC))
    assert (
        exclusion_m1_02(closed, collected_at=COLLECTED, delivers_to_target=None, settings=s)
        == "regra: fechada há 40 dias"
    )
    # Exactly 30 days is not "more than 30 days".
    thirty = at_km("k30", 1, last_seen_open_at=datetime(2026, 9, 28, 15, tzinfo=UTC))
    assert exclusion_m1_02(thirty, collected_at=COLLECTED, delivers_to_target=None, settings=s) is None
    far = at_km("f", 1)
    assert exclusion_m1_02(far, collected_at=COLLECTED, delivers_to_target=False, settings=s) is None
    only_hood = Settings(same_neighborhood_only=True)
    assert (
        exclusion_m1_02(far, collected_at=COLLECTED, delivers_to_target=False, settings=only_hood)
        == "regra: não entrega no bairro"
    )
    assert exclusion_m1_02(far, collected_at=COLLECTED, delivers_to_target=None, settings=only_hood) is None


def test_M1_02_toggles_off_keep_the_store():
    s = Settings(exclude_closed=False, exclude_national_chains=False)
    chain = at_km("c", 1, is_national_chain=True, last_seen_open_at=datetime(2026, 1, 1, tzinfo=UTC))
    assert exclusion_m1_02(chain, collected_at=COLLECTED, delivers_to_target=None, settings=s) is None


def test_M1_03_weight_volume_and_pack_go_to_price_per_base_unit():
    fries = normalize_m1_03(Item("i", "s", "Batata frita média", 1490, "g", 300))
    assert (fries.unit, fries.per_base, fries.display_cents, fries.by_weight_or_pack) == (
        "100g",
        Fraction(1490, 300),
        497,
        True,
    )
    shake = normalize_m1_03(Item("i", "s", "Milkshake 400 ml", 1690, "ml", 400))
    assert (shake.unit, shake.display_cents) == ("100ml", 423)
    six = normalize_m1_03(Item("i", "s", "Pack 6 latas", 2700, "pack", 6))
    assert (six.unit, six.per_base, six.by_weight_or_pack) == ("un", Fraction(450), True)
    combo = normalize_m1_03(Item("i", "s", "Combo casal", 7990, "pack", None))
    assert (combo.unit, combo.per_base, combo.by_weight_or_pack) == ("combo", Fraction(7990), False)
    can = normalize_m1_03(Item("i", "s", "Lata 350 ml", 500))
    assert (can.unit, can.per_base, can.by_weight_or_pack) == ("un", Fraction(500), False)
    with pytest.raises(ValueError):
        normalize_m1_03(Item("i", "s", "Batata", 1000, "g", None))


def test_M1_04_name_tokens_and_similarity():
    assert name_tokens("X-Bacon artesanal 180 g") == {"bacon", "artesanal"}
    assert name_tokens("Batatas Fritas 400g") == {"batata", "frita"}
    assert similarity_m1_04("Refrigerante lata 350 ml", "Lata 350 ml") == Fraction(2, 3)
    assert similarity_m1_04("Sundae", "Sundae de chocolate") == Fraction(2, 3)
    assert similarity_m1_04("Sundae", "350 ml") == 0


def _pool(name: str, n: int, unit="un", qty=None, price=1000, store_prefix="s"):
    return [Item(f"{name}-{i}", f"{store_prefix}{i}", name, price + i, unit, qty) for i in range(n)]


def test_M1_04_pairs_automatically_with_min_pairs_above_threshold():
    own = Item("own", "target", "Cheeseburger duplo", 500)
    p = pair_item_m1_04(own, _pool("Cheeseburger duplo", 5) + _pool("Pizza grande", 3), Settings())
    assert (p.status, p.note, len(p.candidates)) == ("auto", None, 5)
    assert all(c.accepted for c in p.candidates)


def test_M1_04_below_min_pairs_goes_to_revisar_with_nothing_accepted():
    own = Item("own", "target", "Molho especial extra", 400)
    # 0.8 (strong), 0.667 (comparable, below the threshold) and 0.4 (not comparable).
    pool = _pool("Molho especial", 4) + _pool("Maionese especial extra", 3) + _pool("Molho da casa", 2)
    p = pair_item_m1_04(own, pool, Settings())
    assert (p.status, p.note, len(p.candidates)) == ("revisar", "poucos pares", 7)
    assert not any(c.accepted for c in p.candidates)


def test_M1_04_combo_always_goes_to_revisar():
    own = Item("own", "target", "Combo casal", 7990, "pack", None)
    p = pair_item_m1_04(own, _pool("Combo casal", 8, "pack"), Settings())
    assert (p.status, p.note, len(p.candidates)) == ("revisar", "combos diferentes", 8)


def test_M1_03_M1_04_weight_item_pairs_only_with_weight_items_and_shows_normalizado():
    own = Item("own", "target", "Batata frita média", 1490, "g", 300)
    pool = _pool("Batata frita", 5, "g", 400) + _pool("Batata frita", 3, "un")
    p = pair_item_m1_04(own, pool, Settings())
    assert (p.status, len(p.candidates)) == ("normalizado", 5)


def test_M1_04_own_store_items_never_pair():
    own = Item("own", "target", "Sundae", 1190)
    p = pair_item_m1_04(own, [Item(f"x{i}", "target", "Sundae", 1000) for i in range(9)], Settings())
    assert len(p.candidates) == 0


def test_M1_05_parity_is_the_median_of_accepted_pairs_in_the_items_terms():
    assert median([Fraction(3), Fraction(1), Fraction(2)]) == 2
    assert median([Fraction(1), Fraction(2), Fraction(3), Fraction(10)]) == Fraction(5, 2)
    own = Item("own", "t", "Batata frita média", 1490, "g", 300)
    pairs = [
        Item("a", "s", "Fritas", 2200, "g", 400),
        Item("b", "s", "Fritas", 1840, "g", 300),
        Item("c", "s", "Fritas", 3000, "g", 400),
    ]
    # Per gram: 5.5, 6.133.., 7.5; median 6.133.. times 300 g.
    assert parity_m1_05(own, pairs) == 1840
    assert parity_m1_05(own, []) is None


def test_M1_06_M1_07_gap_and_reading_at_the_band_edges():
    assert gap_m1_06(500, 650) == Fraction(-150, 650)
    assert percent_label(gap_m1_06(500, 650)) == "−23%"
    assert percent_label(gap_m1_06(3690, 3150)) == "+17%"
    assert percent_label(gap_m1_06(2990, 3050)) == "−2%"
    assert reading_m1_07(Fraction(-1, 10)) == "pode_subir"
    assert reading_m1_07(Fraction(-99, 1000)) == "na_media"
    assert reading_m1_07(Fraction(1, 10)) == "nao_mexer"
    assert reading_m1_07(Fraction(99, 1000)) == "na_media"


def test_M1_08_loss_uses_weekly_units_when_known_else_one():
    assert loss_m1_08(1840, 1490, 62) == 21700
    assert loss_m1_08(1840, 1490, None) == 350
    assert loss_m1_08(3150, 3690, 10) == -5400
    assert loss_m1_08(1000, 999, Decimal("0.5")) == 1  # half a centavo rounds away from zero


def test_M1_08_pareto_ranks_positive_losses_and_counts_items_for_80_percent():
    losses = {"a": ("A", 50), "b": ("B", 30), "c": ("C", 15), "d": ("D", 5), "e": ("E", -40), "f": ("F", 0)}
    p = pareto_m1_08(losses, items_total=6)
    assert [r.key for r in p.rows] == ["a", "b", "c", "d"]
    assert [r.cum_share for r in p.rows] == [Fraction(1, 2), Fraction(4, 5), Fraction(19, 20), Fraction(1)]
    assert (p.items_for_80, p.items_total, p.total_loss_cents) == (2, 6, 100)


def test_rounding_is_half_away_from_zero():
    assert [round_half_away(Fraction(x, 2)) for x in (1, 3, -1, -3)] == [1, 2, -1, -2]


def test_settings_from_xray_rules_uses_defaults_for_missing_keys():
    s = Settings.from_xray(5, {"exclude_closed": False, "min_pairs": 7, "similarity_threshold": "0.7"})
    assert (
        s.radius_km,
        s.exclude_closed,
        s.exclude_national_chains,
        s.min_pairs,
        s.similarity_threshold,
    ) == (5, False, True, 7, Fraction(7, 10))


def test_B01_M1_05_a_pair_in_another_base_unit_stays_out_of_parity():
    """M1-03: an accepted pair from before a size was read from a name never mixes base units."""
    own = Item("own", "t", "Fanta lata 350ml", 700, "ml", Decimal(350))
    same = Item("a", "s", "Fanta lata 350 ml", 700, "ml", Decimal(350))
    other = Item("b", "s", "Fanta lata", 99900)
    r = calculate([CalcInput("k", own, (same, other), None)])
    assert r.rows[0].parity_cents == 700
    lone = calculate([CalcInput("k", own, (other,), None)])
    assert lone.rows[0].parity_cents is None


def _cand(sid, distance=None, count=None, terms=()):
    return RankCandidate(sid, distance, count, tuple(terms))


def test_B01_M1_11_score_weights_each_part_and_normalizes_by_their_sum():
    target = ["Lanches", "Hambúrguer"]
    ranked = {
        r.store_id: r
        for r in rank_m1_11(
            [
                _cand("top", 0, 999, ["lanches", "HAMBURGUER"]),
                _cand("half", 1500, 0, ["lanches"]),
                _cand("none"),
            ],
            target,
            3,
        )
    }
    assert ranked["top"].score == 100
    assert ranked["half"].score == Fraction(30, 100) * Fraction(1, 2) * 100 + Fraction(20, 100) * Fraction(1, 2) * 100
    assert ranked["none"].score == 0
    assert [ranked[s].rank for s in ("top", "half", "none")] == [1, 2, 3]
    doubled = rank_m1_11([_cand("a", 1500, None, ["lanches"])], target, 3, RankWeights(100, 60, 40))
    assert doubled[0].score == ranked["half"].score, "weights count by their share"


def test_B01_M1_11_rating_count_is_a_log_scale_over_the_highest_among_candidates():
    ranked = {r.store_id: r for r in rank_m1_11([_cand("a", count=99), _cand("b", count=9)], [], 3)}
    assert ranked["a"].score == 50
    assert float(ranked["b"].score) == pytest.approx(25)


def test_B01_M1_11_works_without_any_rating_count():
    ranked = rank_m1_11([_cand("far", 3000, None, ["x"]), _cand("near", 300, None, ["x"])], ["x"], 3)
    assert [r.store_id for r in ranked] == ["near", "far"]
    assert ranked[0].score == 27 + 20
    assert ranked[1].score == 20


def test_B01_M1_11_distance_is_clamped_and_terms_without_target_say_nothing():
    ranked = {r.store_id: r for r in rank_m1_11([_cand("beyond", 9000, None, ["x"]), _cand("unknown", None)], [], 3)}
    assert ranked["beyond"].score == 0 and ranked["unknown"].score == 0


def test_B01_M1_11_ties_break_by_distance_unknown_last_then_store_id():
    ranked = rank_m1_11(
        [_cand("z", 3000), _cand("b", 3000), _cand("a"), _cand("c", 3000)], [], 3
    )
    assert [r.store_id for r in ranked] == ["b", "c", "z", "a"]
    assert [r.rank for r in ranked] == [1, 2, 3, 4]


def test_B01_M1_11_rating_value_does_not_enter_and_manual_does_not_change_the_rank():
    near = Store("near", "n", "L", None, None, rating_count=10)
    far = Store("far", "f", "L", None, None, rating_count=1000)
    out = Store("out", "o", "L", None, None, is_national_chain=True, rating_count=99999)
    target = Store("t", "t", "L", Decimal("-23.3"), Decimal("-51.1"))
    at = datetime(2026, 11, 7, tzinfo=UTC)
    args = {
        "collected_at": at,
        "settings": Settings(),
        "discovered_m": {"near": 100, "far": 2900, "out": 50},
        "target_terms": ["L"],
    }
    rows = {r.public_store_id: r for r in build_neighborhood(target, [near, far, out], **args)}
    assert rows["out"].capture_rank is None and rows["out"].capture_score is None, "the filters come first"
    assert {rows["near"].capture_rank, rows["far"].capture_rank} == {1, 2}
    manual = {"out": (True, "manual"), "near": (False, "manual: fora")}
    again = {r.public_store_id: r for r in build_neighborhood(target, [near, far, out], manual=manual, **args)}
    assert again["out"].included and again["out"].capture_rank is None, "a manual inclusion does not enter the rank"
    assert not again["near"].included
    assert again["near"].capture_rank == rows["near"].capture_rank, "a manual exclusion does not change it"
