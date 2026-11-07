"""iFood public store URLs and the catalog row shape the seed tools and the memory repository use.

Pages are read by an external extractor (D47b, docs/extract-api.md), not here. What is known without one:
the shape of a store URL (D29, the uuid at the end), already used by the seed and C02.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

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
