"""B01, M1-05 to M1-08 "dual parity" (Marlon, 07/nov) on synthetic rows, no database: promotions are evaluated at
the current price and at the full price, and the reading takes the more cautious one. The seed has no promotion."""

from __future__ import annotations

from dataclasses import replace
from fractions import Fraction

from margo_collector.rules import (
    Item,
    full_price_m1_05,
    full_price_room_m1_07,
    gap_m1_06,
    loss_m1_08,
    pareto_m1_08,
    parity_full_m1_05,
    parity_m1_05,
    reading_m1_07,
)
from margo_collector.xray import CalcInput, CalcRow, calculate


def own(price: int, full: int | None = None, **kw) -> Item:
    return Item("o", "s0", "Hambúrguer", price, full_price_cents=full, **kw)


def neighbors(price: int, full: int | None = None, n: int = 5, **kw) -> tuple[Item, ...]:
    return tuple(Item(f"n{i}", f"s{i + 1}", "Hambúrguer", price, full_price_cents=full, **kw) for i in range(n))


def one(own_item: Item, accepted: tuple[Item, ...], weekly: int | None = None) -> CalcRow:
    return calculate([CalcInput("k", own_item, accepted, weekly)]).rows[0]


def test_B01_M1_05_full_price_is_the_original_when_present_else_the_current():
    assert full_price_m1_05(own(1000, 1500)) == 1500
    assert full_price_m1_05(own(1000)) == 1000
    assert full_price_m1_05(own(1000, 0)) == 1000, "a zero original is no price"


def test_B01_M1_05_full_parity_compares_like_with_like_after_M1_03_normalization():
    o = Item("o", "s0", "Batata", 1000, unit="g", unit_qty=200, full_price_cents=1200)
    pool = (
        Item("a", "s1", "Batata", 1600, unit="g", unit_qty=400, full_price_cents=2400),
        Item("b", "s2", "Batata", 800, unit="g", unit_qty=200),
    )
    assert parity_m1_05(o, pool) == 800, "per gram: 4 and 4, for 200 g"
    assert parity_full_m1_05(o, pool) == 1000, "per gram: 6 and 4, median 5, for 200 g"
    assert parity_full_m1_05(o, ()) is None


def test_B01_M1_07_the_reading_takes_the_more_cautious_gap_at_the_band_edges():
    band = Fraction(1, 10)
    low, high, mid = Fraction(-1, 10), Fraction(1, 10), Fraction(-99, 1000)
    assert reading_m1_07(low, band, gap_full=low) == "pode_subir"
    assert reading_m1_07(low, band, gap_full=mid) == "na_media"
    assert reading_m1_07(mid, band, gap_full=low) == "na_media"
    assert reading_m1_07(low, band, gap_full=high) == "nao_mexer"
    assert reading_m1_07(high, band, gap_full=low) == "nao_mexer"
    assert reading_m1_07(low, band) == "pode_subir", "without a full gap, the current one alone"
    assert full_price_room_m1_07("na_media", low, band) is True
    assert full_price_room_m1_07("na_media", mid, band) is False
    assert full_price_room_m1_07("pode_subir", low, band) is False
    assert full_price_room_m1_07("nao_mexer", low, band) is False
    assert full_price_room_m1_07("na_media", None, band) is False


def test_B01_M1_07_case_1_agreement_both_gaps_low_is_pode_subir():
    r = one(own(1000), neighbors(1300, 1500))
    assert (r.parity_cents, r.parity_full_cents) == (1300, 1500)
    assert r.gap == Fraction(-300, 1300)
    assert r.gap_full == Fraction(-500, 1500)
    assert r.reading == "pode_subir"
    assert r.full_price_room is False


def test_B01_M1_07_case_2_current_near_parity_full_low_is_na_media_with_the_note():
    r = one(own(1000), neighbors(1050, 1300))
    assert (r.parity_cents, r.parity_full_cents) == (1050, 1300)
    assert r.reading == "na_media"
    assert r.full_price_room is True


def test_B01_M1_07_case_3_either_gap_high_is_nao_mexer():
    current_low_full_high = one(own(1000, 1500), neighbors(1300))
    assert current_low_full_high.gap < -Fraction(1, 10) and current_low_full_high.gap_full > Fraction(1, 10)
    assert current_low_full_high.reading == "nao_mexer"
    current_high_full_low = one(own(1200), neighbors(1000, 1500))
    assert current_high_full_low.gap > Fraction(1, 10) and current_high_full_low.gap_full < -Fraction(1, 10)
    assert current_high_full_low.reading == "nao_mexer"
    assert current_high_full_low.full_price_room is False


def test_B01_M1_05_case_4_no_promotion_anywhere_gives_todays_results():
    menu = [(500, 650), (1490, 1840), (2990, 3050), (3690, 3150), (7990, 6990)]
    rows = calculate(
        [
            CalcInput(f"k{i}", replace(own(o), id=f"o{i}"), neighbors(p), 10)
            for i, (o, p) in enumerate(menu)
        ]
    ).rows
    for (o, p), r in zip(menu, rows, strict=True):
        assert (r.parity_cents, r.parity_full_cents) == (p, p)
        assert r.gap == r.gap_full == gap_m1_06(o, p)
        assert r.reading == reading_m1_07(gap_m1_06(o, p))
        assert r.loss_cents == loss_m1_08(p, o, 10)
        assert r.full_price_room is False
    assert [r.reading for r in rows] == ["pode_subir", "pode_subir", "na_media", "nao_mexer", "nao_mexer"]


def test_B01_M1_07_case_5_own_store_on_promotion():
    still_low = one(own(900, 1000), neighbors(1300))
    assert still_low.parity_cents == still_low.parity_full_cents == 1300
    assert still_low.gap == Fraction(-400, 1300)
    assert still_low.gap_full == Fraction(-300, 1300)
    assert still_low.reading == "pode_subir"
    near_parity_at_full = one(own(1000, 1300), neighbors(1300))
    assert near_parity_at_full.gap_full == 0
    assert near_parity_at_full.reading == "na_media", "the current gap alone would say pode_subir"
    assert near_parity_at_full.full_price_room is False


def test_B01_M1_08_case_6_loss_and_pareto_use_the_current_parity_only():
    r = one(own(1000), neighbors(1050, 1300), weekly=10)
    assert r.loss_cents == 500, "(1050 - 1000) x 10, never (1300 - 1000) x 10"
    promo = CalcInput("a", replace(own(1000), id="a"), neighbors(1050, 9000), 10)
    plain = CalcInput("b", replace(own(1000), id="b", name="Batata"), neighbors(1200), 1)
    result = calculate([promo, plain])
    assert result.total_loss_cents == 700
    assert [(x.key, x.pareto_rank) for x in result.rows] == [("a", 1), ("b", 2)]
    expected = pareto_m1_08({"a": ("Hambúrguer", 500), "b": ("Batata", 200)}, 2)
    assert [x.cum_share for x in expected.rows] == [x.pareto_cum_share for x in result.rows]
