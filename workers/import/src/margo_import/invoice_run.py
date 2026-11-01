"""One accountant XML zip, from storage to invoices, lines and the first matches (06 §5, D11, C06, C10, D01).

paused source (E02)? -> failed "source_paused", nothing written
read zip -> distinct keys -> buyer company of each invoice (dest CNPJ; none: the account's only company)
   buyer not in the account -> the invoice is rejected (counted, not saved)
   real account: every buyer company needs an owner_authorization with scope "notas" (C06) -> else the
   whole run fails "no_owner_authorization" and nothing is written
-> keys this account already has are duplicates (D11, per account since 31/out: another account's
   invoices are never looked at, so no run reveals them) -> XML to the invoices bucket, invoice and lines
-> GTIN and rule matches now (D14), one match_ai job for the rest (flag m3.depara_ia, A05)
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from margo_common.files import FileStore
from margo_match import db as match_db

from .invoices import Invoice, InvoiceError, read_zip, zip_stats
from .process import Outcome, Refused


def _companies(conn: Any, account_id: str) -> dict[str, tuple[str, bool]]:
    rows = conn.execute(
        """select c.id, c.cnpj,
                  exists (select 1 from public.owner_authorization oa
                          where oa.company_id = c.id and 'notas' = any (oa.scope)) as authorized
           from public.company c where c.account_id = %s""",
        (account_id,),
    ).fetchall()
    return {r["cnpj"]: (str(r["id"]), r["authorized"]) for r in rows}


def buyer_company(inv: Invoice, companies: dict[str, tuple[str, bool]]) -> tuple[str, bool] | None:
    """The account's company that bought: dest CNPJ, or the only company when the receipt names none."""
    if inv.buyer_cnpj:
        return companies.get(inv.buyer_cnpj)
    if len(companies) == 1:
        return next(iter(companies.values()))
    return None


def xml_path(account_code: str, key: str) -> str:
    """Files of an account live under its code in each bucket (E06 export and deletion find them there)."""
    return f"invoices/{account_code}/{key}.xml"


def _update(conn: Any, import_id: str, **fields: Any) -> None:
    from psycopg.types.json import Jsonb

    sets = ", ".join(f"{k} = %s" for k in fields)
    values = [Jsonb(v) if k == "log" else v for k, v in fields.items()]
    conn.execute(f"update public.invoice_import set {sets} where id = %s", (*values, import_id))


def process_invoice_zip(conn: Any, files: FileStore, import_id: str, now: datetime | None = None) -> Outcome:
    started = time.monotonic()
    run = conn.execute(
        """select r.id, r.account_id::text, r.file_path, a.is_synthetic, a.code
           from public.invoice_import r join public.account a on a.id = r.account_id where r.id = %s""",
        (import_id,),
    ).fetchone()
    if run is None:
        raise Refused("run_not_found")
    account = run["account_id"]
    _update(conn, import_id, status="running")
    try:
        paused = conn.execute(
            "select exists (select 1 from public.import_source where account_id = %s and paused_at is not null) as p",
            (account,),
        ).fetchone()["p"]
        if paused:
            raise Refused("source_paused")
        try:
            read = read_zip(files.get(run["file_path"]))
        except InvoiceError as e:
            raise Refused(e.reason) from e
        companies = _companies(conn, account)
        buyers: dict[str, tuple[str, bool]] = {}
        rejected = dict(read.skipped)
        for inv in read.invoices:
            b = buyer_company(inv, companies)
            if b is None:
                rejected["buyer_not_in_account"] = rejected.get("buyer_not_in_account", 0) + 1
            else:
                buyers[inv.access_key] = b
        if not run["is_synthetic"]:
            missing = {cid for cid, ok in buyers.values() if not ok}
            if missing:
                raise Refused("no_owner_authorization", companies_without_authorization=len(missing))
        keys = list(buyers)
        known = {
            r["access_key"]
            for r in conn.execute(
                "select access_key from public.invoice where account_id = %s and access_key = any(%s)",
                (account, keys),
            ).fetchall()
        }
        new = [i for i in read.invoices if i.access_key in buyers and i.access_key not in known]
        for inv in new:
            files.put(xml_path(run["code"], inv.access_key), read.raw[inv.access_key], "application/xml")
        lines = 0
        with conn.transaction():
            for inv in new:
                row = conn.execute(
                    """insert into public.invoice (account_id, company_id, access_key, model, issuer_cnpj, issuer_name,
                                                   issued_at, total_cents, source, xml_path, invoice_import_id)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, 'xml_zip', %s, %s)
                       on conflict (account_id, access_key) do nothing returning id""",
                    (
                        account,
                        buyers[inv.access_key][0],
                        inv.access_key,
                        inv.model,
                        inv.issuer_cnpj,
                        inv.issuer_name,
                        inv.issued_at,
                        inv.total_cents,
                        xml_path(run["code"], inv.access_key),
                        import_id,
                    ),
                ).fetchone()
                if row is None:
                    continue
                for li in inv.lines:
                    conn.execute(
                        """insert into public.invoice_line (account_id, invoice_id, line_no, description, ncm, gtin, unit,
                                                            qty, unit_price_cents, total_cents)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            account,
                            row["id"],
                            li.line_no,
                            li.description,
                            li.ncm,
                            li.gtin,
                            li.unit,
                            li.qty,
                            li.unit_price_cents,
                            li.total_cents,
                        ),
                    )
                    lines += 1
        stats = zip_stats(new, read.duplicates_in_zip + len(known))
        auto = match_db.run_auto(conn, account) if lines else None
        if auto is not None and auto.left:
            match_db.enqueue_match(conn, account)
        _update(
            conn,
            import_id,
            status="ok",
            files_total=read.files_total,
            invoices_total=len(read.invoices),
            invoices_new=stats.invoices,
            duplicates=stats.duplicates,
            rejected=sum(rejected.values()),
            nfe_count=stats.nfe,
            nfce_count=stats.nfce,
            months_count=stats.months,
            suppliers_count=stats.suppliers,
            duration_ms=int((time.monotonic() - started) * 1000),
            log={
                "lines_new": lines,
                "rejected": rejected,
                "auto_confirmed": auto.auto_confirmed if auto else 0,
                "left_for_ai": auto.left if auto else 0,
            },
        )
        return Outcome("ok")
    except Refused as r:
        _update(
            conn,
            import_id,
            status="failed",
            duration_ms=int((time.monotonic() - started) * 1000),
            log={"reason": r.reason, **r.log},
        )
        return Outcome("failed", r.reason)
    except FileNotFoundError:
        _update(conn, import_id, status="failed", log={"reason": "file_missing"})
        return Outcome("failed", "file_missing")
