"""M1-13 (D75, Marlon 08/nov): what kind of dish each food item is, read by the AI provider (D70) once per
pattern.

A menu rarely says the size of prepared food, so "the same product" cannot be proven. The range compares a
dish with the same family nearby: temaki with temaki, mini with mini. The rule lists know too few dishes, so
every food item is classified, not only the ones the rules cannot read.

What goes out: name, description and section of the item, never a store, a person or a price. Tests use a
fake; no test calls the API (06, D40)."""

from __future__ import annotations

import json
import re
from collections.abc import Collection, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
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
    "salsicha": "salsicha",
    **{
        f"{b}_{f}": f"{PB} e {PF}"
        for b, PB in (("salsicha", "salsicha"), ("linguica", "linguiça"))
        for f, PF in (("frango", "frango"), ("carne", "carne"), ("bacon", "bacon"), ("queijo", "queijo"))
    },
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


FAMILY_TERM: dict[str, str] = {
    "hamburguer": "Hambúrguer",
    "cachorro_quente": "Lanches",
    "sanduiche": "Lanches",
    "pastel": "Pastel",
    "salgado": "Salgados",
    "esfiha": "Árabe",
    "pizza": "Pizza",
    "espeto": "Carnes",
    "churrasco": "Carnes",
    "frango_assado": "Frangos",
    "prato_feito": "Marmita",
    "strogonoff": "Brasileira",
    "parmegiana": "Brasileira",
    "feijoada": "Brasileira",
    "massa": "Italiana",
    "lasanha": "Italiana",
    "risoto": "Italiana",
    "temaki": "Japonesa",
    "sashimi": "Japonesa",
    "uramaki": "Japonesa",
    "hossomaki": "Japonesa",
    "niguiri": "Japonesa",
    "hot_roll": "Japonesa",
    "combinado": "Japonesa",
    "carpaccio": "Japonesa",
    "ceviche": "Japonesa",
    "poke": "Japonesa",
    "harumaki": "Japonesa",
    "guioza": "Japonesa",
    "tempura": "Japonesa",
    "yakisoba": "Chinesa",
    "salada": "Saudável",
    "acai": "Sorvetes",
    "sorvete": "Sorvetes",
    "bolo_torta": "Doces & Bolos",
    "doce": "Doces & Bolos",
}
"""M1-02 (D76): the iFood search term of each family, from the categories iFood shows on stores."""
MIN_MENU_SHARE = 0.15


def menu_term_shares_m1_02(items: Iterable[Item], families: Mapping[str, Family]) -> dict[str, float]:
    """M1-02 (D76): the search terms a store's own menu asks for, each with its share of the food items. A
    term under `MIN_MENU_SHARE` is noise; a family with no term (a side dish) counts in no term."""
    known = [families[k] for k in (family_key(i) for i in items if is_food_m1_04(i)) if k in families]
    counts: dict[str, int] = {}
    for fam in known:
        term = FAMILY_TERM.get(fam.family)
        if term:
            counts[term] = counts.get(term, 0) + 1
    shares = {term: n / len(known) for term, n in counts.items()}
    return {term: share for term, share in shares.items() if share >= MIN_MENU_SHARE}


# M1-15 (D82, Marlon, 10/nov): what sets a sandwich's price for a burger or hot-dog shop, read from the
# name. A lanchonete "X-Salada" with a thin industrial patty and a 160 g blend are different markets; two
# patties are not one.
SANDWICH_FAMILIES = frozenset({"hamburguer", "sanduiche", "cachorro_quente"})
_GRAMS = re.compile(r"\b(\d{2,3})\s*(?:g|gr|grs|gramas?)\b")
_BARE_GRAMS = re.compile(r"\b(1\d{2}|2[0-5]\d)\b(?!\s*(?:ml|cm|l)\b)")
_LANCHONETE = re.compile(
    r"^(?:x|xis)\b|^x-|\bx-?(?:salada|bacon|burguer|burger|tudo|egg|calabresa|frango|picanha|dog)\b"
)
_SMASH = re.compile(r"\bsmash")
_KIDS = re.compile(r"\b(?:kids?|infantil|crianca)\b")
_ARTESANAL = re.compile(r"\b(?:artesanal|blend|angus|brioche)\b")
_TRIPLE = re.compile(r"\b(?:tripl[oa]|3 carnes|3x|triple)\b")
_DOUBLE = re.compile(r"\b(?:dupl[oa]|2 carnes|2x|double)\b")
_IS_DOG = re.compile(r"\b(?:dog|dogao|doguinho|cachorro|hot)")
_SWEET = re.compile(r"\b(?:chocolate|nutella|doce|morango|brigadeiro|ninho|banana)\b")


@dataclass(frozen=True)
class SandwichAttrs:
    segment: str | None
    """"artesanal", "lanchonete", "smash", "infantil", or None when the name does not say."""
    patties: int
    grams: int | None
    excluded: bool = False
    """Not the dish its family says: a "xis" read as a hot dog, a sweet dog."""


def sandwich_attrs_m1_15(item: Item, fam: Family | None = None) -> SandwichAttrs:
    """M1-15: segment, number of patties (or sausages) and grams of meat, from the name. Words win; a blend
    of 120 g
    or more written in the name makes it artesanal."""
    n = plain(item.name)
    patties = 3 if _TRIPLE.search(n) else 2 if _DOUBLE.search(n) else 1
    m = _GRAMS.search(n) or _BARE_GRAMS.search(n)
    grams = int(m.group(1)) if m else None
    segment = (
        "infantil"
        if _KIDS.search(n)
        else "smash"
        if _SMASH.search(n)
        else "lanchonete"
        if _LANCHONETE.search(n)
        else "artesanal"
        if _ARTESANAL.search(n) or (grams is not None and grams >= 120)
        else None
    )
    excluded = (
        fam is not None
        and fam.family == "cachorro_quente"
        and (not _IS_DOG.search(n) or bool(_SWEET.search(n)))
    )
    return SandwichAttrs(segment, patties, grams, excluded)


_LINGUICA = re.compile(r"\b(?:linguica|calabresa|toscana)\b")


_FILLINGS = (
    ("frango", re.compile(r"\b(?:frango|galinha|chicken)\b")),
    ("carne", re.compile(r"\b(?:carne|bovin\w*|moida)\b")),
    ("bacon", re.compile(r"\bbacon\b")),
    ("queijo", re.compile(r"\b(?:queijo|cheddar|catupiry|requeij\w*)\b")),
)


def dog_protein_m1_15(item: Item, fam: Family) -> Family:
    """M1-15 (Marlon, 10/nov): "dog" and cachorro-quente are the same dish and always hold salsicha
    ("duplo" is two), unless the name says linguiça, calabresa or toscana. What else the name holds is the
    filling: "Dog bacon" is salsicha and bacon, "Dog duplo frango" two salsichas and frango. The range takes
    the same filling when enough stores sell it (the protein step of M1-13), else every hot dog with as many
    sausages."""
    if fam.family != "cachorro_quente":
        return fam
    name = plain(item.name)
    base = "linguica" if _LINGUICA.search(name) else "salsicha"
    filling = next((f for f, rx in _FILLINGS if rx.search(name)), None)
    return Family(fam.family, f"{base}_{filling}" if filling else base, fam.size)


# M1-16 (D84, Marlon, 11/nov): what sets a skewer's price for an espetaria: the cut, and whether it is
# one skewer or a portion to share. A sweet skewer (fruit with chocolate, churros) is another product.
_SWEET_SKEWER = re.compile(
    r"\b(?:chocolate|churros?|brigadeiro|doce|nutella|morango|uva|abacaxi|banana|marshmallow)\b"
)
_SKEWER_PORTION = re.compile(r"\b(?:porcao|compartilh\w*|famil\w*|kg|combo|meia|rodizio)\b|\d+\s*espet")
SKEWER_CUTS = (
    ("mandioca", r"mandioca"),
    ("coracao", r"coracao|coracaozinho"),
    ("medalhao_frango", r"medalhao\s+de\s+frango|frango\s+com\s+bacon|medalhao.*frango"),
    ("medalhao_bovino", r"medalhao"),
    ("kafta", r"kafta|kofta"),
    ("linguica", r"linguica|salsichao|toscana|calabresa|cuiabana"),
    ("panceta", r"panceta|torresmo|porco|lombo|pernil|suin\w*"),
    ("costela", r"costela"),
    ("picanha", r"picanha"),
    ("file", r"file\s+mignon|mignon"),
    ("frango", r"frango|sobrecoxa|coxinha\s+da\s+asa|tulipa|galinha"),
    ("queijo", r"queijo|coalho"),
    ("pao_alho", r"pao\s+de\s+alho"),
    ("vegetal", r"abobrinha|berinjela|batata|legume|vegetar\w*|cebola|cogumelo|shimeji|tomate|milho"),
    ("carne", r"carne|alcatra|contra\s*file|maminha|bovin\w*|cupim|fraldinha|boi\b"),
)
_SKEWER_CUTS = tuple((c, re.compile(rf"\b(?:{rx})")) for c, rx in SKEWER_CUTS)
CUT_LABEL = {
    "mandioca": "medalhão de mandioca",
    "coracao": "coração",
    "medalhao_frango": "medalhão de frango",
    "medalhao_bovino": "medalhão de carne",
    "kafta": "kafta",
    "linguica": "linguiça",
    "panceta": "porco",
    "costela": "costela",
    "picanha": "picanha",
    "file": "filé mignon",
    "frango": "frango",
    "queijo": "queijo coalho",
    "pao_alho": "pão de alho",
    "vegetal": "legumes",
    "carne": "carne",
}


@dataclass(frozen=True)
class SkewerAttrs:
    cut: str | None
    portion: bool
    """Sold to share or by weight: "porção", "compartilhar", "família", 200 g or more."""
    sweet: bool
    grams: int | None
    excluded: bool = False


def skewer_attrs_m1_16(item: Item) -> SkewerAttrs:
    """M1-16: the cut, portion or single skewer, sweet or not, and the grams when written, from the name."""
    n = plain(item.name)
    m = _GRAMS.search(n)
    grams = int(m.group(1)) if m else None
    portion = bool(_SKEWER_PORTION.search(n)) or (grams is not None and grams >= 200)
    cut = next((c for c, rx in _SKEWER_CUTS if rx.search(n)), None)
    return SkewerAttrs(cut, portion, bool(_SWEET_SKEWER.search(n)), grams)


# M1-17 (D85, Marlon, 11/nov): what sets the price of a Japanese dish: the fish, the number of pieces (or
# the grams),
# and, for snacks and tempura, the dish itself. A sweet roll and a piece sold one by one are other products.
JAPANESE_FAMILIES = frozenset(
    {
        "sashimi",
        "niguiri",
        "hot_roll",
        "uramaki",
        "hossomaki",
        "temaki",
        "carpaccio",
        "ceviche",
        "tempura",
        "petisco",
        "combinado",
        "poke",
        "guioza",
        "harumaki",
    }
)
_SWEET_JP = re.compile(
    r"\b(?:banana|chocolate|nutella|morango|doce|romeu|goiabada|brigadeiro|sorvete|ninho)\b"
)
# A sweet sauce served on the side ("com mel ou calda de goiabada") does not make a cheese harumaki a dessert.
_SIDE_SAUCE_JP = re.compile(r"\b(?:calda|geleia|mel)\b(?:\s+(?:de\s+)?\w+)?")
_SINGLE_JP = re.compile(r"monte\s+o\s+seu|por\s+unidade|unidade\s+avulsa|\(\s*1\s*un")
_PIECES_JP = re.compile(r"\b(\d{1,3})\s*(?:un|unid\w*|pecas?|pcs|fatias?)\b")
JP_DISHES = (
    ("edamame", r"edamame"),
    ("shimeji", r"shimeji|cogumelo"),
    ("nasu", r"nasu|berinjela"),
    ("karaage", r"karaage|karague|karagee|katsu"),
    ("guioza", r"guioza|gyoza"),
    ("harumaki", r"harumaki"),
    ("camarao", r"camarao|ebi"),
    ("cebola", r"cebola|onion"),
    ("lula", r"lula|tako|polvo"),
    ("legumes", r"legume"),
    ("peixe", r"peixe|tilapia|pescada|saint\s*peter"),
    ("gohan", r"gohan"),
)
_JP_DISHES = tuple((d, re.compile(rf"\b(?:{rx})")) for d, rx in JP_DISHES)


@dataclass(frozen=True)
class JapaneseAttrs:
    protein: str
    pieces: int | None
    grams: int | None
    sweet: bool
    single: bool
    dish: str | None
    """For petisco and tempura only: edamame, shimeji, karaage..."""
    excluded: bool = False


def japanese_attrs_m1_17(item: Item, fam: Family | None = None) -> JapaneseAttrs:
    """M1-17: pieces or grams, sweet or not, a piece sold one by one, and the dish of a snack or tempura."""
    n = plain(item.name)
    pm = _PIECES_JP.search(n)
    gm = _GRAMS.search(n)
    if pm is None and gm is None and item.description:
        # Many stores write "8 fatias" or "150g" only in the description: read its first clause,
        # before the notes on hashi and sauces.
        d = re.split(r"caso\s+deseje|acompanha|\n", plain(item.description))[0]
        pm = _PIECES_JP.search(d)
        gm = _GRAMS.search(d)
    dish = None
    if fam is None or fam.family in ("petisco", "tempura"):
        dish = next((d for d, rx in _JP_DISHES if rx.search(n)), None)
    return JapaneseAttrs(
        fam.protein if fam else "",
        int(pm.group(1)) if pm else None,
        int(gm.group(1)) if gm else None,
        bool(_SWEET_JP.search(_SIDE_SAUCE_JP.sub(" ", n))),
        bool(_SINGLE_JP.search(n)),
        dish,
    )


_GOHAN = re.compile(r"^\W*gohan\b")
_MARINATED_JP = re.compile(r"\b(?:cubos?|marinad\w*)\b")
_SAUCE_JP = re.compile(r"\bmolho\s+(?:de\s+)?(?:ostras?|ponzu|tare|missoshiru)\b")


def correct_family_m1_17(item: Item, fam: Family) -> Family:
    """M1-17 (D85): two dishes the classifier leaves as "outro". A gohan is a side every Japanese menu sells
    (petisco, dish gohan); diced fish in a sauce ("Salmão ao molho de ostras", "ao molho ponzu") is the same
    product as a ceviche of that fish. Anything else passes as it came."""
    n = plain(item.name)
    if fam.family == "outro" and _GOHAN.search(n):
        return Family("petisco", "sem_proteina", fam.size)
    text = f"{n} {plain(item.description or '')}"
    if (
        fam.family in ("outro", "ceviche")
        and fam.protein not in ("sem_proteina", "vegetal")
        and _SAUCE_JP.search(n)
        and _MARINATED_JP.search(text)
    ):
        return Family("ceviche", fam.protein, fam.size)
    return fam


def store_segments_m1_15(items: Iterable[Item], families: Mapping[str, Family]) -> dict[str, str]:
    """M1-15: a store's burger segment when at least two of its burgers say it and three in four of those
    agree, so
    "Mega bacon" in a shop that sells "Burguer 160" is artesanal too."""
    seen: dict[str, list[str]] = {}
    for item in items:
        fam = families.get(family_key(item))
        if fam is None or fam.family != "hamburguer":
            continue
        seg = sandwich_attrs_m1_15(item, fam).segment
        if seg in ("artesanal", "lanchonete", "smash"):
            seen.setdefault(item.store_id, []).append(seg)
    out = {}
    for store, segs in seen.items():
        top = max(set(segs), key=segs.count)
        if len(segs) >= 2 and segs.count(top) * 4 >= len(segs) * 3:
            out[store] = top
    return out


def _size_group(size: str) -> str:
    """Individual and normal are the portions most stores never tell apart."""
    return "normal" if size in ("individual", "normal") else size


def basis_words(
    fam: Family, *, with_protein: bool, attrs: SandwichAttrs | SkewerAttrs | JapaneseAttrs | None = None
) -> str:
    if isinstance(attrs, SkewerAttrs):
        what = (
            "espeto doce" if attrs.sweet else f"espeto de {CUT_LABEL[attrs.cut]}" if attrs.cut else "espeto"
        )
        return f"{what} (porção)" if attrs.portion else what
    if isinstance(attrs, JapaneseAttrs):
        protein = PROTEIN_LABEL.get(attrs.protein)
        words = [FAMILY_LABEL[fam.family], *([f"de {protein}"] if protein else [])]
        if attrs.pieces:
            words.append("por peça")
        return " ".join(words)
    words = [FAMILY_LABEL[fam.family]]
    if attrs is not None and attrs.segment in ("artesanal", "lanchonete", "smash"):
        words.append(
            {"artesanal": "artesanal", "lanchonete": "de lanchonete", "smash": "smash"}[attrs.segment]
        )
    if attrs is not None and attrs.patties > 1:
        words.append("duplo" if attrs.patties == 2 else "triplo")
    if fam.size in ("mini", "grande"):
        words.append(fam.size)
    protein = PROTEIN_LABEL[fam.protein] if with_protein else None
    if protein:
        words.append(f"de {protein}")
    return " ".join(words)


def _store_prices(rows: Sequence[tuple[Item, Family]], norm: Normalized | None) -> list[int]:
    """One middle price per store, on the own item's size when compared by size (`norm`), else as sold."""
    by_store: dict[str, list[Fraction]] = {}
    for item, _ in rows:
        n = normalize_m1_03(item)
        sized = norm is not None and norm.by_weight_or_pack
        value = n.per_base * norm.own_base_qty if sized else Fraction(item.price_cents)
        by_store.setdefault(item.store_id, []).append(value)
    return [round(sorted(v)[(len(v) - 1) // 2]) for v in by_store.values()]


PRESUME_MIN_STORES_M1_19 = 5
# Dishes sold in pieces. A temaki, a poke or a ceviche is one portion: its size is never presumed.
PIECE_FAMILIES_M1_19 = frozenset(
    {"sashimi", "niguiri", "hot_roll", "uramaki", "hossomaki", "carpaccio", "guioza", "harumaki", "combinado"}
)
PRESUME_MIN_SHARE_M1_19 = 0.6


def _stated_jp_m1_19(item: Item, fam: Family) -> tuple[str, int] | None:
    """The pieces or grams a Japanese item states, in its name or in its description."""
    a = japanese_attrs_m1_17(item, fam)
    if a.single or a.sweet:
        return None
    if a.pieces:
        return ("un", a.pieces)
    if a.grams:
        return ("g", a.grams)
    return None


def _sized_jp_m1_19(
    item: Item, fam: Family, rows: Sequence[tuple[Item, Family]], presumed_ids: set[str]
) -> Item:
    """M1-19 (D87, Marlon, 11/nov): a Japanese item priced per piece or per gram. The size comes from the
    name, else the description, else, for a dish sold in pieces, is presumed: the middle size the stores of
    the same dish state, when at least PRESUME_MIN_STORES_M1_19 state one and PRESUME_MIN_SHARE_M1_19 of
    them sit within a quarter of it (hossomaki: 8 pieces). A presumed item is listed in `presumed_ids`, for
    the range's basis to say it."""
    if normalize_m1_03(item).by_weight_or_pack:
        return item
    stated = _stated_jp_m1_19(item, fam)
    if stated is not None:
        return replace(item, unit=stated[0], unit_qty=stated[1])
    a = japanese_attrs_m1_17(item, fam)
    if a.single or a.sweet or fam.family not in PIECE_FAMILIES_M1_19:
        return item
    by_store: dict[str, list[int]] = {}
    for p, f in rows:
        s = _stated_jp_m1_19(p, f)
        if s is not None and s[0] == "un" and japanese_attrs_m1_17(p, f).dish == a.dish:
            by_store.setdefault(p.store_id, []).append(s[1])
    sizes = sorted(sorted(v)[(len(v) - 1) // 2] for v in by_store.values())
    if len(sizes) < PRESUME_MIN_STORES_M1_19:
        return item
    mid = sizes[(len(sizes) - 1) // 2]
    near = sum(1 for q in sizes if 0.75 * mid <= q <= 1.25 * mid)
    if near < PRESUME_MIN_SHARE_M1_19 * len(sizes):
        return item
    presumed_ids.add(item.id)
    return replace(item, unit="un", unit_qty=mid)


INDICATIVE_MIN_STORES_M1_18 = 3
"""M1-18 (D86): the fewest comparable stores for an indicative range."""
INDICATIVE_MAX_SPREAD_M1_18 = 2
"""M1-18: with so few stores, the highest price at most twice the lowest, or one odd price makes the range."""


def family_ranges_m1_13(
    own: Sequence[tuple[str, Item]],
    pool: Sequence[Item],
    families: Mapping[str, Family],
    min_stores: int,
) -> dict[str, FamilyRange]:
    """M1-13: for each (key, own item), the range of the same family and size group nearby, the same
    protein when enough stores sell it, else the family. A store counts once at its middle price. An item
    with a size is compared per piece, per 100 g or per 100 ml, only with items that state one. A sandwich
    (M1-15)
    compares only with the same segment, the same number of patties and, when both state it, a weight of meat
    within a quarter; with too few such stores it gets no range, never a wider one."""
    stores_seg = store_segments_m1_15([*pool, *(i for _, i in own)], families)

    def attrs_of(item: Item, fam: Family) -> SandwichAttrs | SkewerAttrs | JapaneseAttrs | None:
        if fam.family == "espeto":
            return skewer_attrs_m1_16(item)
        if fam.family in JAPANESE_FAMILIES:
            return japanese_attrs_m1_17(item, fam)
        if fam.family not in SANDWICH_FAMILIES:
            return None
        a = sandwich_attrs_m1_15(item, fam)
        if fam.family != "hamburguer":
            # Hot dogs and other sandwiches here have no artesanal tier: only patties and grams count.
            return SandwichAttrs(None, a.patties, a.grams, a.excluded)
        if a.segment:
            return a
        return SandwichAttrs(stores_seg.get(item.store_id), a.patties, a.grams, a.excluded)

    def compatible(mine: SandwichAttrs | SkewerAttrs | JapaneseAttrs | None, p: Item, f: Family) -> bool:
        if mine is None:
            return True
        theirs = attrs_of(p, f)
        if isinstance(mine, JapaneseAttrs):
            if not isinstance(theirs, JapaneseAttrs) or theirs.single or theirs.sweet != mine.sweet:
                return False
            if p.unit_qty and theirs.pieces is None and theirs.grams is None:
                # M1-19: sized from the description or presumed.
                q = int(p.unit_qty)
                theirs = replace(theirs, pieces=q) if p.unit == "un" else replace(theirs, grams=q)
            if theirs.protein != mine.protein or (mine.dish is not None and theirs.dish != mine.dish):
                return False
            if mine.pieces:
                return theirs.pieces is not None and 0.5 <= theirs.pieces / mine.pieces <= 2
            if mine.grams:
                return theirs.grams is not None and 0.6 <= theirs.grams / mine.grams <= 1.67
            return True
        if isinstance(mine, SkewerAttrs):
            if (
                not isinstance(theirs, SkewerAttrs)
                or theirs.sweet != mine.sweet
                or theirs.portion != mine.portion
            ):
                return False
            if not mine.sweet and mine.cut is not None and theirs.cut != mine.cut:
                return False
            if mine.grams and theirs.grams:
                return 0.7 <= theirs.grams / mine.grams <= 1.43
            return True
        if not isinstance(theirs, SandwichAttrs) or theirs.excluded or theirs.patties != mine.patties:
            return False
        if mine.segment is not None and theirs.segment != mine.segment:
            return False
        if mine.segment is None and f.family == "hamburguer" and theirs.segment in ("smash", "infantil"):
            return False
        if mine.grams and theirs.grams:
            return 0.75 <= theirs.grams / mine.grams <= 1.34
        return True

    peers: dict[tuple[str, str], list[tuple[Item, Family]]] = {}
    for item in pool:
        fam = families.get(family_key(item)) if is_food_m1_04(item) else None
        if fam is not None:
            fam = correct_family_m1_17(item, dog_protein_m1_15(item, fam))
            peers.setdefault((fam.family, _size_group(fam.size)), []).append((item, fam))
    presumed_ids: set[str] = set()
    for group, rows in peers.items():
        if group[0] in JAPANESE_FAMILIES:
            peers[group] = [(_sized_jp_m1_19(p, f, rows, presumed_ids), f) for p, f in rows]
    out: dict[str, FamilyRange] = {}
    for key, item in own:
        fam = families.get(family_key(item)) if is_food_m1_04(item) else None
        if fam is not None:
            fam = correct_family_m1_17(item, fam)
        if fam is None or fam.family == "outro":
            continue
        fam = dog_protein_m1_15(item, fam)
        mine = attrs_of(item, fam)
        if mine is not None and mine.excluded:
            continue
        if fam.family in JAPANESE_FAMILIES:
            # M1-19: the own item is sized the same way, never presumed (its own menu is the fact).
            item = _sized_jp_m1_19(item, fam, (), set())
        norm = normalize_m1_03(item)
        same_basis = [
            (p, f)
            for p, f in peers.get((fam.family, _size_group(fam.size)), [])
            if p.store_id != item.store_id
            and normalize_m1_03(p).by_weight_or_pack == norm.by_weight_or_pack
            and (not norm.by_weight_or_pack or normalize_m1_03(p).unit == norm.unit)
            and compatible(mine, p, f)
        ]

        protein_rows = [(p, f) for p, f in same_basis if f.protein == fam.protein]
        specific = _store_prices(protein_rows, norm)
        with_protein = fam.protein != "sem_proteina" and len(specific) >= min_stores
        chosen = specific if with_protein else _store_prices(same_basis, norm)
        if len(chosen) < min_stores and norm.by_weight_or_pack:
            # D75: too few stores state a size. The whole-portion price is still a reference; the screen says
            # size is unknown.
            everyone = peers.get((fam.family, _size_group(fam.size)), [])
            others = [(p, f) for p, f in everyone if p.store_id != item.store_id and compatible(mine, p, f)]
            same_protein = _store_prices([(p, f) for p, f in others if f.protein == fam.protein], None)
            with_protein = fam.protein != "sem_proteina" and len(same_protein) >= min_stores
            chosen = same_protein if with_protein else _store_prices(others, None)
        basis = basis_words(fam, with_protein=with_protein, attrs=mine)
        if isinstance(mine, JapaneseAttrs) and norm.by_weight_or_pack:
            used = protein_rows if with_protein else same_basis
            guessed = len({p.store_id for p, _ in used if p.id in presumed_ids})
            if guessed:
                basis += f", tamanho presumido em {guessed} {'loja' if guessed == 1 else 'lojas'}"
        if len(chosen) >= min_stores:
            out[key] = FamilyRange(
                range_m1_13(item.price_cents, chosen),
                len(chosen),
                basis,
                tuple(sorted(chosen)),
            )
        elif (
            mine is not None
            and len(chosen) >= INDICATIVE_MIN_STORES_M1_18
            and max(chosen) <= INDICATIVE_MAX_SPREAD_M1_18 * min(chosen)
        ):
            # M1-18 (D86): the strict rules leave few stores of the same kind. With 3 or 4 the range shows as
            # indicative, marked "poucas lojas", and stays out of "Itens alinhados".
            out[key] = FamilyRange(
                range_m1_13(item.price_cents, chosen),
                len(chosen),
                basis,
                tuple(sorted(chosen)),
                indicative=True,
            )
        elif mine is not None:
            # M1-15: too few stores of the same kind. No range at all, and no fallback to the item's own
            # pairs, which know neither segment nor patties. The basis stays, for P23 to say what is missing.
            out[key] = FamilyRange(None, len(chosen), basis_words(fam, with_protein=False, attrs=mine), ())
    return out
