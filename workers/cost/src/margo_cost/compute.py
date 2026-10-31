"""Contribution of one close period from its inputs (04 §4), pure.

Inputs are what the database holds for the close: ready recipes and their lines, ingredient prices (only
confirmed invoice lines and regional priors, D14), packaging per dish and channel, campaigns with the dishes
they discount, the dishes sold in the month (order_item_fact of concluded orders) and the close lines per
channel. Outputs are the rows worker-cost writes: recipe and line costs (C12), contribution rows (C13, P06),
insumos per store (W01) and the month's decision (DLV-01).

How sold lines meet the rules (choices listed for Marlon):
  - A sold line is a dish when its external item id is the dish's id on that channel
    (menu_item.channel_item_ids), else when its name equals the dish name in the store's brand.
  - Price of a dish on a channel: the most common unit price of the month's lines without campaign
    (ties: the higher), as the menu price; modifiers do not change it.
  - A line belongs to a campaign when the store ran it that day, the order carried a store discount and the
    campaign lists the dish (campaign_item). A campaign active in the month gives each dish it lists a row
    on its channel, even before a unit sold with it (DLV-01 compares the contribution per order).
  - Rows: every dish with a ready recipe sold in the month, per channel, plus one row per campaign.
    Order: the top-20 list (C12), then units of the dish, then channel, the row without campaign first.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from .rules import (
    CostParams,
    Decision,
    LineCost,
    PricePoint,
    RowEconomics,
    YieldConfidence,
    campaign_price_cents,
    channel_take_cents,
    channel_take_rate,
    cst03_line_cost,
    cst04_error_pct,
    ctb01_left_cents,
    ctb02_can_invert,
    dish_cost_cents,
    dlv01_decision,
    left_pct,
    price_for,
)

CHANNEL_ORDER = ("ifood", "food99", "keeta", "rappi")


@dataclass(frozen=True)
class MenuItem:
    id: str
    name: str
    brand_id: str
    top20_rank: int | None = None
    #: channel -> the dish's item id on that channel.
    channel_item_ids: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class RecipeLineIn:
    id: str
    ingredient_id: str
    qty_base_units: Decimal
    yield_pct: Decimal
    confidence: YieldConfidence


@dataclass(frozen=True)
class RecipeIn:
    id: str
    menu_item_id: str
    lines: Sequence[RecipeLineIn]


@dataclass(frozen=True)
class StoreIn:
    id: str
    channel: str
    brand_id: str | None


@dataclass(frozen=True)
class CampaignIn:
    id: str
    store_id: str
    name: str
    discount_pct: Decimal
    starts_on: date
    ends_on: date
    item_ids: frozenset[str]


@dataclass(frozen=True)
class SoldLine:
    store_id: str
    ordered_on: date
    store_discount: bool
    item_name: str
    external_item_id: str | None
    qty: int
    unit_price_cents: int


@dataclass(frozen=True)
class CloseInputs:
    #: First day of the close month.
    month: date
    as_of: date
    stores: Sequence[StoreIn]
    items: Sequence[MenuItem]
    recipes: Sequence[RecipeIn]
    prices: Mapping[str, Sequence[PricePoint]]
    packaging: Mapping[tuple[str, str], int]
    campaigns: Sequence[CampaignIn]
    sold: Sequence[SoldLine]
    #: channel -> (gross, payout) of the close lines.
    channel_close: Mapping[str, tuple[int, int]]


@dataclass(frozen=True)
class LineResult:
    line_id: str
    price: PricePoint | None
    cost: Decimal | None


@dataclass(frozen=True)
class RecipeResult:
    recipe_id: str
    menu_item_id: str
    #: None when an ingredient has no price at all (neither CST-01 nor CST-02).
    cost_cents: int | None
    error_pct: Decimal | None
    lines: Sequence[LineResult]


@dataclass(frozen=True)
class ContributionRow:
    menu_item_id: str
    channel: str
    campaign_name: str | None
    campaign_discount_pct: Decimal | None
    units: int
    price_cents: int
    channel_take_cents: int
    ingredient_cents: int
    packaging_cents: int
    ingredient_error_pct: Decimal
    left_cents: int
    left_pct: Decimal | None
    can_invert: bool


@dataclass(frozen=True)
class StoreCost:
    store_id: str
    units: int
    uncovered_units: int
    ingredient_cents: int
    packaging_cents: int


@dataclass(frozen=True)
class CloseResult:
    recipes: Sequence[RecipeResult]
    rows: Sequence[ContributionRow]
    store_costs: Sequence[StoreCost]
    decision: Decision | None


def cost_recipe(recipe: RecipeIn, prices: Mapping[str, Sequence[PricePoint]], as_of: date,
                params: CostParams) -> RecipeResult:
    """CST-01 or CST-02 per line, CST-03 line cost, CST-04 error bar of the dish (C12)."""
    results: list[LineResult] = []
    costs: list[LineCost] = []
    for ln in recipe.lines:
        p = price_for(prices.get(ln.ingredient_id, ()), as_of, params)
        if p is None:
            results.append(LineResult(ln.id, None, None))
            continue
        c = cst03_line_cost(ln.qty_base_units, ln.yield_pct, p.price)
        results.append(LineResult(ln.id, p, c))
        costs.append(LineCost(c, ln.confidence, p.source == "regional_prior"))
    if len(costs) < len(recipe.lines) or not costs:
        return RecipeResult(recipe.id, recipe.menu_item_id, None, None, results)
    return RecipeResult(
        recipe.id, recipe.menu_item_id, dish_cost_cents(costs), cst04_error_pct(costs, params), results
    )


def _match_item(line: SoldLine, store: StoreIn, items: Sequence[MenuItem]) -> MenuItem | None:
    brand_items = [i for i in items if i.brand_id == store.brand_id]
    if line.external_item_id:
        for i in brand_items:
            if i.channel_item_ids.get(store.channel) == line.external_item_id:
                return i
    name = line.item_name.strip().casefold()
    return next((i for i in brand_items if i.name.strip().casefold() == name), None)


def _campaign_for(line: SoldLine, item_id: str, campaigns: Sequence[CampaignIn]) -> CampaignIn | None:
    if not line.store_discount:
        return None
    return next(
        (
            c
            for c in campaigns
            if c.store_id == line.store_id
            and c.starts_on <= line.ordered_on <= c.ends_on
            and item_id in c.item_ids
        ),
        None,
    )


def compute_close(inputs: CloseInputs, params: CostParams) -> CloseResult:
    """CST-01 to CST-04, CTB-01, CTB-02, DLV-01 for one close period."""
    recipes = [cost_recipe(r, inputs.prices, inputs.as_of, params) for r in inputs.recipes]
    dish_cost = {r.menu_item_id: r for r in recipes if r.cost_cents is not None}
    stores = {s.id: s for s in inputs.stores}
    items = {i.id: i for i in inputs.items}
    rates = {ch: channel_take_rate(g, p) for ch, (g, p) in inputs.channel_close.items()}

    Key = tuple[str, str, str | None, Decimal | None]
    units: Counter[Key] = Counter()
    base_prices: dict[tuple[str, str], Counter[int]] = defaultdict(Counter)
    any_prices: dict[tuple[str, str], Counter[int]] = defaultdict(Counter)
    store_units: Counter[str] = Counter()
    store_uncovered: Counter[str] = Counter()
    store_ingredient: Counter[str] = Counter()
    store_packaging: Counter[str] = Counter()

    for line in inputs.sold:
        store = stores.get(line.store_id)
        if store is None:
            continue
        store_units[store.id] += line.qty
        item = _match_item(line, store, inputs.items)
        if item is None or item.id not in dish_cost:
            store_uncovered[store.id] += line.qty
            continue
        recipe = dish_cost[item.id]
        assert recipe.cost_cents is not None
        store_ingredient[store.id] += line.qty * recipe.cost_cents
        store_packaging[store.id] += line.qty * inputs.packaging.get((item.id, store.channel), 0)
        camp = _campaign_for(line, item.id, inputs.campaigns)
        key: Key = (item.id, store.channel, camp.name if camp else None, camp.discount_pct if camp else None)
        units[key] += line.qty
        any_prices[(item.id, store.channel)][line.unit_price_cents] += line.qty
        if camp is None:
            base_prices[(item.id, store.channel)][line.unit_price_cents] += line.qty

    def menu_price(item_id: str, channel: str) -> int:
        counter = base_prices.get((item_id, channel)) or any_prices[(item_id, channel)]
        return max(counter.items(), key=lambda kv: (kv[1], kv[0]))[0]

    def economics(item_id: str, channel: str, price: int) -> tuple[int, int, int, int]:
        recipe = dish_cost[item_id]
        assert recipe.cost_cents is not None
        take = channel_take_cents(price, rates.get(channel, Decimal(0)))
        packaging = inputs.packaging.get((item_id, channel), 0)
        return take, recipe.cost_cents, packaging, ctb01_left_cents(price, take, recipe.cost_cents, packaging)

    # A campaign active in the month gives its dishes a row on its channel even with no unit sold yet:
    # DLV-01 weighs the drop per order, which needs the price, not the units.
    month_end = date(inputs.month.year + inputs.month.month // 12, inputs.month.month % 12 + 1, 1)
    for c in inputs.campaigns:
        store = stores.get(c.store_id)
        if store is None or c.starts_on >= month_end or c.ends_on < inputs.month:
            continue
        for item_id in c.item_ids:
            if item_id in dish_cost and (item_id, store.channel) in any_prices:
                units[(item_id, store.channel, c.name, c.discount_pct)] += 0

    item_units: Counter[str] = Counter()
    for (item_id, _, _, _), n in units.items():
        item_units[item_id] += n

    rows: list[ContributionRow] = []
    econ: list[RowEconomics] = []
    for (item_id, channel, camp_name, camp_pct), n in units.items():
        list_price = menu_price(item_id, channel)
        price = campaign_price_cents(list_price, camp_pct) if camp_pct is not None else list_price
        take, ingredient, packaging, left = economics(item_id, channel, price)
        err = dish_cost[item_id].error_pct
        assert err is not None
        rows.append(
            ContributionRow(
                item_id, channel, camp_name, camp_pct, n, price, take, ingredient, packaging, err, left,
                left_pct(left, price), ctb02_can_invert(err, ingredient, left),
            )
        )
        base_left = economics(item_id, channel, list_price)[3] if camp_pct is not None else None
        it = items[item_id]
        econ.append(
            RowEconomics(item_id, it.name, channel, it.top20_rank, camp_name, camp_pct, left, base_left, n)
        )

    rows.sort(
        key=lambda r: (
            items[r.menu_item_id].top20_rank or 99,
            -item_units[r.menu_item_id],
            items[r.menu_item_id].name,
            CHANNEL_ORDER.index(r.channel) if r.channel in CHANNEL_ORDER else 99,
            r.campaign_name is not None,
            r.campaign_name or "",
        )
    )
    store_costs = [
        StoreCost(sid, store_units[sid], store_uncovered[sid], store_ingredient[sid], store_packaging[sid])
        for sid in sorted(store_units)
    ]
    return CloseResult(recipes, rows, store_costs, dlv01_decision(econ))


def ingredient_coverage(recipes: Sequence[RecipeResult], recipe_lines: Mapping[str, str],
                        units_by_item: Mapping[str, int], top_n: int) -> tuple[int, int, int]:
    """P06 and C10 "N de 20": of the `top_n` insumos that weigh most in the cost of the dishes sold
    (line cost times units of the dish), how many have a CST-01 invoice price, a CST-02 regional prior, none.

    `recipe_lines` maps a recipe line id to its ingredient id.
    """
    weight: Counter[str] = Counter()
    source: dict[str, str | None] = {}
    for r in recipes:
        n = units_by_item.get(r.menu_item_id, 0)
        for ln in r.lines:
            ing = recipe_lines[ln.line_id]
            weight[ing] += (ln.cost or Decimal(0)) * n  # type: ignore[assignment]
            src = ln.price.source if ln.price else None
            if source.get(ing) != "invoice":
                source[ing] = src
    ranked = sorted(weight, key=lambda i: (-weight[i], i))[:top_n]
    invoice = sum(1 for i in ranked if source[i] == "invoice")
    prior = sum(1 for i in ranked if source[i] == "regional_prior")
    return invoice, prior, len(ranked) - invoice - prior
