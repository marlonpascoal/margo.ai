"""C04: the contestation state machine has every transition of 04 §3 and no other."""

from __future__ import annotations

import itertools
import os
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from margo_import.contestation import (
    ACTORS,
    CLOSED,
    EVENTS,
    STATUSES,
    Contested,
    Credit,
    match_credits,
    next_status,
)

DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))

# 04 §3, written out by hand from the diagram (actor: person = owner side, staff = console, system).
EXPECTED = {
    ("a_contestar", "ja_contestei", "person"): "contestada",
    ("precisa_resposta", "foi_combinado_sim", "person"): CLOSED,
    ("precisa_resposta", "foi_combinado_nao", "person"): "a_contestar",
    ("contestada", "credito_encontrado", "system"): "creditada",
    ("contestada", "foi_negada", "person"): "negada",
    ("contestada", "foi_negada", "staff"): "negada",
    ("a_contestar", "prazo_passou", "system"): "prazo_vencido",
}


def test_C04_contestation_transitions() -> None:
    for status, event, actor in itertools.product(STATUSES, EVENTS, ACTORS):
        assert next_status(status, event, actor) == EXPECTED.get((status, event, actor)), (
            status,
            event,
            actor,
        )


def test_C04_staff_cannot_set_creditada_and_terminal_states_stay() -> None:
    assert next_status("contestada", "credito_encontrado", "staff") is None
    assert next_status("contestada", "credito_encontrado", "person") is None
    for terminal in ("creditada", "negada", "prazo_vencido"):
        assert all(next_status(terminal, e, a) is None for e in EVENTS for a in ACTORS)


@pytest.mark.skipif(not DB_TESTS, reason="MARGO_DB_TESTS=1 runs it against the local stack")
def test_C04_python_table_matches_the_database() -> None:
    from margo_import import db

    conn = db.connect()
    for status, event, actor in itertools.product(STATUSES, EVENTS, ACTORS):
        row = conn.execute(
            "select app.contestation_next(%s::public.contestation_status, %s, %s::public.actor_kind) as n",
            (status, event, actor),
        ).fetchone()
        assert row["n"] == next_status(status, event, actor), (status, event, actor)
    conn.close()


def at(day: int) -> datetime:
    return datetime(2026, 10, day, 12, tzinfo=UTC)


def test_credit_matches_within_ten_percent_after_marking() -> None:
    k = [Contested("k1", "s4", 23_800, at(3)), Contested("k2", "s1", 41_200, at(2))]
    credits = [
        Credit("early", "s4", "adjustment", 23_800, date(2026, 10, 1)),  # before marking
        Credit("far", "s4", "adjustment", 30_000, date(2026, 10, 14)),  # off by more than 10%
        Credit("ok", "s4", "adjustment", 23_800, date(2026, 10, 14)),
        Credit("debit", "s1", "adjustment", -41_200, date(2026, 10, 14)),
        Credit("fee", "s1", "commission", 41_200, date(2026, 10, 14)),
    ]
    assert match_credits(k, credits, Decimal("0.10")) == [("k1", "ok")]
