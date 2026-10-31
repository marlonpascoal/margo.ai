"""De-para, pure part (D14, C11): an invoice line to a catalog ingredient.

Order (D14): 1. GTIN present and in the catalog; 2. a rule (normalized text tokens plus NCM plus unit);
3. an AI suggestion for what is left (margo_match.ai). GTIN and rule matches are confirmed without a person
("casado sem mão"); an AI suggestion stays `suggested` until a founder confirms it in C11 and never enters a
cost before that (D02).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal

# Line units that are a measure of the ingredient's base unit: base units per invoice unit.
MEASURE_UNITS: dict[str, dict[str, int]] = {
    "g": {"KG": 1000, "KILO": 1000, "G": 1, "GR": 1},
    "ml": {"L": 1000, "LT": 1000, "LITRO": 1000, "ML": 1},
    "un": {"UN": 1, "UND": 1, "UNID": 1, "UNIDADE": 1, "U": 1},
}


def normalize(text: str) -> str:
    """Upper case, no accents, separators to spaces."""
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9,./]+", " ", t)).strip()


def tokens(text: str) -> list[str]:
    """Word tokens of a description (quantities like 2,5KG stay one token)."""
    return [t for t in re.split(r"[ /]+", normalize(text)) if t]


def _num(s: str) -> Decimal:
    return Decimal(s.replace(",", "."))


def conversion_factor(description: str, unit: str, base_unit: str) -> Decimal | None:
    """Base units of the ingredient per invoice unit, or None when the line does not say.

    "CARNE ... KG" in KG for a g ingredient: 1000. "QJO ... 2,27KG 160FT" in PC: 2270.
    "PAO HAMB BRIOCHE GERG C/12" in PCT for an un ingredient: 12. "REFRIG ... LT 350ML" in UN: 1.
    """
    u = normalize(unit)
    direct = MEASURE_UNITS.get(base_unit, {}).get(u)
    if direct is not None:
        return Decimal(direct)
    d = normalize(description)
    if base_unit == "g":
        m = re.search(r"(\d+(?:[,.]\d+)?)\s*(KG|G|GR)\b", d)
        if m:
            return _num(m.group(1)) * (1000 if m.group(2) == "KG" else 1)
    elif base_unit == "ml":
        m = re.search(r"(\d+(?:[,.]\d+)?)\s*(L|LT|ML)\b", d)
        if m:
            return _num(m.group(1)) * (1 if m.group(2) == "ML" else 1000)
    elif base_unit == "un":
        m = re.search(r"\bC\s*/?\s*(\d+)\b", d) or re.search(r"\b(\d+)\s*(?:UN|UND|UNID)\b", d)
        if m and int(m.group(1)) > 0:
            return Decimal(m.group(1))
    return None


@dataclass(frozen=True)
class CatalogItem:
    id: str
    name: str
    category: str
    base_unit: str
    gtins: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Rule:
    id: str | None
    ingredient_id: str
    keywords: tuple[str, ...]
    ncm_prefix: str | None = None
    unit: str | None = None

    def matches(self, line: LineIn) -> bool:
        words = set(tokens(line.description))
        if not all(k in words for k in self.keywords):
            return False
        if self.ncm_prefix and not (line.ncm or "").startswith(self.ncm_prefix):
            return False
        return not (self.unit and normalize(self.unit) != normalize(line.unit))

    @property
    def note(self) -> str:
        """ingredient_match.rule_note (C11 "regra: ..."): "texto + NCM 0201", "texto + unidade"."""
        if self.ncm_prefix:
            return f"texto + NCM {self.ncm_prefix[:4]}"
        if self.unit:
            return "texto + unidade"
        return "texto"


@dataclass(frozen=True)
class LineIn:
    id: str
    description: str
    ncm: str | None
    gtin: str | None
    unit: str


@dataclass(frozen=True)
class Match:
    line_id: str
    ingredient_id: str
    method: str  # gtin, rule, ai
    conversion_factor: Decimal | None
    rule_note: str | None = None
    confidence: Decimal | None = None


def match_gtin(line: LineIn, catalog: list[CatalogItem]) -> CatalogItem | None:
    if not line.gtin:
        return None
    hits = [c for c in catalog if line.gtin in c.gtins]
    return hits[0] if len(hits) == 1 else None


def match_rule(line: LineIn, rules: list[Rule]) -> Rule | None:
    """The most specific rule that matches; a tie between different ingredients is no match."""
    hits = [r for r in rules if r.matches(line)]
    if not hits:
        return None

    def weight(r: Rule) -> tuple[int, int, int]:
        return (len(r.keywords), len(r.ncm_prefix or ""), 1 if r.unit else 0)

    best = max(weight(r) for r in hits)
    top = {r.ingredient_id for r in hits if weight(r) == best}
    if len(top) != 1:
        return None
    return next(r for r in hits if weight(r) == best)


def auto_match(line: LineIn, catalog: list[CatalogItem], rules: list[Rule]) -> Match | None:
    """D14 steps 1 and 2. None when the line goes to the AI step (or stays without a pair)."""
    by_id = {c.id: c for c in catalog}
    hit = match_gtin(line, catalog)
    if hit is not None:
        return Match(line.id, hit.id, "gtin", conversion_factor(line.description, line.unit, hit.base_unit))
    rule = match_rule(line, rules)
    if rule is not None and rule.ingredient_id in by_id:
        base = by_id[rule.ingredient_id].base_unit
        return Match(
            line.id,
            rule.ingredient_id,
            "rule",
            conversion_factor(line.description, line.unit, base),
            rule.note,
        )
    return None


def learned_rule(description: str, ncm: str | None, unit: str, ingredient_id: str) -> Rule:
    """D14: a person's confirmation becomes a rule for the next client: every token of the description that
    is a word (no quantities), the full NCM and the unit."""
    words = tuple(sorted({t for t in tokens(description) if re.fullmatch(r"[A-Z]{2,}", t)}))
    return Rule(None, ingredient_id, words or tuple(tokens(description)), ncm, normalize(unit))


def price_per_base_unit(total_cents: int, qty: Decimal, conversion: Decimal) -> Decimal:
    """CST-01 input: centavos per base unit of a confirmed line (same formula as
    public.confirm_ingredient_match)."""
    return Decimal(total_cents) / (qty * conversion)
