"""Layout-driven parsing of statement files (06 §2, §3, 04 §11, C17).

A layout is a `column_mapping`: header names to canonical fields, plus number and date formats. The
same code reads every source; `ifood_file` and `food99_file` only say which channel and file kind.
A file whose header row has no saved mapping goes to `needs_mapping` with a proposal (headers already
mapped in another layout of the channel are "conhecida", the rest "nova: confirmar").

Canonical output is the one the iFood API adapter will produce (03 §3): order facts, item facts and
signed ledger entries (debits negative), each with its natural key, so a re-import adds zero rows.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

SAO_PAULO = ZoneInfo("America/Sao_Paulo")

# Canonical fields a column can become (C17 "Vira o campo"). Labels are the C17 select options; the four
# drawn ones ("pedido", "venda bruta", "comissão", "promoção paga pelo app", "imposto retido",
# "parcela do repasse") are verbatim, the rest follow them.
FIELDS: dict[str, str] = {
    "order_id": "pedido",
    "store_id": "loja",
    "cnpj": "CNPJ",
    "ordered_at": "data do pedido",
    "status": "situação do pedido",
    "cancelled_by": "cancelado por",
    "cancel_reason": "motivo do cancelamento",
    "gross": "venda bruta",
    "items": "valor dos itens",
    "delivery_fee": "taxa de entrega do cliente",
    "items_text": "itens do pedido",
    "discount_channel": "promoção paga pelo app",
    "commission": "comissão",
    "payment_fee": "taxa de pagamento",
    "delivery": "entrega",
    "promotion": "promoção paga pela loja",
    "anticipation": "antecipação",
    "refund": "reembolso",
    "cancellation": "cancelamento",
    "adjustment": "ajuste",
    "tax": "imposto retido",
    "payout": "repasse",
    "payout_date": "data do repasse",
    "expected_payment_date": "data prevista do repasse",
    "installment": "parcela do repasse",
    "transaction_id": "id da transação",
}
IGNORE = "ignorar"

REQUIRED = ("order_id", "store_id", "ordered_at", "gross", "payout")

# Signed money columns that become ledger entries, and their ledger type (03 §3).
LEDGER_FIELDS: dict[str, str] = {
    "commission": "commission",
    "payment_fee": "payment_fee",
    "delivery": "delivery",
    "promotion": "promotion",
    "anticipation": "anticipation",
    "refund": "refund",
    "cancellation": "cancellation",
    "adjustment": "adjustment",
    "tax": "other",
}
MONEY_FIELDS = {"gross", "items", "delivery_fee", "discount_channel", "payout", *LEDGER_FIELDS}
DATE_FIELDS = {"ordered_at", "payout_date", "expected_payment_date"}

# Values of "situação" and "cancelado por" (synthetic layouts; real ones extend these lists).
CANCELLED = {"cancelado", "cancelada", "cancelled", "canceled"}
PARTY = {
    "cliente": "cliente",
    "loja": "loja",
    "restaurante": "loja",
    "app": "canal",
    "plataforma": "canal",
    "ifood": "canal",
    "99food": "canal",
    "entregador": "canal",
}


class LayoutError(Exception):
    """The file cannot be read as a table (no header row, unreadable bytes)."""


@dataclass(frozen=True)
class Mapping_:
    """A saved or proposed column_mapping.mapping: {"columns": {header: field}, formats}."""

    columns: dict[str, str]
    decimal: str = ","
    date_format: str = "%d/%m/%Y"

    @staticmethod
    def from_json(data: Mapping[str, Any]) -> Mapping_:
        return Mapping_(
            columns=dict(data.get("columns", {})),
            decimal=str(data.get("decimal", ",")),
            date_format=str(data.get("date_format", "%d/%m/%Y")),
        )

    def to_json(self) -> dict[str, Any]:
        return {"columns": self.columns, "decimal": self.decimal, "date_format": self.date_format}

    def field_of(self, header: str) -> str | None:
        f = self.columns.get(header)
        return None if f in (None, IGNORE) else f


@dataclass
class Table:
    headers: list[str]
    rows: list[list[Any]]
    preamble: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class OrderFact:
    store_ext: str
    external_order_id: str
    ordered_at: datetime
    gross_cents: int
    items_cents: int
    delivery_fee_cents: int
    discount_store_cents: int
    discount_channel_cents: int
    status: str
    cancelled_by: str | None
    cancel_reason: str | None


@dataclass(frozen=True)
class ItemFact:
    store_ext: str
    external_order_id: str
    line_no: int
    item_name: str
    qty: Decimal
    unit_price_cents: int


@dataclass(frozen=True)
class LedgerFact:
    store_ext: str
    external_entry_id: str
    external_order_id: str | None
    entry_date: date
    expected_payment_date: date | None
    type: str
    raw_type: str
    amount_cents: int


@dataclass
class Parsed:
    """Canonical rows of one file. `row_keys[i]` lists the natural keys row i produced."""

    orders: dict[tuple[str, str], OrderFact]
    items: dict[tuple[str, str, int], ItemFact]
    entries: dict[tuple[str, str], LedgerFact]
    row_keys: list[list[tuple[str, ...]]]
    rows_in_file: int
    payout_total_file_cents: int
    payout_total_mapped_cents: int
    cnpjs: set[str]

    @property
    def store_exts(self) -> set[str]:
        return {k[0] for k in self.orders} | {k[0] for k in self.entries}

    def period(self) -> tuple[date, date] | None:
        days = [o.ordered_at.astimezone(SAO_PAULO).date() for o in self.orders.values()]
        return (min(days), max(days)) if days else None


# Reading --------------------------------------------------------------------------------------------


def normalize_header(h: Any) -> str:
    return re.sub(r"\s+", " ", str(h or "")).strip()


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s.casefold()) if not unicodedata.combining(c))


def signature(headers: Iterable[str]) -> str:
    """C17: a layout is identified by its header row (case, accents and spacing do not matter)."""
    joined = "|".join(_fold(normalize_header(h)) for h in headers)
    return hashlib.sha256(joined.encode()).hexdigest()[:32]


def _header_index(rows: list[list[Any]]) -> int:
    """First row that looks like a header: at least 3 cells, every non-empty cell text."""
    for i, row in enumerate(rows[:30]):
        cells = [c for c in row if c not in (None, "")]
        if len(cells) >= 3 and all(isinstance(c, str) for c in cells):
            return i
    raise LayoutError("no header row in the first 30 rows")


def read_table(data: bytes, file_name: str) -> Table:
    """CSV (`;` or `,`, UTF-8 or Latin-1) or XLSX. Rows above the header (titles, SINTÉTICO) go apart."""
    name = file_name.lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as e:  # noqa: BLE001 (any openpyxl error means unreadable)
            raise LayoutError("unreadable xlsx") from e
        ws = wb.worksheets[0]
        raw = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("latin-1")
        first = text.splitlines()[0] if text else ""
        delim = ";" if text.count(";") >= text.count(",") or ";" in first else ","
        raw = [list(r) for r in csv.reader(io.StringIO(text), delimiter=delim)]
    raw = [r for r in raw if any(c not in (None, "") for c in r)]
    if not raw:
        raise LayoutError("empty file")
    hi = _header_index(raw)
    headers = [normalize_header(h) for h in raw[hi]]
    while headers and not headers[-1]:
        headers.pop()
    rows = [r[: len(headers)] + [None] * (len(headers) - len(r)) for r in raw[hi + 1 :]]
    preamble = [" ".join(str(c) for c in r if c not in (None, "")) for r in raw[:hi]]
    return Table(headers=headers, rows=rows, preamble=preamble)


# Values ---------------------------------------------------------------------------------------------


def to_cents(value: Any, decimal: str = ",") -> int:
    """Money cell to integer centavos. Accepts numbers (xlsx) and text in the layout's format."""
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        raise ValueError("boolean is not money")
    if isinstance(value, int | float | Decimal):
        d = Decimal(str(value))
    else:
        s = str(value).strip().replace("R$", "").replace("−", "-").replace(" ", "")
        if decimal == ",":
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
        try:
            d = Decimal(s)
        except InvalidOperation as e:
            raise ValueError(f"not money: {value!r}") from e
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_datetime(value: Any, fmt: str) -> datetime | None:
    """Date or date-time cell, as São Paulo local time."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        s = str(value).strip()
        dt = None
        for f in (f"{fmt} %H:%M:%S", f"{fmt} %H:%M", fmt, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(s, f)
                break
            except ValueError:
                continue
        if dt is None:
            raise ValueError(f"not a date: {value!r}")
    return dt if dt.tzinfo else dt.replace(tzinfo=SAO_PAULO)


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


ITEM = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*x\s+(.+?)\s+(-?[\d.]+,\d{2})\s*$", re.I)


def parse_items(text: str) -> list[tuple[Decimal, str, int]]:
    """'2x X-Bacon 36,90; 1x Refrigerante lata 5,00' to (qty, name, unit price in centavos)."""
    out = []
    for part in text.split(";"):
        m = ITEM.match(part)
        if m:
            out.append((Decimal(m.group(1).replace(",", ".")), m.group(2), to_cents(m.group(3))))
    return out


# Mapping --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ColumnStatus:
    name: str
    example: str
    field: str | None
    known: bool


def propose(headers: list[str], known: Iterable[Mapping_]) -> tuple[Mapping_, list[ColumnStatus], Mapping_]:
    """C17 proposal for an unknown layout: headers seen in a saved mapping keep their field.

    Returns (proposal, statuses without examples, base formats). Unknown headers are left unmapped.
    """
    by_header: dict[str, str] = {}
    base: Mapping_ | None = None
    for m in known:
        base = base or m
        for h, f in m.columns.items():
            by_header.setdefault(_fold(h), f)
    cols: dict[str, str] = {}
    statuses = []
    for h in headers:
        f = by_header.get(_fold(h))
        if f is not None:
            cols[h] = f
        statuses.append(ColumnStatus(h, "", f, f is not None))
    fmt = base or Mapping_(columns={})
    return Mapping_(cols, fmt.decimal, fmt.date_format), statuses, fmt


def examples(table: Table) -> dict[str, str]:
    """First non-empty, non-zero value of each column (C17 "Exemplo"); else the first non-empty one."""
    out: dict[str, str] = {}
    for j, h in enumerate(table.headers):
        first = ""
        for r in table.rows:
            v = r[j] if j < len(r) else None
            if v in (None, ""):
                continue
            s = _display(v)
            first = first or s
            if s not in ("0", "0,00", "-0,00"):
                out[h] = s
                break
        out.setdefault(h, first)
    return out


def _display(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.2f}".replace(".", ",")
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y %H:%M")
    return str(v)


def missing_required(mapping: Mapping_) -> list[str]:
    fields = set(mapping.columns.values())
    return [f for f in REQUIRED if f not in fields]


def apply(table: Table, mapping: Mapping_) -> Parsed:
    """Canonical rows of a table under a mapping. Raises ValueError on a bad cell or a missing field."""
    missing = missing_required(mapping)
    if missing:
        raise ValueError(f"mapping lacks required fields: {', '.join(missing)}")
    col = {mapping.field_of(h): j for j, h in enumerate(table.headers) if mapping.field_of(h)}
    payout_cols = [j for j, h in enumerate(table.headers) if mapping.field_of(h) == "payout"]

    def get(row: list[Any], f: str) -> Any:
        j = col.get(f)
        return row[j] if j is not None and j < len(row) else None

    def money(row: list[Any], f: str) -> int:
        return to_cents(get(row, f), mapping.decimal)

    orders: dict[tuple[str, str], OrderFact] = {}
    items: dict[tuple[str, str, int], ItemFact] = {}
    entries: dict[tuple[str, str], LedgerFact] = {}
    row_keys: list[list[tuple[str, ...]]] = []
    payout_file = 0
    cnpjs: set[str] = set()

    for row in table.rows:
        for j in payout_cols:
            payout_file += to_cents(row[j], mapping.decimal)
        store = _text(get(row, "store_id"))
        order = _text(get(row, "order_id"))
        if not store or not order:
            raise ValueError("row without store or order id")
        if "cnpj" in col:
            cnpjs.add(re.sub(r"\D", "", _text(get(row, "cnpj"))))
        ordered_at = to_datetime(get(row, "ordered_at"), mapping.date_format)
        assert ordered_at is not None
        order_day = ordered_at.astimezone(SAO_PAULO).date()
        status_text = _fold(_text(get(row, "status")))
        cancelled = status_text in CANCELLED
        party = PARTY.get(_fold(_text(get(row, "cancelled_by")))) if cancelled else None
        reason = _text(get(row, "cancel_reason")) or None
        gross = money(row, "gross")
        fee = money(row, "delivery_fee")
        promotion = money(row, "promotion")
        delivery_debit = money(row, "delivery")
        # 99Food-like layouts carry no customer delivery fee: what the channel takes for delivery is the
        # delivery debit itself (REP-03).
        delivery_fee = fee if "delivery_fee" in col else -delivery_debit
        items_cents = money(row, "items") if "items" in col else gross
        keys: list[tuple[str, ...]] = [("order", store, order)]
        orders.setdefault(
            (store, order),
            OrderFact(
                store_ext=store,
                external_order_id=order,
                ordered_at=ordered_at,
                gross_cents=gross,
                items_cents=items_cents,
                delivery_fee_cents=delivery_fee,
                discount_store_cents=-promotion,
                discount_channel_cents=money(row, "discount_channel"),
                status="cancelado" if cancelled else "concluido",
                cancelled_by=party,
                cancel_reason=reason if cancelled else None,
            ),
        )
        if "items_text" in col:
            for n, (qty, name, price) in enumerate(parse_items(_text(get(row, "items_text"))), start=1):
                items.setdefault((store, order, n), ItemFact(store, order, n, name, qty, price))
                keys.append(("item", store, order, str(n)))
        expected = to_datetime(get(row, "expected_payment_date"), mapping.date_format)
        expected_day = expected.date() if expected else None
        for f, typ in LEDGER_FIELDS.items():
            amount = money(row, f)
            if f not in col or amount == 0:
                continue
            key = f"{order}:{typ}" if typ != "other" else f"{order}:{f}"
            entries.setdefault(
                (store, key),
                LedgerFact(store, key, order, order_day, expected_day, typ, FIELDS[f], amount),
            )
            keys.append(("entry", store, key))
        payout = money(row, "payout")
        if payout != 0:
            tx = _text(get(row, "transaction_id"))
            installment = _text(get(row, "installment"))
            key = tx or (f"{order}:payout:{installment}" if installment else f"{order}:payout")
            paid = to_datetime(get(row, "payout_date"), mapping.date_format)
            raw = "repasse" + (f" {installment}" if installment else "")
            entries.setdefault(
                (store, key),
                LedgerFact(
                    store,
                    key,
                    order,
                    (paid.date() if paid else order_day),
                    expected_day,
                    "payout",
                    raw,
                    payout,
                ),
            )
            keys.append(("entry", store, key))
        row_keys.append(keys)

    mapped = sum(e.amount_cents for e in entries.values() if e.type == "payout")
    return Parsed(orders, items, entries, row_keys, len(table.rows), payout_file, mapped, cnpjs)


def month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return start, nxt - timedelta(days=1)
