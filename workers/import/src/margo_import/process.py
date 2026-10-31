"""One import run, from the stored file to canonical rows and the month's close (04 §11, D31, C06, C17).

read file -> header signature -> saved column_mapping?
   no  -> needs_mapping, with the C17 proposal and check block in import_run.log, and a team alert
   yes -> canonical rows -> payout total of the file must equal the mapped payout total
       -> every store known -> real account: every CNPJ authorized (C06)
       -> insert with natural keys (re-import adds zero rows) -> recompute the touched months
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from margo_common.files import FileStore

from . import db
from .layout import LayoutError, Mapping_, apply, examples, propose, read_table, signature

CHANNEL_LABEL = {"ifood": "iFood", "food99": "99Food"}


@dataclass(frozen=True)
class Outcome:
    status: str
    reason: str | None = None


class Refused(Exception):
    def __init__(self, reason: str, **log: Any) -> None:
        super().__init__(reason)
        self.reason = reason
        self.log = log


def _load_run(conn: Any, run_id: str) -> dict[str, Any]:
    run = conn.execute(
        "select id::text, account_id::text, channel::text, file_path, file_name, status::text, log"
        " from public.import_run where id = %s",
        (run_id,),
    ).fetchone()
    if run is None:
        raise Refused("run_not_found")
    return run


def needs_mapping_log(conn: Any, channel: str, table: Any) -> dict[str, Any]:
    """C17 data: each column with example and proposed field, rows in file and the payout check."""
    proposal, statuses, _ = propose(table.headers, [m.mapping for m in db.mappings(conn, channel)])
    ex = examples(table)
    check: dict[str, Any] = {"rows_in_file": len(table.rows)}
    try:
        parsed = apply(table, proposal)
        check.update(
            payout_total_file_cents=parsed.payout_total_file_cents,
            payout_total_mapped_cents=parsed.payout_total_mapped_cents,
        )
    except ValueError:
        check.update(payout_total_file_cents=None, payout_total_mapped_cents=None)
    return {
        "signature": signature(table.headers),
        "columns": [
            {"name": s.name, "example": ex.get(s.name, ""), "field": s.field, "known": s.known}
            for s in statuses
        ],
        "proposal": proposal.to_json(),
        **check,
    }


def authorization_refusal(
    synthetic: bool, store_exts: set[str], refs: dict[str, db.StoreRef], cnpjs: set[str], authorized: set[str]
) -> int | None:
    """C06, 04 §11: a real file is refused unless every CNPJ in it has an owner_authorization.

    The CNPJ of a row is its store's company (a store without kitchen has none, so it is refused too),
    plus any CNPJ column the layout maps. Synthetic accounts (G-SYN) carry no real data. Returns the
    number of stores without authorization, or None when the file may be processed.
    """
    if synthetic:
        return None
    missing = sum(1 for s in store_exts if not refs[s].authorized_company)
    if missing or any(c not in authorized for c in cnpjs):
        return max(missing, 1)
    return None


def process_run(
    conn: Any, files: FileStore, run_id: str, channel: str, now: datetime | None = None
) -> Outcome:
    """Run one import. The run row records the outcome; ids and counts only in logs (02 §7)."""
    started = time.monotonic()
    run = _load_run(conn, run_id)
    if run["channel"] != channel:
        raise Refused("wrong_channel")
    account = run["account_id"]
    db.update_run(conn, run_id, status="running")
    try:
        data = files.get(run["file_path"])
        try:
            table = read_table(data, run["file_name"] or run["file_path"])
        except LayoutError as e:
            raise Refused("unreadable") from e
        sig = signature(table.headers)
        saved = next((m for m in db.mappings(conn, channel) if m.signature == sig), None)
        if saved is None:
            log = needs_mapping_log(conn, channel, table)
            db.update_run(
                conn,
                run_id,
                status="needs_mapping",
                rows_total=len(table.rows),
                log=log,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            new = sum(1 for c in log["columns"] if not c["known"])
            conn.execute(
                """insert into public.alert (severity, title, account_id, link)
                   values ('medio', %s, %s, %s)""",
                (
                    f"Arquivo da {CHANNEL_LABEL.get(channel, channel)} com colunas novas",
                    account,
                    f"/console/importacoes/{run_id}/corrigir",
                ),
            )
            return Outcome("needs_mapping", f"{new}_new_columns")
        mapping: Mapping_ = saved.mapping
        try:
            parsed = apply(table, mapping)
        except ValueError as e:
            raise Refused("bad_value") from e
        if parsed.payout_total_file_cents != parsed.payout_total_mapped_cents:
            raise Refused(
                "payout_total_mismatch",
                payout_total_file_cents=parsed.payout_total_file_cents,
                payout_total_mapped_cents=parsed.payout_total_mapped_cents,
            )
        refs = db.stores(conn, account, channel)
        unknown = sorted(s for s in parsed.store_exts if s not in refs)
        if unknown:
            raise Refused("unknown_store", stores_unknown=len(unknown))
        refused = authorization_refusal(
            db.is_synthetic(conn, account),
            parsed.store_exts,
            refs,
            parsed.cnpjs,
            db.authorized_cnpjs(conn, account),
        )
        if refused is not None:
            raise Refused("no_owner_authorization", stores_without_authorization=refused)
        counts = db.write_parsed(conn, account, run_id, parsed, refs)
        period = parsed.period()
        as_of = db.today_sao_paulo(now)
        closes = {}
        for month in sorted(db.months_touched(parsed)):
            closes[month.isoformat()[:7]] = db.recompute_close(conn, account, month, as_of)
        settled = db.settle_contestations(conn, account, as_of)
        db.update_run(
            conn,
            run_id,
            status="ok",
            mapping_id=saved.id,
            store_ids=sorted({refs[s].id for s in parsed.store_exts}),
            period_start=period[0] if period else None,
            period_end=period[1] if period else None,
            rows_total=parsed.rows_in_file,
            rows_new=counts.rows_new,
            rows_duplicate=counts.rows_duplicate,
            duration_ms=int((time.monotonic() - started) * 1000),
            log={
                "signature": sig,
                "mapping": saved.name,
                "rows_in_file": parsed.rows_in_file,
                "payout_total_file_cents": parsed.payout_total_file_cents,
                "payout_total_mapped_cents": parsed.payout_total_mapped_cents,
                "canonical_new": counts.canonical_new,
                "closes": closes,
                **settled,
            },
        )
        conn.execute(
            """update public.import_source set last_ok_at = now()
               where account_id = %s and channel = %s and kind = 'upload'""",
            (account, channel),
        )
        return Outcome("ok")
    except Refused as r:
        db.update_run(
            conn,
            run_id,
            status="failed",
            duration_ms=int((time.monotonic() - started) * 1000),
            log={**(run["log"] or {}), "reason": r.reason, **r.log},
        )
        return Outcome("failed", r.reason)
    except FileNotFoundError:
        db.update_run(conn, run_id, status="failed", log={**(run["log"] or {}), "reason": "file_missing"})
        return Outcome("failed", "file_missing")
    except Exception:
        db.update_run(conn, run_id, status="failed", log={**(run["log"] or {}), "reason": "error"})
        raise


def months_of(days: list[date]) -> list[str]:
    return sorted({d.isoformat()[:7] for d in days})
