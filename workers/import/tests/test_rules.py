"""REP-01 to REP-05 and DIF-01 to DIF-05 (04 §2) on small hand-made cases."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from margo_import.rules import (
    Campaign,
    Entry,
    Finding,
    Order,
    Params,
    StoreFacts,
    Terms,
    dif01_commission_above_contract,
    dif02_cancellation_charged,
    dif03_promotion_debited,
    dif04_missing_payout,
    dif05_refund_without_complaint,
    initial_status,
    rep01_commission,
    rep02_payment_fee,
    rep03_delivery,
    rep04_store_promotion,
    rep05_expected_payout,
    shown_rules,
)

CANAL = Terms(Decimal("0.12"), Decimal("0.035"), "canal")
LOJA = Terms(Decimal("0.12"), Decimal("0.035"), "loja")
SEPT = date(2026, 9, 10)
P = Params()


def order(oid: str = "o1", **kw: object) -> Order:
    base: dict[str, object] = dict(
        id=oid,
        store_id="s",
        external_id=oid,
        ordered_on=SEPT,
        gross_cents=6_000,
        items_cents=5_500,
        delivery_fee_cents=500,
    )
    base.update(kw)
    return Order(**base)  # type: ignore[arg-type]


def entries(oid: str, **amounts: int) -> list[Entry]:
    return [Entry(f"{oid}:{t}", "s", oid, SEPT, t, a) for t, a in amounts.items()]


def facts(
    orders: list[Order],
    by_order: dict[str, list[Entry]],
    campaigns: list[Campaign] | None = None,
    channel: str = "ifood",
) -> StoreFacts:
    return StoreFacts("s", channel, [CANAL], campaigns or [], orders, by_order)


def test_rep01_commission_on_items_or_items_plus_delivery() -> None:
    assert rep01_commission(order(), CANAL) == 660
    assert rep01_commission(order(), LOJA) == 720


def test_rep02_payment_fee_on_amount_paid_online() -> None:
    assert rep02_payment_fee(order(discount_store_cents=1_000), CANAL) == 175


def test_rep03_delivery_belongs_to_channel_or_passes_through() -> None:
    assert rep03_delivery(order(), CANAL) == 500
    assert rep03_delivery(order(), LOJA) == 0


def test_rep04_store_pays_its_share_of_the_campaign() -> None:
    c = Campaign("c", "s", Decimal("0.2"), Decimal("0.5"), date(2026, 9, 1), date(2026, 9, 30))
    assert rep04_store_promotion(order(discount_store_cents=550, discount_channel_cents=550), c) == 550
    assert rep04_store_promotion(order(discount_store_cents=1_100), None) == 0


def test_rep05_expected_payout() -> None:
    o = order(discount_store_cents=0)
    assert rep05_expected_payout(o, CANAL, None) == 6_000 - 660 - 210 - 500


def test_dif01_commission_above_contract_rate() -> None:
    o1, o2 = order("o1"), order("o2")
    f = facts([o1, o2], {"o1": entries("o1", commission=-825), "o2": entries("o2", commission=-661)})
    [x] = dif01_commission_above_contract(f, P)
    assert (x.rule_id, x.confidence, x.orders, x.amount_cents) == ("DIF-01", "certa", [("o1", 165)], 165)
    assert x.description == "Comissão de 15% onde o contrato diz 12%"


def test_dif02_cancellation_by_customer_charged_to_store() -> None:
    o = order(status="cancelado", cancelled_by="cliente", cancel_reason="Cliente desistiu")
    by_store = order("o2", status="cancelado", cancelled_by="loja", cancel_reason="Item em falta")
    [x] = dif02_cancellation_charged(facts([o, by_store], {}), P)
    assert (x.confidence, x.amount_cents, x.description) == (
        "certa",
        4_630,
        "Cancelamento pelo cliente cobrado da loja",
    )
    no_reason = order(status="cancelado", cancelled_by="canal")
    [y] = dif02_cancellation_charged(facts([no_reason], {}), P)
    assert y.confidence == "provavel", "04 default when the file does not say why"
    paid = facts([o], {"o1": entries("o1", payout=4_630)})
    assert dif02_cancellation_charged(paid, P) == []


def test_dif03_cofunded_promotion_debited_in_full_and_without_agreement() -> None:
    c = Campaign("c", "s", Decimal("0.2"), Decimal("0.5"), date(2026, 9, 1), date(2026, 9, 20))
    full = order("o1", discount_store_cents=1_100)
    right = order("o2", discount_store_cents=550, discount_channel_cents=550)
    late = order("o3", ordered_on=date(2026, 9, 23), discount_store_cents=700)
    f = facts(
        [full, right, late],
        {
            "o1": entries("o1", promotion=-1_100),
            "o2": entries("o2", promotion=-550),
            "o3": entries("o3", promotion=-700),
        },
        [c],
    )
    certa, provavel = dif03_promotion_debited(f, P)
    assert (certa.confidence, certa.orders, certa.detail["channel_share_pct"]) == (
        "certa",
        [("o1", 550)],
        "0.5",
    )
    assert (provavel.confidence, provavel.orders) == ("provavel", [("o3", 700)])
    assert provavel.description == "Promoção da semana sem acordo registrado"


def test_dif04_missing_payout_waits_then_is_certain() -> None:
    paid, unpaid = order("o1"), order("o2")
    by = {
        "o1": entries("o1", payout=4_000),
        "o2": [Entry("o2:c", "s", "o2", SEPT, "commission", -660, date(2026, 11, 3))],
    }
    [w] = dif04_missing_payout(facts([paid, unpaid], by), P, date(2026, 10, 30))
    assert (w.confidence, w.description, w.detail["reopen_after"]) == (
        "provavel",
        "Repasse da semana 37 menor que a apuração",
        "2026-11-10",
    )
    [c] = dif04_missing_payout(facts([paid, unpaid], by), P, date(2026, 11, 11))
    assert c.confidence == "certa"
    alone = facts([unpaid], by)
    assert dif04_missing_payout(alone, P, date(2026, 10, 30)) == [], (
        "a week with no payout at all is the normal lag"
    )


def test_dif05_refund_without_complaint_is_doubtful() -> None:
    [x] = dif05_refund_without_complaint(facts([order()], {"o1": entries("o1", refund=-300)}), P)
    assert (x.confidence, x.amount_cents) == ("duvidosa", 300)
    assert initial_status(x) is None, "duvidosa stays in the console only"


def test_below_five_reais_per_rule_per_month_is_recorded_but_not_shown() -> None:
    small = Finding("DIF-05", "DIF-05", "s", "duvidosa", "", "", [("o1", 300), ("o2", 199)])
    big = Finding("DIF-01", "DIF-01", "s", "certa", "", "", [("o1", 500)])
    assert shown_rules([small, big], P) == {"DIF-01"}


def test_initial_status_by_confidence() -> None:
    mk = lambda r, c: Finding(r, r, "s", c, "", "")  # noqa: E731
    assert initial_status(mk("DIF-01", "certa")) == "a_contestar"
    assert initial_status(mk("DIF-03", "provavel")) == "precisa_resposta"
    assert initial_status(mk("DIF-04", "provavel")) is None
