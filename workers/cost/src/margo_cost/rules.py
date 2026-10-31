"""Cost and contribution rules, 04-rules §4 (CST-01 to CST-04, CTB-01, CTB-02, DLV-01).

Pure functions over plain values. Money is integer centavos; prices per base unit (g, ml, un) are Decimal
centavos, as `ingredient_price.price_per_base_unit_cents` (numeric). Every function names its rule ID; C12,
C13, P06 and W01 show the numbers these functions return, never their own arithmetic.

Choices where 04 §4 leaves a gap (listed for Marlon in the M3 report):
  - CST-01 "latest": the most recent invoice date; two confirmed prices on the same day, the higher one.
  - CST-04 "combination": the cost-weighted mean of each line's error, where a line's error is its yield
    error (medido, declarado, estimado) plus `m3.regional_prior_error_pct` when its price is CST-02.
  - CTB-01 "channel take": per order, the channel's share of what it kept in the month's close
    ((gross - payout) / gross of the channel, so commission, payment fee, delivery, promotion and
    anticipation), at the 0,1 percentage point P06 prints ("Recebido 74,5%" takes 25,5%).
  - CTB-01 with a campaign: the price the customer pays (price minus the discount); conservative, as if the
    store paid the whole discount (DIF-03 shows the channel's share does not always come back).
  - CTB-02: the error bar in centavos (error_pct times ingredient cost) is larger than |left|.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

PriceSource = Literal["invoice", "regional_prior"]
YieldConfidence = Literal["medido", "declarado", "estimado"]
DecisionKind = Literal["campaign", "lowest"]

ZERO = Decimal(0)


def cents(value: Decimal) -> int:
    """Half up to the centavo."""
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def frac4(value: Decimal) -> Decimal:
    """numeric(7,4): fractions and percentages at 4 decimals, half up."""
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class CostParams:
    """04 §4 params (rule_param): m3.price_window_days, m3.yield_error_pct.*, m3.regional_prior_error_pct."""

    window_days: int
    yield_error: Mapping[str, Decimal]
    prior_error: Decimal


@dataclass(frozen=True)
class PricePoint:
    """One ingredient price: a confirmed invoice line (CST-01) or a regional prior (CST-02)."""

    price: Decimal
    observed_on: date
    source: PriceSource
    invoice_line_id: str | None = None


def cst01_invoice_price(points: Iterable[PricePoint], as_of: date, params: CostParams) -> PricePoint | None:
    """CST-01: the latest confirmed invoice price in the last `window_days` up to `as_of` (same day: highest).

    Callers pass only prices of confirmed matches (D14: a suggestion never counts).
    """
    start = as_of - timedelta(days=params.window_days)
    fresh = [p for p in points if p.source == "invoice" and start <= p.observed_on <= as_of]
    return max(fresh, key=lambda p: (p.observed_on, p.price), default=None)


def cst02_regional_prior(points: Iterable[PricePoint], as_of: date) -> PricePoint | None:
    """CST-02: the latest regional prior for the ingredient on or before `as_of` ("estimativa regional")."""
    priors = [p for p in points if p.source == "regional_prior" and p.observed_on <= as_of]
    return max(priors, key=lambda p: (p.observed_on, p.price), default=None)


def price_for(points: Sequence[PricePoint], as_of: date, params: CostParams) -> PricePoint | None:
    """CST-01, else CST-02. None: the ingredient has no price (the dish cannot be costed)."""
    return cst01_invoice_price(points, as_of, params) or cst02_regional_prior(points, as_of)


def cst03_line_cost(qty_base_units: Decimal, yield_pct: Decimal, price: Decimal) -> Decimal:
    """CST-03: cost of a recipe line = qty / yield_pct times price per base unit (unrounded centavos)."""
    if yield_pct <= 0:
        raise ValueError("yield_pct must be positive")
    return qty_base_units / yield_pct * price


@dataclass(frozen=True)
class LineCost:
    cost: Decimal
    confidence: YieldConfidence
    regional_prior: bool


def dish_cost_cents(lines: Iterable[LineCost]) -> int:
    """CST-03 summed: ingredient cost of one dish, rounded once at the end."""
    return cents(sum((ln.cost for ln in lines), ZERO))


def cst04_error_pct(lines: Sequence[LineCost], params: CostParams) -> Decimal:
    """CST-04: error bar of a dish, as a fraction (0.0927 is "± 9%").

    Cost-weighted mean of each line's error: its yield error (medido 2%, declarado 5%, estimado 10%) plus
    `prior_error` when the price is a CST-02 regional prior.
    """
    total = sum((ln.cost for ln in lines), ZERO)
    if total == 0:
        return ZERO
    def line_error(ln: LineCost) -> Decimal:
        return params.yield_error[ln.confidence] + (params.prior_error if ln.regional_prior else ZERO)

    weighted = sum((ln.cost * line_error(ln) for ln in lines), ZERO)
    return frac4(weighted / total)


def channel_take_rate(gross_cents: int, payout_cents: int) -> Decimal:
    """CTB-01 channel take rate: (gross - payout) / gross of the channel in the close, at 0,1 point."""
    if gross_cents == 0:
        return ZERO
    return (Decimal(gross_cents - payout_cents) / Decimal(gross_cents)).quantize(
        Decimal("0.001"), rounding=ROUND_HALF_UP
    )


def channel_take_cents(price_cents: int, rate: Decimal) -> int:
    """CTB-01: what the channel takes from one order of the dish."""
    return cents(Decimal(price_cents) * rate)


def campaign_price_cents(price_cents: int, discount_pct: Decimal) -> int:
    """CTB-01 with a campaign: the price after the discount (the store pays it all, conservative)."""
    return cents(Decimal(price_cents) * (1 - discount_pct))


def ctb01_left_cents(
    price_cents: int, take_cents: int, ingredient_cents: int, packaging_cents: int = 0
) -> int:
    """CTB-01: contribution per order = price - channel take - ingredient cost - packaging."""
    return price_cents - take_cents - ingredient_cents - packaging_cents


def left_pct(left_cents: int, price_cents: int) -> Decimal | None:
    """C13 "% do preço" of CTB-01."""
    if price_cents == 0:
        return None
    return frac4(Decimal(left_cents) / Decimal(price_cents))


def ctb02_can_invert(error_pct: Decimal, ingredient_cents: int, left_cents: int) -> bool:
    """CTB-02: the row "can invert" when the error bar, in centavos, is larger than the contribution."""
    return error_pct * ingredient_cents > abs(left_cents)


@dataclass(frozen=True)
class RowEconomics:
    """One C13 row as DLV-01 sees it."""

    menu_item_id: str
    name: str
    channel: str
    top20_rank: int | None
    campaign_name: str | None
    campaign_discount_pct: Decimal | None
    left_cents: int
    #: Same dish and channel without the campaign (campaign rows only).
    base_left_cents: int | None
    units: int


@dataclass(frozen=True)
class Decision:
    kind: DecisionKind
    menu_item_id: str
    channel: str
    campaign_name: str | None
    campaign_discount_pct: Decimal | None
    left_cents: int
    base_left_cents: int | None


def dlv01_decision(rows: Sequence[RowEconomics]) -> Decision | None:
    """DLV-01: "one decision for the month".

    The top-20 dish with the largest drop in contribution caused by an active campaign; else the top-20 dish
    with the lowest positive contribution. Ties: more units sold, then name. None when neither exists.
    """
    top = [r for r in rows if r.top20_rank is not None]
    drops = [
        r
        for r in top
        if r.campaign_name is not None and r.base_left_cents is not None and r.base_left_cents > r.left_cents
    ]
    if drops:
        r = max(drops, key=lambda r: (r.base_left_cents - r.left_cents, r.units, r.name))  # type: ignore[operator]
        return Decision("campaign", r.menu_item_id, r.channel, r.campaign_name, r.campaign_discount_pct,
                        r.left_cents, r.base_left_cents)
    positive = [r for r in top if r.campaign_name is None and r.left_cents > 0]
    if not positive:
        return None
    r = min(positive, key=lambda r: (r.left_cents, -r.units, r.name))
    return Decision("lowest", r.menu_item_id, r.channel, None, None, r.left_cents, None)
