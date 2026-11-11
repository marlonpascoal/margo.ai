"""M1-14 (D81, Marlon, 10/nov): a combo compares by the sum of its parts.

Combos almost never pair with another store's combo (each shop builds its own), so the combo is split into
parts ("4 Dog queijo + Coca 2 litros"), each part is found among the store's own single items, and two
readings come out:

- the combo discount: the combo against its parts bought singly in the same store, no neighbor needed;
- the neighbors' sum: the sum of each part's own reference (its parity, or its M1-13 range), as a range.

A part that is not found gives no number at all. No AI here: unreadable parts stay unread and say so."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .rules import Item, PriceRange, item_category_m1_04, item_is_combo_m1_04

_PREFIX_WORDS = {
    "combo",
    "combos",
    "kit",
    "top",
    "trio",
    "lanche",
    "porcao",
    "mega",
    "galera",
    "especial",
    "duplo",
    "dupla",
}
_STOP = {"de", "da", "do", "das", "dos", "com", "c", "ml", "un", "und", "unid", "the"}
_GENERIC_DRINK = {"bebida", "bebidas", "refrigerante", "refri"}


@dataclass(frozen=True)
class ComboPart:
    qty: int
    text: str


@dataclass(frozen=True)
class PartRef:
    """A part's reference in the run: its parity (low = high) or its M1-13 range, and the stores behind it."""

    low_cents: int
    high_cents: int
    stores: int


@dataclass(frozen=True)
class ComboReading:
    solo_cents: int
    """The parts bought singly in the same store."""
    range: PriceRange | None
    """The neighbors' sum of the parts; None when a part has no reference."""
    stores: int | None
    parts: tuple[dict[str, Any], ...]


def _plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()
    s = re.sub(r"(\d+)\s*(?:l|lt|lts|litros?)\b", r"\1 litro", s)
    s = re.sub(r"(\d+)\s*ml\b", r"\1", s)
    return re.sub(r"\s+", " ", s).strip(" .-")


def _tokens(s: str) -> list[str]:
    out = []
    for t in re.findall(r"[a-z0-9]+", _plain(s)):
        if t in _STOP:
            continue
        out.append(t[:-1] if len(t) > 3 and t.endswith("s") and not t.isdigit() else t)
    return out


def split_combo_m1_14(name: str) -> tuple[ComboPart, ...]:
    """M1-14: the parts of a combo name and how many of each. A leading label before " - " ("Combo Top - ...")
    is dropped when the rest holds the parts."""
    s = _plain(name)
    while " - " in s:
        left, right = s.split(" - ", 1)
        if "+" not in right or ("+" in left and not set(_tokens(left)) <= _PREFIX_WORDS):
            break
        s = right
    parts = []
    for raw in re.split(r"\+|,|\be\b", s):
        p = raw.strip(" .-")
        if not p:
            continue
        m = re.match(r"^(\d+)\s*x?\s+(.*)$", p)
        qty, text = (
            (int(m.group(1)), m.group(2).strip()) if m and not re.match(r"^\d+\s*litro", p) else (1, p)
        )
        parts.append(ComboPart(qty, text))
    return tuple(parts)


def _is_drink(i: Item) -> bool:
    return item_category_m1_04(i) == "bebidas"


def match_part_m1_14(text: str, menu: Sequence[Item], known: Collection[str] = ()) -> Item | None:
    """M1-14: the store's own single item a part names.

    A generic drink ("bebida", "bebida lata") is the store's cheapest can, else its cheapest drink.
    Otherwise an item whose name holds every word of the part (a number may be missing); ties go to a
    name that starts like the part, then the plainer name, then the lower price ("fritas" is the plain
    fries, "burguer" the burger called so, not "Egg Burguer"). Among generic drinks, one whose id is in
    `known` (it has a reference in the run) comes first."""
    singles = [i for i in menu if not item_is_combo_m1_04(i) and i.price_cents > 0]
    want = _tokens(text)
    if not want:
        return None
    if set(want) & _GENERIC_DRINK and not set(want) - _GENERIC_DRINK - {"lata", "350"}:
        drinks = [i for i in singles if _is_drink(i)]
        cans = [i for i in drinks if {"lata", "350"} & set(_tokens(i.name))]
        pool = cans or drinks
        return min(pool, key=lambda i: (i.id not in known, i.price_cents, i.id)) if pool else None
    words = [t for t in want if not t.isdigit()]
    if not words:
        return None
    best: tuple[int, int, int, int, str] | None = None
    found: Item | None = None
    for i in singles:
        have = _tokens(i.name)
        if not all(t in have for t in words):
            continue
        numbers = sum(t in have for t in want if t.isdigit())
        key = (-numbers, 0 if have[0] == want[0] else 1, len(have), i.price_cents, i.id)
        if best is None or key < best:
            best, found = key, i
    return found


def combo_m1_14(combo: Item, menu: Sequence[Item], refs: Mapping[str, PartRef]) -> ComboReading | None:
    """M1-14: the two readings of a combo, or None when any part is not found in the store's own menu."""
    parts = split_combo_m1_14(combo.name)
    if len(parts) < 2 and (not parts or parts[0].qty < 2):
        return None
    found = [(p, match_part_m1_14(p.text, menu, refs.keys())) for p in parts]
    if any(i is None for _, i in found):
        return None
    pairs = [(p, i) for p, i in found if i is not None]
    solo = sum(p.qty * i.price_cents for p, i in pairs)
    shown = tuple(
        {"part": p.text, "qty": p.qty, "item": i.name, "price_cents": i.price_cents} for p, i in pairs
    )
    if not all(i.id in refs for _, i in pairs):
        return ComboReading(solo, None, None, shown)
    low = sum(p.qty * refs[i.id].low_cents for p, i in pairs)
    high = sum(p.qty * refs[i.id].high_cents for p, i in pairs)
    position: Literal["abaixo", "dentro", "acima"] = (
        "abaixo" if combo.price_cents < low else "acima" if combo.price_cents > high else "dentro"
    )
    return ComboReading(
        solo, PriceRange(low, high, position), min(refs[i.id].stores for _, i in pairs), shown
    )
