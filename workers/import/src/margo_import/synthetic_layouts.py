"""Synthetic layouts shipped with worker-import: `gsyn-sintetico-v1` for each source (G-SYN only).

These are NOT the real iFood Partner Portal or 99Food layouts (06 §2, §3, D40: no invented provider
formats are claimed). Real layouts arrive as new column_mapping rows, mapped in C17 from an anonymized
sample export (fixtures/m2/README.md). The G-SYN fixtures and the seed use these.
"""

from __future__ import annotations

from .layout import Mapping_

NAME = "gsyn-sintetico-v1"

IFOOD_HEADERS = [
    "Data do pedido",
    "ID da loja",
    "ID do pedido",
    "Status",
    "Cancelado por",
    "Motivo do cancelamento",
    "Valor dos itens",
    "Taxa de entrega",
    "Valor total",
    "Desconto pago pelo iFood",
    "Comissão",
    "Taxa de pagamento",
    "Repasse da entrega",
    "Promoção paga pela loja",
    "Antecipação",
    "Valor líquido",
    "Data do repasse",
    "Data prevista do repasse",
]
IFOOD_MAPPING = Mapping_(
    columns=dict(
        zip(
            IFOOD_HEADERS,
            [
                "ordered_at",
                "store_id",
                "order_id",
                "status",
                "cancelled_by",
                "cancel_reason",
                "items",
                "delivery_fee",
                "gross",
                "discount_channel",
                "commission",
                "payment_fee",
                "delivery",
                "promotion",
                "anticipation",
                "payout",
                "payout_date",
                "expected_payment_date",
            ],
            strict=True,
        )
    ),
)


F99_V1_HEADERS = [
    "Data do pedido",
    "ID da loja",
    "ID do pedido",
    "ID da transação",
    "Status do pedido",
    "Cancelado por",
    "Motivo do cancelamento",
    "Valor dos itens",
    "Taxa de intermediação",
    "Taxa de pagamento",
    "Taxa de entrega",
    "Promoção da loja",
    "Valor do repasse",
    "Data do repasse",
    "Data prevista do repasse",
]
F99_NEW = ["Subsídio da plataforma", "Ajuste CBS/IBS", "Repasse dividido"]
F99_MAPPING = Mapping_(
    columns=dict(
        zip(
            F99_V1_HEADERS,
            [
                "ordered_at",
                "store_id",
                "order_id",
                "transaction_id",
                "status",
                "cancelled_by",
                "cancel_reason",
                "gross",
                "commission",
                "payment_fee",
                "delivery",
                "promotion",
                "payout",
                "payout_date",
                "expected_payment_date",
            ],
            strict=True,
        )
    ),
)
# What C17 saves for the changed layout (C02): the three new columns as drawn.
F99_V2_MAPPING = Mapping_(
    columns={
        **F99_MAPPING.columns,
        "Subsídio da plataforma": "discount_channel",
        "Ajuste CBS/IBS": "tax",
        "Repasse dividido": "installment",
    }
)
