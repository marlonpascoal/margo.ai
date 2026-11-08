"""M1-13 (D75, Marlon 08/nov): what kind of dish each food item is, read by the AI provider (D70) once per
pattern.

A menu rarely says the size of prepared food, so "the same product" cannot be proven. The range compares a
dish with the same family nearby: temaki with temaki, mini with mini. The rule lists know too few dishes, so
every food item is classified, not only the ones the rules cannot read.

What goes out: name, description and section of the item, never a store, a person or a price. Tests use a
fake; no test calls the API (06, D40)."""

from __future__ import annotations

import json
from collections.abc import Collection, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Protocol

from margo_common import llm
from margo_common.log import log_event

from .attributes import plain
from .food import description_hints_m1_04
from .rules import (
    FamilyRange,
    Item,
    Normalized,
    is_food_m1_04,
    item_category_m1_04,
    name_tokens,
    normalize_m1_03,
    range_m1_13,
)

MODEL_ENV = "MARGO_FAMILY_MODEL"
BATCH = 150
THREADS = 4

FAMILY_LABEL: dict[str, str] = {
    "hamburguer": "hambúrguer",
    "cachorro_quente": "cachorro-quente",
    "sanduiche": "sanduíche",
    "pastel": "pastel",
    "salgado": "salgado",
    "esfiha": "esfiha",
    "pizza": "pizza",
    "espeto": "espeto",
    "churrasco": "churrasco",
    "frango_assado": "frango assado",
    "prato_feito": "prato feito",
    "massa": "massa",
    "lasanha": "lasanha",
    "risoto": "risoto",
    "strogonoff": "strogonoff",
    "parmegiana": "parmegiana",
    "feijoada": "feijoada",
    "temaki": "temaki",
    "sashimi": "sashimi",
    "uramaki": "uramaki",
    "hossomaki": "hossomaki",
    "niguiri": "niguiri",
    "hot_roll": "hot roll",
    "combinado": "combinado",
    "carpaccio": "carpaccio",
    "ceviche": "ceviche",
    "poke": "poke",
    "yakisoba": "yakisoba",
    "guioza": "guioza",
    "harumaki": "harumaki",
    "tempura": "tempurá",
    "sopa": "sopa",
    "salada": "salada",
    "batata_frita": "batata frita",
    "isca": "isca",
    "mandioca": "mandioca",
    "polenta": "polenta",
    "bolinho": "bolinho",
    "petisco": "petisco",
    "acai": "açaí",
    "sorvete": "sorvete",
    "bolo_torta": "bolo ou torta",
    "doce": "doce",
    "outro": "outro",
}
PROTEIN_LABEL: dict[str, str | None] = {
    "bovino": "carne",
    "frango": "frango",
    "porco": "porco",
    "linguica": "linguiça",
    "salmao": "salmão",
    "atum": "atum",
    "tilapia": "tilápia",
    "peixe_outro": "peixe",
    "camarao": "camarão",
    "polvo": "polvo",
    "vegetal": "vegetal",
    "queijo": "queijo",
    "sem_proteina": None,
}
SIZES = ("mini", "individual", "normal", "grande", "compartilhar")

SYSTEM = (
    "Você classifica itens de cardápio de restaurantes. Use só o nome, a descrição e a seção. "
    "familia: o tipo de prato, da lista; 'outro' se nenhum servir. A seção ajuda quando o nome não diz: "
    "'Frango' na seção 'Espetos' é espeto. "
    "proteina: a proteína principal, da lista; 'sem_proteina' se não tiver. "
    "tamanho: 'mini' para itens chamados mini ou pequenos; 'individual' quando diz individual; 'grande' para "
    "grande ou família; 'compartilhar' quando serve duas pessoas ou mais; senão 'normal'."
)
OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "itens": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string"},
                    "familia": {"type": "string", "enum": list(FAMILY_LABEL)},
                    "proteina": {"type": "string", "enum": list(PROTEIN_LABEL)},
                    "tamanho": {"type": "string", "enum": list(SIZES)},
                },
                "required": ["ref", "familia", "proteina", "tamanho"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["itens"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class Family:
    family: str
    protein: str
    size: str


@dataclass(frozen=True)
class FamilyAsk:
    ref: str
    name: str
    description: str | None
    section: str | None


class FamilyClassifier(Protocol):
    model: str

    def classify(self, items: Sequence[FamilyAsk]) -> dict[str, Family]: ...


def family_key(item: Item) -> str:
    """Name tokens, description hints and section: the section decides "Frango" under "Espetos"."""
    category = item_category_m1_04(item) or ""
    return json.dumps(
        [
            sorted(name_tokens(item.name)),
            description_hints_m1_04(item.description, category),
            plain(item.section),
        ],
        ensure_ascii=False,
    )


def build_call(items: Sequence[FamilyAsk]) -> llm.Call:
    payload = {
        "itens": [
            {"ref": i.ref, "nome": i.name, "descricao": i.description, "secao": i.section} for i in items
        ]
    }
    return llm.Call("familia_de_itens", SYSTEM, payload, OUTPUT_SCHEMA, 16000)


def parse_answer(answer: Mapping[str, Any] | None, refs: Collection[str]) -> dict[str, Family]:
    """Only a ref we sent, once, with words from the lists."""
    rows = answer.get("itens") if answer else None
    out: dict[str, Family] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, Mapping):
            continue
        ref, fam, protein, size = (str(row.get(k, "")) for k in ("ref", "familia", "proteina", "tamanho"))
        if (
            ref in refs
            and ref not in out
            and fam in FAMILY_LABEL
            and protein in PROTEIN_LABEL
            and size in SIZES
        ):
            out[ref] = Family(fam, protein, size)
    return out


class AiFamilyClassifier:
    """The real FamilyClassifier over `margo_common.llm` (model: MARGO_FAMILY_MODEL)."""

    def __init__(self, client: Any = None, model: str | None = None, provider: str | None = None) -> None:
        self.ai = llm.StructuredClient(client, model, provider, MODEL_ENV)
        self.model = self.ai.model

    def classify(self, items: Sequence[FamilyAsk]) -> dict[str, Family]:
        batches = [items[n : n + BATCH] for n in range(0, len(items), BATCH)]

        def one(batch: Sequence[FamilyAsk]) -> dict[str, Family]:
            return parse_answer(self.ai.ask(build_call(batch)), {i.ref for i in batch})

        out: dict[str, Family] = {}
        with ThreadPoolExecutor(THREADS) as pool:
            for got in pool.map(one, batches):
                out.update(got)
        return out


def classifier_from_env() -> AiFamilyClassifier | None:
    return AiFamilyClassifier() if llm.key_present() else None


def classify_step_m1_13(
    items: Iterable[Item],
    known: Mapping[str, Family],
    classifier: FamilyClassifier | None,
    xray_id: str = "",
) -> dict[str, Family]:
    """The families new in this run: one question per pattern, nothing already known."""
    if classifier is None:
        return {}
    pending: dict[str, Item] = {}
    for item in items:
        if is_food_m1_04(item):
            key = family_key(item)
            if key not in known:
                pending.setdefault(key, item)
    if not pending:
        return {}
    keys = sorted(pending)
    asks = [
        FamilyAsk(str(n), pending[k].name, pending[k].description, pending[k].section)
        for n, k in enumerate(keys)
    ]
    found = classifier.classify(asks)
    log_event("m1_family", xray_id=xray_id, asked=len(asks), answered=len(found), model=classifier.model)
    return {keys[int(ref)]: fam for ref, fam in found.items()}


def _size_group(size: str) -> str:
    """Individual and normal are the portions most stores never tell apart."""
    return "normal" if size in ("individual", "normal") else size


def basis_words(fam: Family, *, with_protein: bool) -> str:
    words = [FAMILY_LABEL[fam.family]]
    if fam.size in ("mini", "grande"):
        words.append(fam.size)
    protein = PROTEIN_LABEL[fam.protein] if with_protein else None
    if protein:
        words.append(f"de {protein}")
    return " ".join(words)


def _store_prices(rows: Sequence[tuple[Item, Family]], norm: Normalized) -> list[int]:
    """One middle price per store, on the own item's size when it has one."""
    by_store: dict[str, list[Fraction]] = {}
    for item, _ in rows:
        n = normalize_m1_03(item)
        value = n.per_base * norm.own_base_qty if norm.by_weight_or_pack else Fraction(item.price_cents)
        by_store.setdefault(item.store_id, []).append(value)
    return [round(sorted(v)[(len(v) - 1) // 2]) for v in by_store.values()]


def family_ranges_m1_13(
    own: Sequence[tuple[str, Item]],
    pool: Sequence[Item],
    families: Mapping[str, Family],
    min_stores: int,
) -> dict[str, FamilyRange]:
    """M1-13: for each (key, own item), the range of the same family and size group nearby, the same
    protein when enough stores sell it, else the family. A store counts once at its middle price. An item
    with a size is compared per piece, per 100 g or per 100 ml, only with items that state one."""
    peers: dict[tuple[str, str], list[tuple[Item, Family]]] = {}
    for item in pool:
        fam = families.get(family_key(item)) if is_food_m1_04(item) else None
        if fam is not None:
            peers.setdefault((fam.family, _size_group(fam.size)), []).append((item, fam))
    out: dict[str, FamilyRange] = {}
    for key, item in own:
        fam = families.get(family_key(item)) if is_food_m1_04(item) else None
        if fam is None or fam.family == "outro":
            continue
        norm = normalize_m1_03(item)
        same_basis = [
            (p, f)
            for p, f in peers.get((fam.family, _size_group(fam.size)), [])
            if p.store_id != item.store_id
            and normalize_m1_03(p).by_weight_or_pack == norm.by_weight_or_pack
            and (not norm.by_weight_or_pack or normalize_m1_03(p).unit == norm.unit)
        ]

        protein_rows = [(p, f) for p, f in same_basis if f.protein == fam.protein]
        specific = _store_prices(protein_rows, norm)
        with_protein = fam.protein != "sem_proteina" and len(specific) >= min_stores
        chosen = specific if with_protein else _store_prices(same_basis, norm)
        if len(chosen) >= min_stores:
            out[key] = FamilyRange(
                range_m1_13(item.price_cents, chosen),
                len(chosen),
                basis_words(fam, with_protein=with_protein),
            )
    return out
