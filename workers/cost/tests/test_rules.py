"""CST-01 to CST-04, CTB-01, CTB-02, DLV-01 (04 §4) as pure functions, against the drawn G-SYN numbers."""

from __future__ import annotations

from datetime import date
from decimal import Decimal as D

import pytest
from margo_cost.rules import (
    ChannelShares,
    CostParams,
    LineCost,
    PricePoint,
    RowEconomics,
    campaign_discount_cents,
    cst01_invoice_price,
    cst02_regional_prior,
    cst03_line_cost,
    cst04_error_pct,
    ctb01_channel_shares,
    ctb01_channel_take_cents,
    ctb01_left_cents,
    ctb02_can_invert,
    dish_cost_cents,
    dlv01_decision,
    left_pct,
    price_for,
)

AS_OF = date(2026, 10, 30)
PARAMS = CostParams(
    window_days=90,
    yield_error={"medido": D("0.02"), "declarado": D("0.05"), "estimado": D("0.10")},
    prior_error=D("0.30"),
)


def inv(price: str, day: date, line: str = "l") -> PricePoint:
    return PricePoint(D(price), day, "invoice", line)


def prior(price: str, day: date = date(2026, 10, 1)) -> PricePoint:
    return PricePoint(D(price), day, "regional_prior", None)


def test_cst01_latest_confirmed_price_in_window() -> None:
    points = [inv("3.70", date(2026, 9, 2), "a"), inv("3.89", date(2026, 10, 12), "b"), prior("4.10")]
    assert cst01_invoice_price(points, AS_OF, PARAMS) == points[1]


def test_cst01_ignores_prices_after_as_of_and_older_than_window() -> None:
    assert cst01_invoice_price([inv("3.89", date(2026, 10, 31))], AS_OF, PARAMS) is None
    # 90 days before 30/out is 01/ago: inside; 31/jul is outside.
    assert cst01_invoice_price([inv("1", date(2026, 8, 1))], AS_OF, PARAMS) is not None
    assert cst01_invoice_price([inv("1", date(2026, 7, 31))], AS_OF, PARAMS) is None


def test_cst01_same_day_takes_the_higher_price() -> None:
    a, b = inv("1.10", date(2026, 10, 5), "a"), inv("1.15", date(2026, 10, 5), "b")
    assert cst01_invoice_price([a, b], AS_OF, PARAMS) == b


def test_cst02_regional_prior_only_without_invoice_in_window() -> None:
    old = inv("4.20", date(2026, 6, 15))
    p = prior("4.60")
    assert price_for([old, p], AS_OF, PARAMS) == p
    assert cst02_regional_prior([old, p], AS_OF) == p
    fresh = inv("4.40", date(2026, 10, 1))
    assert price_for([old, p, fresh], AS_OF, PARAMS) == fresh
    assert price_for([old], AS_OF, PARAMS) is None


def test_cst03_yield_adjusted_line_cost_matches_c12() -> None:
    # C12 X-Bacon: blend 160 g at 85%, R$ 38,90/kg -> R$ 7,32; cheddar 28 g, R$ 52,10/kg -> R$ 1,46.
    assert round(cst03_line_cost(D(160), D("0.85"), D("3.89")), 2) == D("732.24")
    assert cst03_line_cost(D(28), D(1), D("5.21")) == D("145.88")
    with pytest.raises(ValueError):
        cst03_line_cost(D(1), D(0), D(1))


XBACON = [
    LineCost(D(160) / D("0.85") * D("3.89"), "declarado", False),  # blend, nota 12/out
    LineCost(D("145.88"), "medido", False),  # cheddar, nota 30/set
    LineCost(D("138.00"), "medido", True),  # bacon, estimativa regional
    LineCost(D("115.00"), "medido", False),  # pão brioche, nota 05/out
    LineCost(D("22.60"), "medido", False),  # maionese, nota 18/set
    LineCost(D("90.00"), "medido", True),  # embalagem kraft, estimativa regional
]


def test_D03_cst04_xbacon_cost_and_error_bar_as_drawn() -> None:
    assert dish_cost_cents(XBACON) == 1244  # C12 "custo R$ 12,44"
    err = cst04_error_pct(XBACON, PARAMS)
    assert err == D("0.0927")
    assert round(err * 100) == 9  # "± 9%"


def test_cst04_regional_prior_widens_the_error_bar() -> None:
    from_invoices = [LineCost(c.cost, c.confidence, False) for c in XBACON]
    assert cst04_error_pct(XBACON, PARAMS) > cst04_error_pct(from_invoices, PARAMS)
    assert cst04_error_pct([], PARAMS) == 0


def test_D03_ctb01_channel_shares_are_commission_and_payment_fee_only() -> None:
    # C08 September close, iFood: gross 92.400, commission 11.088, payment fee 2.957 (delivery 4.620 and
    # anticipation 1.210 are not part of CTB-01's take); 99Food: 18.600, 1.674 and 595.
    ifood = ctb01_channel_shares(9_240_000, -1_108_800, -295_700)
    f99 = ctb01_channel_shares(1_860_000, -167_400, -59_500)
    assert ifood == ChannelShares(D("0.120"), D("0.032"))
    assert f99 == ChannelShares(D("0.090"), D("0.032"))
    assert ctb01_channel_shares(0, 0, 0) == ChannelShares(D(0), D(0))


def test_D03_ctb01_channel_take_without_campaign() -> None:
    ifood = ChannelShares(D("0.120"), D("0.032"))
    f99 = ChannelShares(D("0.090"), D("0.032"))
    assert [ctb01_channel_take_cents(p, ifood) for p in (3690, 7990, 1490, 500)] == [561, 1214, 226, 76]
    assert ctb01_channel_take_cents(3690, f99) == 450


def test_D03_ctb01_coupon_take_uses_the_m2_funding_split() -> None:
    """REP-04 split: commission on the menu price, payment fee on what the customer pays, and only the store's
    share (1 - channel_share_pct) of the discount."""
    ifood = ChannelShares(D("0.120"), D("0.032"))
    discount = campaign_discount_cents(7990, D("0.20"))
    assert discount == 1598
    # 958,80 commission + 204,54 payment fee on 63,92 + 799,00 store half of the coupon
    assert ctb01_channel_take_cents(7990, ifood, discount, D("0.50")) == 1962
    # A store-funded promotion (channel_share_pct 0) puts the whole discount in the take.
    assert ctb01_channel_take_cents(7990, ifood, discount, D("0")) == 2761


def test_D03_ctb01_left_and_pct() -> None:
    assert ctb01_left_cents(3690, 561, 1244, 0) == 1885
    assert ctb01_left_cents(7990, 1214, 3180) == 3596
    assert ctb01_left_cents(7990, 1962, 3180) == 2848
    assert left_pct(1885, 3690) == D("0.5108")
    assert left_pct(0, 0) is None


def test_ctb02_can_invert_when_error_bar_is_larger_than_left() -> None:
    assert not ctb02_can_invert(D("0.0927"), 1244, 1505)
    assert ctb02_can_invert(D("0.10"), 1000, 99)
    assert ctb02_can_invert(D("0.10"), 1000, -50)
    assert not ctb02_can_invert(D("0.10"), 1000, 100)


def row(item: str, left: int, *, rank: int | None = 1, campaign: str | None = None, base: int | None = None,
        units: int = 10, channel: str = "ifood") -> RowEconomics:
    return RowEconomics(item, item, channel, rank, campaign, D("0.20") if campaign else None, left, base, units)


def test_dlv01_picks_the_largest_campaign_drop() -> None:
    rows = [
        row("xb", 1505), row("combo", 2773, rank=4),
        row("combo", 1582, rank=4, campaign="Cupom", base=2773),
        row("batata", 800, rank=3, campaign="Cupom", base=1100),
        row("refri", 87, rank=8),
    ]
    d = dlv01_decision(rows)
    assert d is not None and (d.kind, d.menu_item_id, d.left_cents, d.base_left_cents) == ("campaign", "combo", 1582, 2773)


def test_dlv01_campaign_must_be_on_a_top20_dish() -> None:
    rows = [row("xb", 1505), row("refri", 87, rank=8), row("x", 100, rank=None, campaign="C", base=900)]
    d = dlv01_decision(rows)
    assert d is not None and (d.kind, d.menu_item_id, d.left_cents) == ("lowest", "refri", 87)


def test_dlv01_lowest_positive_ignores_negative_rows_and_empty() -> None:
    rows = [row("xb", 1505), row("loss", -20, rank=2), row("refri", 87, rank=8, channel="food99")]
    d = dlv01_decision(rows)
    assert d is not None and (d.menu_item_id, d.channel) == ("refri", "food99")
    assert dlv01_decision([row("loss", -20)]) is None


def test_p06_rows_best_seller_then_decision_then_lowest() -> None:
    from margo_cost.compute import P06Row, p06_rows
    from margo_cost.rules import Decision

    xb_if = P06Row("xb", "ifood", None, None, 913, 3690, 1505)
    xb_99 = P06Row("xb", "food99", None, None, 178, 3690, 1627)
    combo = P06Row("combo", "ifood", None, None, 30, 7990, 2773)
    coupon = P06Row("combo", "ifood", "Cupom", D("0.20"), 0, 6392, 1582)
    refri = P06Row("refri", "ifood", None, None, 605, 500, 87)
    batata = P06Row("batata", "ifood", None, None, 352, 1490, 800)
    d = Decision("campaign", "combo", "ifood", "Cupom", D("0.20"), 1582, 2773)
    # P06 as drawn: X-Bacon 99Food, X-Bacon iFood, Combo casal com cupom, Refrigerante lata.
    assert p06_rows([xb_if, xb_99, combo, coupon, refri, batata], d) == [xb_99, xb_if, coupon, refri]
    low = Decision("lowest", "refri", "ifood", None, None, 87, None)
    assert p06_rows([xb_if, refri, batata], low) == [xb_if, refri]
    assert p06_rows([], None) == []


def test_top_ingredient_coverage_counts_the_heaviest() -> None:
    from margo_cost.compute import IngredientUse, top_ingredient_coverage

    uses = [IngredientUse("blend", D(732), 10, "invoice"), IngredientUse("bacon", D(138), 10, "regional_prior"),
            IngredientUse("sal", D(1), 1, "invoice"), IngredientUse("x", None, 5, None)]
    assert top_ingredient_coverage(uses, 2) == (1, 1, 0)
    assert top_ingredient_coverage(uses, 20) == (2, 1, 1)
