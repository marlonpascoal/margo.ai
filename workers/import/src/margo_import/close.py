"""Monthly close per channel store (C08, P06) and its differences (C09), from canonical rows.

Sold in the month (gross of the orders placed in it, cancelled ones excluded) against what the ledger
says happened in the month (deductions and payouts by entry date). C08 "Done when": the payout column
equals the sum of payout entries for the month to the centavo.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from .rules import CLOSE_COLUMNS, Entry, Finding, Params, StoreFacts, find_differences, shown_rules


@dataclass(frozen=True)
class CloseLine:
    store_id: str
    gross_cents: int
    commission_cents: int
    payment_cents: int
    delivery_cents: int
    promotion_cents: int
    anticipation_cents: int
    payout_cents: int


@dataclass
class StoreMonth(StoreFacts):
    """Facts of one store for one month: its orders of the month and every ledger entry dated in it."""

    month_entries: Sequence[Entry] = ()


@dataclass
class CloseResult:
    lines: list[CloseLine]
    findings: list[Finding]
    shown: set[str]


def close_line(s: StoreMonth) -> CloseLine:
    """C08 row of one store: gross of concluded orders; signed ledger sums by C08 column."""
    sums = {
        col: sum(e.amount_cents for e in s.month_entries if e.type in types)
        for col, types in CLOSE_COLUMNS.items()
    }
    return CloseLine(
        store_id=s.store_id,
        gross_cents=sum(o.gross_cents for o in s.orders if o.status == "concluido"),
        commission_cents=sums["commission"],
        payment_cents=sums["payment"],
        delivery_cents=sums["delivery"],
        promotion_cents=sums["promotion"],
        anticipation_cents=sums["anticipation"],
        payout_cents=sums["payout"],
    )


def compute_close(stores: Iterable[StoreMonth], params: Params, as_of: date) -> CloseResult:
    stores = list(stores)
    lines = [close_line(s) for s in stores if s.orders or s.month_entries]
    findings = find_differences(stores, params, as_of)
    return CloseResult(lines, findings, shown_rules(findings, params))
