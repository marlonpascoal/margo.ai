"""E06 deletion job (02 §7, D48): the account's rows and files are gone; a receipt stays in audit_log.

Order: files first (Storage is not transactional; deleting a missing file is harmless), then one database
transaction: the account's audit rows (allowed only with app.deletion_job = 'on'), the account (every tenant
table cascades), members who belong to no other account and are not staff (with their sign-in), and last
the receipt. The receipt carries ids and counts only, never names (02 §7).
"""

from __future__ import annotations

import json
from typing import Any

from .data import collect
from .export import account_files
from .files import AccountFiles

RECEIPT_ACTION = "account.deleted"


def _counts(conn: Any, account_id: str) -> dict[str, int]:
    """Rows per tenant table before deletion, for the receipt."""
    tables = conn.execute(
        """select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public' and c.column_name = 'account_id' and t.table_type = 'BASE TABLE'
           order by 1"""
    ).fetchall()
    out: dict[str, int] = {}
    for t in tables:
        name = t["table_name"]
        n = conn.execute(
            f'select count(*) as n from public."{name}" where account_id = %s', (account_id,)
        ).fetchone()
        if n["n"]:
            out[name] = n["n"]
    return out


def delete_account(
    conn: Any, files: AccountFiles, account_id: str, *, requested_by: str | None, job_id: str | None
) -> dict[str, Any]:
    """Deletes everything of the account and returns the receipt written to audit_log."""
    data = collect(conn, account_id)
    paths = account_files(data, files, include_exports=True)
    files.delete(paths)

    with conn.transaction():
        counts = _counts(conn, account_id)
        conn.execute("select set_config('app.deletion_job', 'on', true)")
        conn.execute("delete from public.audit_log where account_id = %s", (account_id,))
        conn.execute("delete from public.account where id = %s", (account_id,))
        gone = conn.execute(
            """delete from public.person p
               where p.id = any(%s::uuid[])
                 and not exists (select 1 from public.membership m where m.person_id = p.id)
                 and not exists (select 1 from public.staff s where s.person_id = p.id)
               returning p.auth_user_id, lower(p.email) as email""",
            (data.person_ids,),
        ).fetchall()
        auth_ids = [r["auth_user_id"] for r in gone if r["auth_user_id"]]
        emails = [r["email"] for r in gone if r["email"]]
        if auth_ids:
            conn.execute("delete from auth.users where id = any(%s::uuid[])", (auth_ids,))
        if emails:
            conn.execute("delete from public.auth_code_guard where email = any(%s)", (emails,))
        conn.execute("select set_config('app.deletion_job', 'off', true)")
        receipt = {
            "rows": sum(counts.values()),
            "tables": counts,
            "files": len(paths),
            "people_deleted": len(gone),
            "requested_by": requested_by,
            "job_id": job_id,
        }
        conn.execute(
            """insert into public.audit_log
                 (actor_person_id, actor_kind, account_id, action, entity, entity_id, after)
               values (null, 'system', %s, %s, 'account', %s, %s::jsonb)""",
            (account_id, RECEIPT_ACTION, account_id, json.dumps(receipt)),
        )
    return receipt
