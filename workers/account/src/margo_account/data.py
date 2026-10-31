"""Everything of one account, found from the schema itself (E06, 03 conventions).

Tenant tables carry `account_id` (03 intro); their children are found through foreign keys, so a table added
by a later migration is exported and deleted without touching this code. People are the account's members.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

INTERNAL_TABLES = frozenset({"job", "alert", "feature_override", "feature_flag_log", "staff"})
"""MargoAI's own operations (queue, team alerts, flag exceptions, staff): not exported. Deleted with the
account where they carry its id (job, alert, feature_override, feature_flag_log cascade)."""

PERSON_TABLES = frozenset({"session_device", "notice_pref", "extension_token"})
"""A member's own rows reached through person. Other tables pointing at person (column_mapping.created_by,
staff) are MargoAI's, not the account's."""

SECRET_COLUMN = re.compile(r"hash|token|secret", re.I)
"""Columns never written to an export: token hashes of invites, extension and sessions (A06)."""


@dataclass
class AccountData:
    account_id: str
    code: str
    name: str
    is_synthetic: bool
    person_ids: list[str]
    rows: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    columns: dict[str, list[str]] = field(default_factory=dict)


def _tables_with_account_id(conn: Any) -> list[str]:
    rows = conn.execute(
        """select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public' and c.column_name = 'account_id' and t.table_type = 'BASE TABLE'
           order by 1"""
    ).fetchall()
    return [r["table_name"] for r in rows]


def _foreign_keys(conn: Any) -> list[tuple[str, str, str, str]]:
    """(child table, child column, parent table, parent column) for single-column FKs inside public."""
    rows = conn.execute(
        """select cl.relname as child, a.attname as child_col, pl.relname as parent, pa.attname as parent_col
           from pg_constraint k
           join pg_class cl on cl.oid = k.conrelid
           join pg_class pl on pl.oid = k.confrelid
           join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
           join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
           where k.contype = 'f' and k.connamespace = 'public'::regnamespace
             and pl.relnamespace = 'public'::regnamespace and cardinality(k.conkey) = 1
           order by 1, 2"""
    ).fetchall()
    return [(r["child"], r["child_col"], r["parent"], r["parent_col"]) for r in rows]


def _select(conn: Any, sql: str, params: tuple[Any, ...]) -> tuple[list[str], list[dict[str, Any]]]:
    cur = conn.execute(sql, params)
    cols = [d.name for d in cur.description]
    return cols, cur.fetchall()


def collect(conn: Any, account_id: str) -> AccountData:
    """Rows of every table that belongs to the account, members included, internal tables left out."""
    acc = conn.execute(
        "select id, code, name, is_synthetic from public.account where id = %s", (account_id,)
    ).fetchone()
    if acc is None:
        raise LookupError("account not found")
    people = conn.execute(
        "select person_id from public.membership where account_id = %s order by person_id", (account_id,)
    ).fetchall()
    data = AccountData(
        account_id=str(acc["id"]),
        code=acc["code"],
        name=acc["name"],
        is_synthetic=acc["is_synthetic"],
        person_ids=[str(p["person_id"]) for p in people],
    )
    with_account = set(_tables_with_account_id(conn))

    def add(table: str, cols: list[str], rows: list[dict[str, Any]]) -> bool:
        if not rows:
            return False
        data.columns.setdefault(table, cols)
        have = data.rows.setdefault(table, [])
        seen = {r.get("id") for r in have}
        new = [r for r in rows if r.get("id") is None or r.get("id") not in seen]
        have.extend(new)
        return bool(new)

    cols, rows = _select(conn, "select * from public.account where id = %s", (account_id,))
    add("account", cols, rows)
    for t in sorted(with_account - INTERNAL_TABLES):
        cols, rows = _select(
            conn, f'select * from public."{t}" where account_id = %s order by 1', (account_id,)
        )
        add(t, cols, rows)
    if data.person_ids:
        cols, rows = _select(
            conn, "select * from public.person where id = any(%s::uuid[])", (data.person_ids,)
        )
        add("person", cols, rows)

    # Children without account_id, through foreign keys to rows already collected, until nothing new.
    links = [fk for fk in _foreign_keys(conn) if fk[0] not in with_account and fk[0] not in INTERNAL_TABLES]
    changed = True
    while changed:
        changed = False
        for child, col, parent, pcol in links:
            parents = data.rows.get(parent)
            if not parents or child in ("account", "person"):
                continue
            if parent == "person" and child not in PERSON_TABLES:
                continue
            keys = sorted({str(r[pcol]) for r in parents if r.get(pcol) is not None})
            cols, rows = _select(
                conn, f'select * from public."{child}" where "{col}"::text = any(%s) order by 1', (keys,)
            )
            changed = add(child, cols, rows) or changed
    return data


def referenced_files(data: AccountData) -> list[str]:
    """Storage paths named by the account's rows: every *_path column ("<bucket>/<object>")."""
    out: set[str] = set()
    for rows in data.rows.values():
        for r in rows:
            for k, v in r.items():
                if k.endswith("_path") and isinstance(v, str) and "/" in v:
                    out.add(v)
    return sorted(out)
