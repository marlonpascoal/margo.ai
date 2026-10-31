"""iFood public pages: what the collector needs to know about them, behind one interface.

Awaiting recordings. D40 and 06 forbid invented provider responses, and no public page has been recorded
yet (`fixtures/m1/` is empty until Marlon runs `uv run collector record`, see fixtures/m1/README.md). So
the only implementation here, `UnrecordedPages`, refuses before any request is made. The parser is coded
against the recordings once they exist, and its tests replay them.

What is known without a recording: the shape of a store URL (D29, the uuid at the end), already used by
the seed and C02.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Protocol

STORE_URL = re.compile(
    r"^(?:https?://)?(?:www\.)?ifood\.com\.br/delivery/[^/?#\s]+/[^/?#\s]+/"
    r"(?P<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?(?:[?#].*)?$",
    re.IGNORECASE,
)


def store_id_from_url(url: str) -> str | None:
    """D29: the iFood store uuid at the end of a public store URL, lower case; None if not one."""
    m = STORE_URL.match(url.strip())
    return m.group("id").lower() if m else None


def canonical_store_url(url: str) -> str:
    """https, www host, no query: the form kept in public_store.url."""
    u = url.strip().split("?", 1)[0].split("#", 1)[0].rstrip("/")
    u = re.sub(r"^(?:https?://)?(?:www\.)?", "https://www.", u, flags=re.IGNORECASE)
    return u


@dataclass(frozen=True)
class ParsedItem:
    external_item_id: str
    name: str
    price_cents: int
    unit: str = "un"
    unit_qty: Decimal | None = None
    description: str | None = None


@dataclass(frozen=True)
class ParsedStore:
    """What D47 lets us keep from a public store page: name, id, URL, address area, category, menu items,
    prices, units. No personal data."""

    external_id: str
    url: str
    name: str
    area: str | None
    category: str | None
    lat: Decimal | None
    lng: Decimal | None
    open_seen_at: datetime | None
    is_national_chain: bool = False
    delivers_to_target: bool | None = None
    items: tuple[ParsedItem, ...] = field(default=())


class AwaitingRecordings(Exception):
    """No public iFood page has been recorded yet; see fixtures/m1/README.md."""


class PublicPages(Protocol):
    def ready(self) -> bool:
        """False until the parser is coded against recorded pages. The collector checks this before
        making any request."""
        ...

    def neighborhood_urls(self, target: ParsedStore, radius_km: int, categories: list[str]) -> list[str]:
        """Public listing pages that show the stores around the target, for the chosen categories (M1-02:
        the category part of the competitive set is applied here, by searching only those categories)."""
        ...

    def parse_listing(self, body: bytes) -> list[str]:
        """Store page URLs found on a listing page."""
        ...

    def parse_store(self, url: str, body: bytes, seen_at: datetime) -> ParsedStore: ...


class UnrecordedPages:
    """Until recordings exist: refuses everything, before any request."""

    def ready(self) -> bool:
        return False

    def neighborhood_urls(self, target: ParsedStore, radius_km: int, categories: list[str]) -> list[str]:
        raise AwaitingRecordings()

    def parse_listing(self, body: bytes) -> list[str]:
        raise AwaitingRecordings()

    def parse_store(self, url: str, body: bytes, seen_at: datetime) -> ParsedStore:
        raise AwaitingRecordings()
