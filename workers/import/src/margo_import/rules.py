"""Expected payout (REP-01 to REP-05) and differences (DIF-01 to DIF-05), 04-rules §2.

Pure functions over canonical rows. Every function names its rule ID; screens and the claim text
carry the same IDs (D16). The list of difference types is open (D16): only the five of 04 §2 exist.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

Confidence = Literal["certa", "provavel", "duvidosa"]
DeliveryModel = Literal["canal", "loja"]

# Close columns (C08) and the ledger types summed into each.
CLOSE_COLUMNS: dict[str, tuple[str, ...]] = {
    "commission": ("commission",),
    "payment": ("payment_fee",),
    "delivery": ("delivery",),
    "promotion": ("promotion", "subsidy"),
    "anticipation": ("anticipation",),
    "payout": ("payout",),
}


def cents(value: Decimal) -> int:
    """Half-up to the centavo."""
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Terms:
    commission_pct: Decimal
    payment_fee_pct: Decimal
    delivery_model: DeliveryModel
    valid_from: date = date(2000, 1, 1)
    valid_to: date | None = None

    def covers(self, day: date) -> bool:
        return self.valid_from <= day and (self.valid_to is None or day <= self.valid_to)


@dataclass(frozen=True)
class Campaign:
    id: str
    store_id: str
    discount_pct: Decimal
    channel_share_pct: Decimal
    starts_on: date
    ends_on: date

    def covers(self, day: date) -> bool:
        return self.starts_on <= day <= self.ends_on


@dataclass(frozen=True)
class Order:
    id: str
    store_id: str
    external_id: str
    ordered_on: date
    gross_cents: int
    items_cents: int
    delivery_fee_cents: int = 0
    discount_store_cents: int = 0
    discount_channel_cents: int = 0
    status: Literal["concluido", "cancelado"] = "concluido"
    cancelled_by: Literal["loja", "cliente", "canal"] | None = None
    cancel_reason: str | None = None

    @property
    def discount_cents(self) -> int:
        return self.discount_store_cents + self.discount_channel_cents


@dataclass(frozen=True)
class Entry:
    id: str
    store_id: str
    order_id: str | None
    entry_date: date
    type: str
    amount_cents: int
    expected_payment_date: date | None = None


# REP ------------------------------------------------------------------------------------------------


def rep01_commission(order: Order, terms: Terms) -> int:
    """REP-01: commission_pct on items, or on items plus delivery when the store delivers."""
    base = order.items_cents + (order.delivery_fee_cents if terms.delivery_model == "loja" else 0)
    return cents(terms.commission_pct * base)


def rep02_payment_fee(order: Order, terms: Terms) -> int:
    """REP-02: payment_fee_pct on the amount paid online (gross minus every discount)."""
    return cents(terms.payment_fee_pct * (order.gross_cents - order.discount_cents))


def rep03_delivery(order: Order, terms: Terms) -> int:
    """REP-03: in channel-delivery plans the delivery fee belongs to the channel; store delivery passes it."""
    return order.delivery_fee_cents if terms.delivery_model == "canal" else 0


def campaign_for(order: Order, campaigns: Iterable[Campaign]) -> Campaign | None:
    """REP-04: the campaign in force for the order's store and day whose discount fits the order best."""
    live = [c for c in campaigns if c.store_id == order.store_id and c.covers(order.ordered_on)]
    if not live:
        return None
    return min(live, key=lambda c: abs(cents(c.discount_pct * order.items_cents) - order.discount_cents))


def rep04_store_promotion(order: Order, campaign: Campaign | None) -> int:
    """REP-04: the store pays 1 - channel_share_pct of the discount; no campaign, no agreed store share."""
    if campaign is None or order.discount_cents == 0:
        return 0
    return cents((1 - campaign.channel_share_pct) * order.discount_cents)


def rep05_expected_payout(order: Order, terms: Terms, campaign: Campaign | None) -> int:
    """REP-05: gross - REP-01 - REP-02 - store share of REP-04 - REP-03 (when the channel delivers)."""
    return (
        order.gross_cents
        - rep01_commission(order, terms)
        - rep02_payment_fee(order, terms)
        - rep04_store_promotion(order, campaign)
        - rep03_delivery(order, terms)
    )


# Differences ----------------------------------------------------------------------------------------


@dataclass
class Finding:
    rule_id: str
    finding_key: str
    store_id: str
    confidence: Confidence
    description: str
    short: str
    orders: list[tuple[str, int]] = field(default_factory=list)
    detail: dict[str, object] = field(default_factory=dict)

    @property
    def amount_cents(self) -> int:
        return sum(a for _, a in self.orders)

    @property
    def orders_count(self) -> int:
        return len(self.orders)


@dataclass(frozen=True)
class Params:
    """04 params (table rule_param)."""

    min_shown_cents: int = 500
    dif04_grace_days: int = 7
    rounding_tolerance_cents: int = 1


@dataclass
class StoreFacts:
    store_id: str
    channel: str
    terms: Sequence[Terms]
    campaigns: Sequence[Campaign]
    orders: Sequence[Order]
    entries_by_order: dict[str, list[Entry]]

    def terms_on(self, day: date) -> Terms | None:
        live = [t for t in self.terms if t.covers(day)]
        return max(live, key=lambda t: t.valid_from) if live else None

    def charged(self, order: Order, *types: str) -> int:
        """What the store was charged for these types: minus the signed sum of the order's entries."""
        return -sum(e.amount_cents for e in self.entries_by_order.get(order.id, []) if e.type in types)

    def paid(self, order: Order) -> int:
        return sum(e.amount_cents for e in self.entries_by_order.get(order.id, []) if e.type == "payout")


CHANNEL_NAME = {"ifood": "iFood", "food99": "99Food", "keeta": "Keeta", "rappi": "Rappi"}


def _pct(x: Decimal) -> str:
    q = (x * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return f"{q:f}".rstrip("0").rstrip(".").replace(".", ",")


def dif01_commission_above_contract(f: StoreFacts, p: Params) -> list[Finding]:
    """DIF-01: commission charged above the contract rate (certa)."""
    hits: list[tuple[Order, int, int, Terms]] = []
    for o in f.orders:
        terms = f.terms_on(o.ordered_on)
        if o.status != "concluido" or terms is None:
            continue
        expected = rep01_commission(o, terms)
        charged = f.charged(o, "commission")
        if charged - expected > p.rounding_tolerance_cents:
            hits.append((o, charged, expected, terms))
    if not hits:
        return []
    base = sum(
        o.items_cents + (o.delivery_fee_cents if t.delivery_model == "loja" else 0) for o, *_, t in hits
    )
    charged_pct = Decimal(sum(c for _, c, _, _ in hits)) / Decimal(base)
    contract = hits[0][3].commission_pct
    return [
        Finding(
            "DIF-01",
            "DIF-01",
            f.store_id,
            "certa",
            f"Comissão de {_pct(charged_pct)}% onde o contrato diz {_pct(contract)}%",
            f"Comissão de {_pct(charged_pct)}% no lugar de {_pct(contract)}%",
            [(o.id, c - e) for o, c, e, _ in hits],
            {"charged_pct": str(charged_pct.quantize(Decimal("0.0001"))), "contract_pct": str(contract)},
        )
    ]


def dif02_cancellation_charged(f: StoreFacts, p: Params) -> list[Finding]:
    """DIF-02: cancellation charged to the store when the reason is the channel's or the customer's.

    The store bore the cancellation: the order got no payout although REP-05 says it should have. Certa
    when the file states both who cancelled and why; provavel (04 default) when only who.
    """
    groups: dict[tuple[str, str], list[tuple[Order, int]]] = defaultdict(list)
    for o in f.orders:
        terms = f.terms_on(o.ordered_on)
        if o.status != "cancelado" or o.cancelled_by not in ("cliente", "canal") or terms is None:
            continue
        if f.paid(o) > 0:
            continue
        expected = rep05_expected_payout(o, terms, None)
        if expected > 0:
            reason = (o.cancel_reason or "").strip()
            groups[(o.cancelled_by, reason.casefold())].append((o, expected))
    out = []
    channel = CHANNEL_NAME.get(f.channel, f.channel)
    for (party, reason_key), hits in sorted(groups.items()):
        reason = (hits[0][0].cancel_reason or "").strip()
        if party == "cliente":
            long, short = "Cancelamento pelo cliente cobrado da loja", "Cancelamento cobrado da loja"
        elif reason:
            r = reason[0].lower() + reason[1:]
            long = f"Cancelamento por {r}"
            short = f"Cancelamento por {r.split(' ')[0]} ({channel})"
        else:
            long, short = f"Cancelamento pelo {channel} cobrado da loja", "Cancelamento cobrado da loja"
        out.append(
            Finding(
                "DIF-02",
                f"DIF-02:{party}:{reason_key}",
                f.store_id,
                "certa" if reason else "provavel",
                long,
                short,
                [(o.id, a) for o, a in hits],
                {"party": party, "reason": reason},
            )
        )
    return out


def dif03_promotion_debited(f: StoreFacts, p: Params) -> list[Finding]:
    """DIF-03: co-funded promotion debited in full from the store.

    Certa when a campaign with a channel share is in force and the store paid more than its share.
    A promotion debited with no campaign registered for that day is provavel: only the owner knows
    whether it was agreed (C16 "Foi combinado?").
    """
    with_campaign: dict[str, list[tuple[Order, int]]] = defaultdict(list)
    camp_of: dict[str, Campaign] = {}
    no_agreement: list[tuple[Order, int]] = []
    for o in f.orders:
        if o.status != "concluido":
            continue
        charged = f.charged(o, "promotion")
        if charged <= 0:
            continue
        c = campaign_for(o, f.campaigns)
        if c is None:
            no_agreement.append((o, charged))
            continue
        extra = charged - rep04_store_promotion(o, c)
        if extra > p.rounding_tolerance_cents:
            with_campaign[c.id].append((o, extra))
            camp_of[c.id] = c
    out = []
    for cid, hits in sorted(with_campaign.items()):
        c = camp_of[cid]
        out.append(
            Finding(
                "DIF-03",
                f"DIF-03:{cid}",
                f.store_id,
                "certa",
                "Cupom cofinanciado debitado inteiro da loja",
                "Cupom cofinanciado debitado inteiro",
                [(o.id, a) for o, a in hits],
                {
                    "campaign_id": cid,
                    "discount_pct": str(c.discount_pct),
                    "channel_share_pct": str(c.channel_share_pct),
                },
            )
        )
    if no_agreement:
        weeks = {o.ordered_on.isocalendar()[:2] for o, _ in no_agreement}
        long = (
            "Promoção da semana sem acordo registrado"
            if len(weeks) == 1
            else "Promoção sem acordo registrado"
        )
        out.append(
            Finding(
                "DIF-03",
                "DIF-03:sem_acordo",
                f.store_id,
                "provavel",
                long,
                "Promoção sem acordo registrado",
                [(o.id, a) for o, a in no_agreement],
                {},
            )
        )
    return out


def dif04_missing_payout(f: StoreFacts, p: Params, as_of: date) -> list[Finding]:
    """DIF-04: order delivered with no payout entry after the expected payment date plus 7 days (certa).

    Before that deadline a missing payout is provavel only when the same week's payout already came for
    other orders of the store (the week's payout was smaller than computed); a week with no payout at
    all is the normal lag and no difference yet.
    """
    unpaid: list[Order] = []
    paid_weeks: set[tuple[int, int]] = set()
    for o in f.orders:
        if o.status != "concluido":
            continue
        if f.paid(o) > 0:
            paid_weeks.add(o.ordered_on.isocalendar()[:2])
        else:
            unpaid.append(o)
    certain: list[tuple[Order, int]] = []
    waiting: dict[tuple[int, int], list[tuple[Order, int, date | None]]] = defaultdict(list)
    for o in unpaid:
        terms = f.terms_on(o.ordered_on)
        if terms is None:
            continue
        expected = rep05_expected_payout(o, terms, campaign_for(o, f.campaigns))
        if expected <= 0:
            continue
        due = max(
            (e.expected_payment_date for e in f.entries_by_order.get(o.id, []) if e.expected_payment_date),
            default=None,
        )
        if due is not None and as_of > due + timedelta(days=p.dif04_grace_days):
            certain.append((o, expected))
        elif o.ordered_on.isocalendar()[:2] in paid_weeks:
            waiting[o.ordered_on.isocalendar()[:2]].append((o, expected, due))
    out = []
    if certain:
        out.append(
            Finding(
                "DIF-04",
                "DIF-04:vencido",
                f.store_id,
                "certa",
                "Pedido entregue sem repasse depois do prazo",
                "Pedido sem repasse",
                [(o.id, a) for o, a in certain],
                {},
            )
        )
    for (year, week), hits in sorted(waiting.items()):
        dues = [d for *_, d in hits if d]
        reopen = (max(dues) + timedelta(days=p.dif04_grace_days)).isoformat() if dues else None
        out.append(
            Finding(
                "DIF-04",
                f"DIF-04:semana-{year}-{week:02d}",
                f.store_id,
                "provavel",
                f"Repasse da semana {week} menor que a apuração",
                f"Repasse da semana {week} menor",
                [(o.id, a) for o, a, _ in hits],
                {"week": week, "reopen_after": reopen},
            )
        )
    return out


def dif05_refund_without_complaint(f: StoreFacts, p: Params) -> list[Finding]:
    """DIF-05: refund charged to the store with no matching complaint (duvidosa).

    No complaint data is imported yet, so every refund charged to the store is a candidate; duvidosa
    differences stay in the console only (04 §3).
    """
    hits = [(o, f.charged(o, "refund")) for o in f.orders]
    hits = [(o, a) for o, a in hits if a > 0]
    if not hits:
        return []
    return [
        Finding(
            "DIF-05",
            "DIF-05",
            f.store_id,
            "duvidosa",
            "Reembolso cobrado da loja sem reclamação registrada",
            "Reembolso sem reclamação",
            [(o.id, a) for o, a in hits],
        )
    ]


def find_differences(stores: Iterable[StoreFacts], p: Params, as_of: date) -> list[Finding]:
    """DIF-01 to DIF-05 for one month of orders, every store."""
    out: list[Finding] = []
    for f in stores:
        out += dif01_commission_above_contract(f, p)
        out += dif02_cancellation_charged(f, p)
        out += dif03_promotion_debited(f, p)
        out += dif04_missing_payout(f, p, as_of)
        out += dif05_refund_without_complaint(f, p)
    return out


def shown_rules(findings: Iterable[Finding], p: Params) -> set[str]:
    """04 §2: a rule whose total in the month is below R$ 5,00 (param) is recorded but not shown."""
    total: dict[str, int] = defaultdict(int)
    for x in findings:
        total[x.rule_id] += x.amount_cents
    return {r for r, t in total.items() if t >= p.min_shown_cents}


def initial_status(x: Finding) -> str | None:
    """04 §3: certa starts a_contestar, provavel precisa_resposta, duvidosa stays in the console.

    A DIF-04 still inside its wait has no contestation yet (C16 "esperando repasse").
    """
    if x.confidence == "duvidosa":
        return None
    if x.rule_id == "DIF-04" and x.confidence == "provavel":
        return None
    return "a_contestar" if x.confidence == "certa" else "precisa_resposta"
