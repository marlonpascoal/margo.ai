"""Contestation state machine (04 §3, D30, C04).

Mirror of app.contestation_next in supabase/migrations/20261104000022_m2_contestation.sql, which is the
authority: the database refuses any other change. The worker uses this copy to decide what to ask for
(credito_encontrado, prazo_passou) and the C04 test checks both agree.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

Status = Literal["a_contestar", "precisa_resposta", "contestada", "creditada", "negada", "prazo_vencido"]
Actor = Literal["person", "staff", "system"]
CLOSED = "encerrada"
"""04 §3 "closed (no difference)": not a status; the row gets closed_at."""

STATUSES: tuple[Status, ...] = (
    "a_contestar",
    "precisa_resposta",
    "contestada",
    "creditada",
    "negada",
    "prazo_vencido",
)
EVENTS = (
    "ja_contestei",
    "foi_combinado_sim",
    "foi_combinado_nao",
    "credito_encontrado",
    "foi_negada",
    "prazo_passou",
)
ACTORS: tuple[Actor, ...] = ("person", "staff", "system")

# (from, event) -> (to, actors allowed). Nothing else is a transition.
TRANSITIONS: dict[tuple[str, str], tuple[str, frozenset[str]]] = {
    ("a_contestar", "ja_contestei"): ("contestada", frozenset({"person"})),
    ("precisa_resposta", "foi_combinado_sim"): (CLOSED, frozenset({"person"})),
    ("precisa_resposta", "foi_combinado_nao"): ("a_contestar", frozenset({"person"})),
    ("contestada", "credito_encontrado"): ("creditada", frozenset({"system"})),
    ("contestada", "foi_negada"): ("negada", frozenset({"person", "staff"})),
    ("a_contestar", "prazo_passou"): ("prazo_vencido", frozenset({"system"})),
}


def next_status(status: str, event: str, actor: str) -> str | None:
    """C04: the status after `event` by `actor`, CLOSED, or None when 04 §3 does not allow it."""
    t = TRANSITIONS.get((status, event))
    return t[0] if t and actor in t[1] else None


@dataclass(frozen=True)
class Contested:
    id: str
    store_id: str
    amount_cents: int
    marked_at: datetime


@dataclass(frozen=True)
class Credit:
    id: str
    store_id: str
    type: str
    amount_cents: int
    entry_date: date


def match_credits(
    contested: Iterable[Contested], credits: Iterable[Credit], tolerance: Decimal
) -> list[tuple[str, str]]:
    """04 §3: a contested difference becomes creditada when an adjustment or refund credit of the same
    store, dated on or after the marking and within `tolerance` of the amount, shows in the repasse.
    Each credit pays one difference; the closest amount wins. Returns (contestation id, entry id)."""
    pool = [c for c in credits if c.type in ("adjustment", "refund") and c.amount_cents > 0]
    used: set[str] = set()
    out = []
    for k in sorted(contested, key=lambda x: (x.marked_at, x.id)):
        fits = [
            c
            for c in pool
            if c.id not in used
            and c.store_id == k.store_id
            and c.entry_date >= k.marked_at.date()
            and abs(c.amount_cents - k.amount_cents) <= tolerance * k.amount_cents
        ]
        if fits:
            best = min(fits, key=lambda c: (abs(c.amount_cents - k.amount_cents), c.entry_date, c.id))
            used.add(best.id)
            out.append((k.id, best.id))
    return out
