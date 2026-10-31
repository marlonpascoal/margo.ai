"""Purchase invoices: the accountant's XML zip, a typed key and a QR link (06 §5, D11, D13, D01).

NF-e (model 55) and NFC-e (model 65) XMLs follow the public layout of the Portal da Nota Fiscal Eletrônica
(namespace http://www.portalfiscal.inf.br/nfe), parsed with the standard library. One invoice per access
key: a key already seen in the zip or in the database is a duplicate, counted and skipped (D11).

The access key (chave de acesso) has 44 digits: cUF(2) AAMM(4) CNPJ of the issuer(14) mod(2) serie(3)
nNF(9) tpEmis(1) cNF(8) cDV(1). cDV is mod 11 over the first 43 digits, weights 2 to 9 from the right,
remainder 0 or 1 gives 0 (same as app.nfe_access_key_valid).
"""

from __future__ import annotations

import io
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zoneinfo import ZoneInfo

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
NS = "{http://www.portalfiscal.inf.br/nfe}"
MAX_XML_BYTES = 5_000_000
MAX_FILES = 20_000


# Access key -----------------------------------------------------------------------------------------


def key_check_digit(first43: str) -> int:
    """06 §5: mod 11 check digit of an access key's first 43 digits."""
    total, weight = 0, 2
    for ch in reversed(first43):
        total += int(ch) * weight
        weight = 2 if weight == 9 else weight + 1
    r = total % 11
    return 0 if r < 2 else 11 - r


def key_valid(key: str) -> bool:
    """44 digits with a valid check digit."""
    return bool(re.fullmatch(r"\d{44}", key)) and key_check_digit(key[:43]) == int(key[43])


def key_model(key: str) -> int:
    return int(key[20:22])


def key_issuer_cnpj(key: str) -> str:
    return key[6:20]


def key_from_input(text: str) -> tuple[str, str] | None:
    """C10 "Cupom avulso": a typed key (spaces allowed) or the QR link's `p=` parameter (D13).

    Returns (key, source) with source key_typed or qr_url, or None when no valid key is found.
    """
    s = text.strip()
    if not s:
        return None
    if re.match(r"(?i)^https?://", s):
        query = urllib.parse.urlsplit(s).query
        values = urllib.parse.parse_qs(query).get("p") or []
        if not values:
            return None
        key = values[0].split("|", 1)[0].strip()
        return (key, "qr_url") if key_valid(key) and key_model(key) in (55, 65) else None
    key = re.sub(r"\s", "", s)
    return (key, "key_typed") if key_valid(key) and key_model(key) in (55, 65) else None


# XML ------------------------------------------------------------------------------------------------


class InvoiceError(Exception):
    """A file that is not a usable NF-e or NFC-e; reason is one of the short codes in the run log."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Line:
    line_no: int
    description: str
    ncm: str | None
    gtin: str | None
    unit: str
    qty: Decimal
    unit_price_cents: int
    total_cents: int


@dataclass(frozen=True)
class Invoice:
    access_key: str
    model: int
    issuer_cnpj: str
    issuer_name: str | None
    buyer_cnpj: str | None
    issued_at: datetime
    total_cents: int
    lines: list[Line] = field(default_factory=list)

    @property
    def month(self) -> str:
        return self.issued_at.astimezone(SAO_PAULO).strftime("%Y-%m")


def to_cents(value: str | None) -> int:
    """Reais as written in the XML ("38.90") to integer centavos, half up."""
    if value is None or value.strip() == "":
        return 0
    try:
        return int((Decimal(value.strip()) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except InvalidOperation as e:
        raise InvoiceError("bad_value") from e


def _text(el: ET.Element | None, tag: str) -> str | None:
    if el is None:
        return None
    child = el.find(NS + tag)
    if child is None or child.text is None:
        return None
    return child.text.strip() or None


def _gtin(value: str | None) -> str | None:
    if value and re.fullmatch(r"\d{8}|\d{12}|\d{13}|\d{14}", value):
        return value
    return None  # "SEM GTIN" or empty


def parse_xml(data: bytes) -> Invoice:
    """One NF-e or NFC-e XML (nfeProc or bare NFe) to an Invoice. Raises InvoiceError."""
    if len(data) > MAX_XML_BYTES:
        raise InvoiceError("too_large")
    if b"<!DOCTYPE" in data[:2000] or b"<!ENTITY" in data[:2000]:
        raise InvoiceError("not_invoice")  # no DTDs or entities in a fiscal document
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise InvoiceError("unreadable") from e
    inf = root.find(f".//{NS}infNFe")
    if inf is None:
        raise InvoiceError("not_invoice")  # events, cancellations, other documents
    key = (inf.get("Id") or "").removeprefix("NFe")
    if not key_valid(key):
        raise InvoiceError("invalid_key")
    ide, emit, dest = inf.find(NS + "ide"), inf.find(NS + "emit"), inf.find(NS + "dest")
    model = int(_text(ide, "mod") or 0)
    if model not in (55, 65) or model != key_model(key):
        raise InvoiceError("invalid_key")
    issuer = _text(emit, "CNPJ") or _text(emit, "CPF")
    if issuer is None or not re.fullmatch(r"\d{11}|\d{14}", issuer):
        raise InvoiceError("no_issuer")
    issued_raw = _text(ide, "dhEmi") or _text(ide, "dEmi")
    if issued_raw is None:
        raise InvoiceError("no_date")
    try:
        issued = datetime.fromisoformat(issued_raw)
    except ValueError as e:
        raise InvoiceError("no_date") from e
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=SAO_PAULO)
    lines: list[Line] = []
    for det in inf.findall(NS + "det"):
        prod = det.find(NS + "prod")
        if prod is None:
            continue
        qty = Decimal(_text(prod, "qCom") or "0")
        if qty <= 0:
            continue
        gross = to_cents(_text(prod, "vProd"))
        discount = to_cents(_text(prod, "vDesc"))
        ncm = _text(prod, "NCM")
        lines.append(
            Line(
                line_no=int(det.get("nItem") or len(lines) + 1),
                description=_text(prod, "xProd") or "",
                ncm=ncm if ncm and re.fullmatch(r"\d{8}", ncm) else None,
                gtin=_gtin(_text(prod, "cEAN")) or _gtin(_text(prod, "cEANTrib")),
                unit=(_text(prod, "uCom") or "UN").upper(),
                qty=qty,
                unit_price_cents=to_cents(_text(prod, "vUnCom")),
                # What was paid for the line: product value minus the line discount.
                total_cents=max(gross - discount, 0),
            )
        )
    tot = inf.find(f"{NS}total/{NS}ICMSTot")
    return Invoice(
        access_key=key,
        model=model,
        issuer_cnpj=issuer,
        issuer_name=_text(emit, "xNome"),
        buyer_cnpj=_text(dest, "CNPJ"),
        issued_at=issued,
        total_cents=to_cents(_text(tot, "vNF")),
        lines=lines,
    )


# Zip ------------------------------------------------------------------------------------------------


@dataclass
class ZipRead:
    """What one zip held: the distinct invoices and what was skipped, by reason."""

    invoices: list[Invoice] = field(default_factory=list)
    raw: dict[str, bytes] = field(default_factory=dict)
    files_total: int = 0
    duplicates_in_zip: int = 0
    skipped: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


def _xml_members(data: bytes) -> Iterator[tuple[str, bytes]]:
    """XML files of a zip, nested zips included (accountants often zip per month)."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise InvoiceError("not_zip") from e
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        if len(infos) > MAX_FILES:
            raise InvoiceError("too_many_files")
        for info in infos:
            name = info.filename.lower()
            if info.file_size > MAX_XML_BYTES * 20:
                continue
            if name.endswith(".zip"):
                yield from _xml_members(zf.read(info))
            elif name.endswith(".xml"):
                yield info.filename, zf.read(info)


def read_zip(data: bytes) -> ZipRead:
    """D01: parse every XML of the zip; the first file of a key wins, later ones are duplicates."""
    out = ZipRead()
    seen: set[str] = set()
    for _, xml in _xml_members(data):
        out.files_total += 1
        try:
            inv = parse_xml(xml)
        except InvoiceError as e:
            out.skip(e.reason)
            continue
        if inv.access_key in seen:
            out.duplicates_in_zip += 1
            continue
        seen.add(inv.access_key)
        out.invoices.append(inv)
        out.raw[inv.access_key] = xml
    return out


@dataclass(frozen=True)
class ZipStats:
    """C10 "312 notas · 12 meses · 41 fornecedores / NF-e: 268 · NFC-e: 44 · duplicadas: 9"."""

    invoices: int
    months: int
    suppliers: int
    nfe: int
    nfce: int
    duplicates: int


def zip_stats(saved: list[Invoice], duplicates: int) -> ZipStats:
    """Counts of the invoices this run saved; duplicates are the files skipped because the key was already
    in the zip or in the database (D11)."""
    return ZipStats(
        invoices=len(saved),
        months=len({i.month for i in saved}),
        suppliers=len({i.issuer_cnpj for i in saved}),
        nfe=sum(1 for i in saved if i.model == 55),
        nfce=sum(1 for i in saved if i.model == 65),
        duplicates=duplicates,
    )
