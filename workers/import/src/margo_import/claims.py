"""Claim text per rule ID (04 §3, C16): the owner copies it into the app's portal; MargoAI never files it.

The DIF-03 text with a campaign is the one drawn in C16; the others follow its shape (listed for Marlon).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from .rules import CHANNEL_NAME, Finding, _pct

MONTHS = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
]


def brl(cents: int) -> str:
    """R$ 1.234,56"""
    sign = "-" if cents < 0 else ""
    reais, cent = divmod(abs(cents), 100)
    return f"{sign}R$ {reais:,}".replace(",", ".") + f",{cent:02d}"


def _orders(n: int) -> str:
    return f"{n} pedido" if n == 1 else f"{n} pedidos"


def claim_text(x: Finding, month: date, channel: str) -> str:
    """The ready text for one difference, numbers filled in."""
    mes = MONTHS[month.month - 1]
    app = CHANNEL_NAME.get(channel, channel)
    n = x.orders_count
    tail = f"Diferença: {brl(x.amount_cents)}. Segue planilha com os pedidos."
    if x.rule_id == "DIF-01":
        charged = _pct(Decimal(str(x.detail["charged_pct"])))
        contract = _pct(Decimal(str(x.detail["contract_pct"])))
        return (
            f"Em {mes}, {_orders(n)} tiveram comissão de {charged}%, mas o contrato diz {contract}%. {tail}"
        )
    if x.rule_id == "DIF-02":
        who = (
            "pelo cliente"
            if x.detail.get("party") == "cliente"
            else f"por {str(x.detail.get('reason') or app).lower()}"
        )
        verb = "foi cancelado" if n == 1 else "foram cancelados"
        return f"Em {mes}, {_orders(n)} {verb} {who} e o valor foi cobrado da loja. {tail}"
    if x.rule_id == "DIF-03" and "campaign_id" in x.detail:
        pct = _pct(Decimal(str(x.detail["discount_pct"])))
        share = Decimal(str(x.detail["channel_share_pct"]))
        part = "metade" if share == Decimal("0.5") else f"{_pct(share)}% do desconto"
        return (
            f"Em {mes}, {_orders(n)} com o cupom da campanha de {pct}% "
            "tiveram o desconto debitado inteiro da loja. "
            f"Pelo acordo da campanha, o {app} cofinancia {part}. {tail}"
        )
    if x.rule_id == "DIF-03":
        return (
            f"Em {mes}, {_orders(n)} tiveram promoção debitada da loja sem acordo registrado conosco. {tail}"
        )
    if x.rule_id == "DIF-04":
        verb = "ficou" if n == 1 else "ficaram"
        return f"Em {mes}, {_orders(n)} entregue{'s' if n > 1 else ''} {verb} sem repasse. {tail}"
    return f"Em {mes}, {_orders(n)} com {x.short.lower()}. {tail}"
