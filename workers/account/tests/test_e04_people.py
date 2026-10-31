"""E04 (07-acceptance): the last Dono cannot be removed or demoted; 24-hour lock after a contact change.

Exercises the SQL functions of migration 20261117000020 that the W04 server actions call (04 §5, §8, D33,
D35), on G-SYN Grupo Exemplo: Dono do grupo (only Dono), Pessoa do financeiro, Gerente do Centro.
"""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

db = pytest.mark.skipif(
    not os.environ.get("MARGO_DB_TESTS"), reason="MARGO_DB_TESTS=1 runs it against the local stack"
)


def sid(tag: str) -> str:
    h = hashlib.md5(f"g-syn:{tag}".encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


ACCOUNT = sid("G-02")
DONO = sid("p:g02-dono")
FIN = sid("p:g02-fin")
GER = sid("p:g02-ger")
M_DONO = sid("G-02:m-dono")
M_FIN = sid("G-02:m-fin")
M_GER = sid("G-02:m-ger")
CENTRO = sid("G-02:centro")
ZONASUL = sid("G-02:zonasul")
NOW = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)


def error_of(conn: Any, sql: str, params: tuple[Any, ...]) -> str:
    import psycopg

    with pytest.raises(psycopg.Error) as e, conn.transaction():
        conn.execute(sql, params)
    return str(e.value)


def audit(conn: Any, action: str) -> list[dict[str, Any]]:
    return conn.execute(
        "select actor_person_id::text as actor, actor_kind::text as kind, before, after from public.audit_log "
        "where account_id = %s and action = %s and at = %s order by created_at",
        (ACCOUNT, action, NOW),
    ).fetchall()


def role_of(conn: Any, membership: str) -> str | None:
    r = conn.execute(
        "select role::text as role from public.membership where id = %s", (membership,)
    ).fetchone()
    return r["role"] if r else None


UPDATE = "select public.membership_update(%s, %s, %s::public.member_role, %s, %s::uuid[], %s)"
REMOVE = "select public.membership_remove(%s, %s, %s)"


@db
def test_E04_last_dono_cannot_be_removed(conn: Any) -> None:
    assert "E04_last_dono" in error_of(conn, REMOVE, (DONO, M_DONO, NOW))
    assert role_of(conn, M_DONO) == "dono"
    assert audit(conn, "membership.remove") == []


@db
def test_E04_last_dono_cannot_be_demoted(conn: Any) -> None:
    assert "E04_last_dono" in error_of(conn, UPDATE, (DONO, M_DONO, "financeiro", True, [], NOW))
    assert role_of(conn, M_DONO) == "dono"


@db
def test_E04_with_two_donos_one_can_be_demoted_and_the_other_stays(conn: Any) -> None:
    conn.execute(UPDATE, (DONO, M_FIN, "dono", True, [], NOW))
    conn.execute(UPDATE, (FIN, M_DONO, "financeiro", True, [], NOW))
    assert (role_of(conn, M_FIN), role_of(conn, M_DONO)) == ("dono", "financeiro")
    # The new sole Dono is now the last one.
    assert "E04_last_dono" in error_of(conn, REMOVE, (FIN, M_FIN, NOW))
    rows = audit(conn, "membership.update")
    assert [(r["actor"], r["kind"], r["before"]["role"], r["after"]["role"]) for r in rows] == [
        (DONO, "person", "financeiro", "dono"),
        (FIN, "person", "dono", "financeiro"),
    ]


@db
def test_E04_only_a_dono_changes_people(conn: Any) -> None:
    assert "not_dono" in error_of(conn, REMOVE, (FIN, M_GER, NOW))
    assert "not_dono" in error_of(conn, UPDATE, (GER, M_GER, "dono", True, [], NOW))
    assert role_of(conn, M_GER) == "gerente"


@db
def test_E04_remove_and_change_scope_are_audited(conn: Any) -> None:
    conn.execute(UPDATE, (DONO, M_GER, "gerente", False, [CENTRO, ZONASUL], NOW))
    ks = conn.execute(
        "select kitchen_id::text as k from public.membership_kitchen where membership_id = %s order by 1",
        (M_GER,),
    ).fetchall()
    assert sorted(r["k"] for r in ks) == sorted([CENTRO, ZONASUL])
    assert "no_kitchen" in error_of(conn, UPDATE, (DONO, M_GER, "gerente", False, [], NOW))
    assert "kitchen_not_in_account" in error_of(
        conn, UPDATE, (DONO, M_GER, "gerente", False, [sid("G-01:igapo")], NOW)
    )

    conn.execute(REMOVE, (DONO, M_GER, NOW))
    assert role_of(conn, M_GER) is None
    [row] = audit(conn, "membership.remove")
    assert (row["actor"], row["before"]["role"], row["before"]["person_id"]) == (DONO, "gerente", GER)


@db
def test_E04_contact_change_locks_people_changes_for_24_hours(conn: Any) -> None:
    locks = conn.execute(
        "select account_id::text as a, until from public.security_lock_contact_change(%s, 'whatsapp', %s)",
        (DONO, NOW),
    ).fetchall()
    assert [(r["a"], r["until"]) for r in locks] == [(ACCOUNT, NOW + timedelta(hours=24))]
    lock = conn.execute("select public.people_lock_until(%s, %s) as u", (ACCOUNT, NOW)).fetchone()["u"]
    assert lock == NOW + timedelta(hours=24)

    during = NOW + timedelta(hours=23, minutes=59)
    assert "E04_locked" in error_of(conn, REMOVE, (DONO, M_GER, during))
    assert "E04_locked" in error_of(conn, UPDATE, (DONO, M_GER, "financeiro", True, [], during))
    invite = (
        "select public.invite_create(%s, %s, 'X', 'financeiro', '{}', 'email', 'x@exemplo.com.br', 'h1', %s)"
    )
    assert "E04_locked" in error_of(conn, invite, (DONO, ACCOUNT, during))
    assert role_of(conn, M_GER) == "gerente"

    after = NOW + timedelta(hours=24, minutes=1)
    assert (
        conn.execute("select public.people_lock_until(%s, %s) as u", (ACCOUNT, after)).fetchone()["u"] is None
    )
    conn.execute(UPDATE, (DONO, M_GER, "financeiro", True, [], after))
    assert role_of(conn, M_GER) == "financeiro"
    [row] = conn.execute(
        "select after from public.audit_log where action = 'security_lock.contact_change' and at = %s", (NOW,)
    ).fetchall()
    assert row["after"]["channel"] == "whatsapp"


@db
def test_E04_invite_create_and_resend_are_audited_and_refuse_a_member(conn: Any) -> None:
    sql = "select (i).* from public.invite_create(%s, %s, %s, %s::public.member_role, %s::uuid[], %s::public.contact_channel, %s, %s, %s) as i"
    inv = conn.execute(
        sql, (DONO, ACCOUNT, "Contadora", "gerente", [CENTRO], "email", "nova@exemplo.com.br", "hash-1", NOW)
    ).fetchone()
    assert (inv["name"], inv["role"], inv["expires_at"]) == ("Contadora", "gerente", NOW + timedelta(days=7))
    [row] = audit(conn, "invite.create")
    assert row["after"] == {
        "role": "gerente",
        "name": "Contadora",
        "channel": "email",
        "kitchen_ids": [CENTRO],
    }

    later = NOW + timedelta(days=3)
    conn.execute("select public.invite_resend(%s, %s, %s, %s)", (DONO, inv["id"], "hash-2", later))
    r = conn.execute(
        "select token_hash, expires_at from public.invite where id = %s", (inv["id"],)
    ).fetchone()
    assert (r["token_hash"], r["expires_at"]) == ("hash-2", later + timedelta(days=7))

    assert "already_member" in error_of(
        conn, sql, (DONO, ACCOUNT, "", "financeiro", [], "email", "FINANCEIRO@exemplo.com.br", "hash-3", NOW)
    )
    assert "already_member" in error_of(
        conn, sql, (DONO, ACCOUNT, "", "gerente", [CENTRO], "whatsapp", "+5543900005678", "hash-4", NOW)
    )
