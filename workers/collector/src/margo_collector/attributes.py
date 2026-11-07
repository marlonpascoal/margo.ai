"""M1-04 Stage 1 (spec/04-rules.md): what an item is, by rule, with no AI: its category, whether it is a combo, and
the attributes of a beverage. Pure functions over the text of a `public_menu_item`.

Sizes are not parsed here: `app.size_from_name_m1_03` (M1-03) is the only parser; the caller passes what it read.

The lists below are word lists, not data about any restaurant. Marlon has the final say on the six categories.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from typing import Literal

Category = Literal["bebidas", "lanches", "porcoes", "pratos", "sobremesas", "adicionais"]
CATEGORIES: tuple[Category, ...] = ("bebidas", "lanches", "porcoes", "pratos", "sobremesas", "adicionais")


def plain(text: str | None) -> str:
    """Lower case, no accents, single spaces; the only form the rules below read."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t).strip()


def _words(*alternatives: str) -> re.Pattern[str]:
    return re.compile(r"\b(?:" + "|".join(alternatives) + r")\b")


# Sections -----------------------------------------------------------------------------------------

_NOT_A_SECTION = re.compile(
    r"mais (?:vendid|pedid|amad|popular)|destaque|promoc|oferta|novidade|lancamento|recomendad|para voce|sugest|"
    r"favorit|imperdive|exclusiv|cupom|desconto|especial do dia|do dia\b|da semana|top \d|^top\b"
)
# A section marks a combo only when it opens with the word: "Hambúrguer & Combos" holds single items too.
_COMBO_SECTION = re.compile(r"^(?:\W*)(?:combos?|kits?)\b")
_SECTION_RULES: tuple[tuple[Category, re.Pattern[str]], ...] = (
    ("adicionais", re.compile(r"adiciona|\bextras?\b|complemento|acrescimo|turbin|\bmolhos?\b|\badds?\b")),
    ("bebidas", re.compile(r"bebida|refrigerante|\brefris?\b|\bsucos?\b|\baguas?\b|cerveja|\bchopp?\b|\bdrinks?\b|\bvinhos?\b|\bcaf(?:e|es)\b|cappuccino|macchiato")),
    ("sobremesas", re.compile(r"sobreme|\bdoces?\b|\bacai\b|sorvete|milk ?shake|\bshakes?\b|\bgelados?\b|\bbolos?\b|\btrufas?\b|bomboniere|churros?\b|\bbalas?\b")),
    ("porcoes", re.compile(r"\bporc(?:ao|oes)\b|petisco|acompanhamento|\bentradas?\b|\bfritas?\b|\bbatatas?\b|compartilhar|tira ?gosto")),
    ("lanches", re.compile(r"lanche|hamburg|burg(?:u)?er|sanduiche|\bsmash\b|hot ?dog|\bdog|cachorro|\bpasteis\b|\bpastel\b|salgado|prensad")),
    ("pratos", re.compile(r"\bpratos?\b|marmit|executivo|\bmassas?\b|pizza|japones|\bsushi\b|almoco|jantar|parmegiana|saladas?\b|refeic|espet|\bcarnes?\b|omelete|costela|panqueca|macarrao|\bcaldos?\b|yakisoba")),
)


def section_category(section: str | None) -> Category | None:
    """The category a menu section names; None for "Os Mais Vendidos" and other non-sections, and for a section whose
    name says nothing ("Clássicos"): the item's own words then decide."""
    s = plain(section)
    if not s or _NOT_A_SECTION.search(s):
        return None
    for category, pattern in _SECTION_RULES:
        if pattern.search(s):
            return category
    return None


# Beverages: types, brands, flavors, variants --------------------------------------------------------


@dataclass(frozen=True)
class _Brand:
    name: str
    pattern: re.Pattern[str]
    type: str | None = None
    flavor: str | None = None


_BRANDS: tuple[_Brand, ...] = (
    _Brand("coca_cola", _words(r"coca[ -]?cola", "cocacola", "coca"), "refrigerante", "cola"),
    _Brand("pepsi", _words("pepsi"), "refrigerante", "cola"),
    _Brand("sprite", _words("sprite"), "refrigerante", "limao"),
    _Brand("fanta", _words("fanta"), "refrigerante"),
    _Brand("kuat", _words("kuat"), "refrigerante", "guarana"),
    _Brand("sukita", _words("sukita"), "refrigerante"),
    _Brand("schweppes", _words("sche?weppes"), "refrigerante"),
    _Brand("h2oh", _words("h2oh?"), "refrigerante", "limao"),
    _Brand("refriko", _words("refriko"), "refrigerante"),
    _Brand("dolly", _words("dolly"), "refrigerante"),
    _Brand("tubaina", _words("i?tubaina"), "refrigerante", "tubaina"),
    _Brand("antarctica", _words("antarctica", "antartica")),
    _Brand("schin", _words("schin")),
    _Brand("heineken", _words("heineken"), "cerveja"),
    _Brand("brahma", _words("brahma"), "cerveja"),
    _Brand("skol", _words("skol"), "cerveja"),
    _Brand("budweiser", _words("budweiser"), "cerveja"),
    _Brand("stella", _words(r"stella(?: artois)?"), "cerveja"),
    _Brand("corona", _words("corona"), "cerveja"),
    _Brand("amstel", _words("amstel"), "cerveja"),
    _Brand("spaten", _words("spaten"), "cerveja"),
    _Brand("eisenbahn", _words("eisenbahn"), "cerveja"),
    _Brand("itaipava", _words("itaipava"), "cerveja"),
    _Brand("bohemia", _words("bohemia"), "cerveja"),
    _Brand("red_bull", _words(r"red ?bull"), "energetico"),
    _Brand("monster", _words("monster"), "energetico"),
    _Brand("tnt", _words("tnt"), "energetico"),
    _Brand("baly", _words("baly"), "energetico"),
    _Brand("furioso", _words("furioso"), "energetico"),
    _Brand("gatorade", _words("gatorade"), "isotonico"),
    _Brand("powerade", _words("power ?ade"), "isotonico"),
    _Brand("del_valle", _words(r"del ?valle"), "suco"),
    _Brand("maguary", _words("maguary"), "suco"),
    _Brand("ades", _words("ades"), "suco"),
    _Brand("natu", _words("natu"), "suco"),
    _Brand("prats", _words("prats"), "suco"),
    _Brand("lipton", _words("lipton"), "cha"),
    _Brand("leao", _words("leao"), "cha"),
)
_GATED_BRANDS: dict[str, tuple[tuple[str, re.Pattern[str]], ...]] = {
    # Words that are a brand only under this type ("prata" is no brand of a soda).
    "agua": (
        ("crystal", _words("crystal", "cristal")),
        ("bonafont", _words("bonafont")),
        ("minalba", _words("minalba")),
        ("prata", _words("prata")),
        ("indaia", _words("indaia")),
        ("sao_lourenco", _words("sao lourenco")),
        ("lindoya", _words("lindoya")),
        ("ouro_fino", _words("ouro fino")),
        ("perrier", _words("perrier")),
    ),
    "cerveja": (("original", _words("original")), ("sol", _words("sol")), ("petra", _words("petra")), ("devassa", _words("devassa"))),
}
_FLAVORS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (name, _words(pattern))
    for name, pattern in (
        ("laranja", "laranja"),
        ("uva", "uva"),
        ("maracuja", "maracuja"),
        ("limao", "limao|limonada|limoneto"),
        ("abacaxi", "abacaxi"),
        ("morango", "morango"),
        ("manga", "manga|mango"),
        ("pessego", "pessego"),
        ("acerola", "acerola"),
        ("goiaba", "goiaba"),
        ("caju", "caju"),
        ("melancia", "melancia"),
        ("tangerina", "tangerina|mexerica"),
        ("maca", "maca"),
        ("coco", "coco"),
        ("guarana", "guarana"),
        ("cola", "cola"),
        ("tonica", "tonica"),
        ("citrus", "citrus"),
        ("frutas_vermelhas", "frutas vermelhas"),
        ("mate", "mate"),
    )
)
_STILL = re.compile(r"\b(?:sem|s/) ?gas\b")
_SPARKLING = re.compile(r"\bgas\b|\bgaseificada\b|\bgasosa\b")
_SUGAR_FREE = re.compile(r"\bzero\b|\bs(?:em|/) ?acucar\b|\bdiet\b|\b0 acucar\b")
_ALCOHOL_FREE = re.compile(r"\bzero\b|\bsem alcool\b|\b0[.,]0\b")
_LIGHT = re.compile(r"\blight\b")
_JUICE_WITH = re.compile(r"\bcom (leite|agua)\b")
_TYPE_WORDS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("refrigerante", _words("refrigerantes?", "refris?", "soda", "agua tonica", "tonica")),
    ("agua", _words("aguas?")),
    ("suco", _words("sucos?", "limonada")),
    ("cerveja", _words("cervejas?", "chopp?", "long neck")),
    ("energetico", _words("energeticos?")),
    ("isotonico", _words("isotonicos?")),
    ("cha", _words("cha", "ice tea", "cha gelado")),
    ("cafe", _words("cafes?", "cappuccino", "macchiato", "pingado", "expresso")),
)


@dataclass(frozen=True)
class BeverageAttrs:
    """M1-04: a beverage by rule. A None is an attribute the text does not give."""

    type: str | None
    brand: str | None
    flavor: str | None
    variant: str
    size_ml: Fraction | None


def _beverage_type(name: str, brand: _Brand | None) -> str | None:
    if _JUICE_WITH.search(name) and any(p.search(name) for _, p in _FLAVORS):
        return "suco"
    for kind, pattern in _TYPE_WORDS:
        if pattern.search(name):
            return kind
    if brand and brand.type:
        return brand.type
    if _words("guarana").search(name):
        return "refrigerante"
    # A fruit and nothing else, on a beverage: how a juice is sold ("Goiaba natural").
    if any(p.search(name) for f, p in _FLAVORS if f not in ("cola", "tonica", "mate")):
        return "suco"
    return None


def beverage_attrs(name: str | None, size_ml: Decimal | float | int | None = None) -> BeverageAttrs:
    """M1-04: type, brand, flavor, sugar-free or other variant, from an item name. `size_ml` comes from M1-03 and is
    only carried here. The flavor is what the name says, else what the brand means (a cola, a lemon soda); water with
    nothing said is still water, and "zero" means no alcohol on a beer and no sugar elsewhere."""
    n = plain(name)
    brand = next((b for b in _BRANDS if b.pattern.search(n)), None)
    kind = _beverage_type(n, brand)
    brand_name = brand.name if brand else None
    if brand_name is None and kind in _GATED_BRANDS:
        brand_name = next((b for b, p in _GATED_BRANDS[kind] if p.search(n)), None)
    found = sorted({f for f, p in _FLAVORS if p.search(n)})
    if "cola" in found and len(found) > 1:
        found.remove("cola")
    flavor = "+".join(found) if found else (brand.flavor if brand else None)
    if kind == "agua":
        variant = "com_gas" if _SPARKLING.search(n) and not _STILL.search(n) else "sem_gas"
    elif kind == "cerveja":
        variant = "sem_alcool" if _ALCOHOL_FREE.search(n) else "original"
    elif kind == "suco" and (made := _JUICE_WITH.search(n)):
        variant = f"com_{made.group(1)}"
    elif _SUGAR_FREE.search(n):
        variant = "sem_acucar"
    elif _LIGHT.search(n):
        variant = "light"
    else:
        variant = "original"
    return BeverageAttrs(kind, brand_name, flavor, variant, Fraction(str(size_ml)) if size_ml is not None else None)


Match = Literal["identical", "unreadable", "conflict"]


def compare_beverages(a: BeverageAttrs, b: BeverageAttrs) -> Match:
    """M1-04: `identical` confirms a pair. Two different values are a `conflict`, and the pair cannot exist. An attribute
    missing on one side, an unknown type, or a missing size on either side is `unreadable`: a founder may look at it,
    the rule never accepts it. A brand or flavor absent on both sides is equal: the same generic item."""
    for x, y in ((a.type, b.type), (a.brand, b.brand), (a.flavor, b.flavor), (a.size_ml, b.size_ml)):
        if x is not None and y is not None and x != y:
            return "conflict"
    if a.variant != b.variant:
        return "conflict"
    if a.type is None or b.type is None or a.size_ml is None or b.size_ml is None:
        return "unreadable"
    if a.brand != b.brand or a.flavor != b.flavor:
        return "unreadable"
    return "identical"


def unreadable_reason(a: BeverageAttrs) -> str | None:
    """M1-04: the attribute that keeps a beverage from ever confirming a pair, as C04 says it. Type and size only: a
    brand or flavor absent can still match the same generic item."""
    if a.type is None:
        return "tipo ilegível"
    if a.size_ml is None:
        return "tamanho ilegível"
    return None


def missing_reason(a: BeverageAttrs) -> str | None:
    """M1-04: when no identical item turned up, the attribute that could be the cause, as C04 says it."""
    if a.type in ("refrigerante", "cerveja", "energetico", "isotonico") and a.brand is None:
        return "marca ilegível"
    if a.type in ("refrigerante", "suco") and a.flavor is None:
        return "sabor ilegível"
    return None


NO_SAME_ATTRIBUTES = "nenhuma loja com os mesmos atributos"
UNKNOWN_CATEGORY = "categoria não identificada"
NO_SIMILAR_ITEM = "nenhum item parecido"
BEVERAGE_NOTES = frozenset({"tipo ilegível", "tamanho ilegível", "marca ilegível", "sabor ilegível", NO_SAME_ATTRIBUTES})


# Categories by words ------------------------------------------------------------------------------

_ADDON_LEAD = re.compile(r"^(?:adicional|acrescimo|extra|molho|maionese|ketchup|mostarda|barbecue)\b|\badicional de\b")
_INGREDIENTS = frozenset(
    "bacon queijo cheddar catupiry ovo ovos carne hamburguer picles alface tomate cebola caramelizada crispy salsicha "
    "presunto calabresa mussarela muçarela requeijao gorgonzola provolone parmesao maionese ketchup mostarda barbecue "
    "molho extra adicional porcao fatia fatias de do da com".split()
)
_LANCHES = re.compile(
    r"\bhamburgu?er\w*|\bburgu?ers?\b|\bcheese\b|\bcheese ?burgu?er\b|\bx[- ]\w+|\bx(?:bacon|salada|burgu?er|egg|tudo)\b|\bdog(?:s|ao)?\b|"
    r"\blanches?\b|\bsmash\b|\bsanduiches?\b|\bbeirute\b|\bhot ?dogs?\b|\bcachorro[- ]quente\b|\bmisto quente\b|\bwraps?\b|"
    r"\bpasteis\b|\bpastel\b|\bcoxinhas?\b|\besfihas?\b|\bkibes?\b|\btapiocas?\b|\bcrepes?\b"
)
_PORCOES = re.compile(
    r"\bporc(?:ao|oes)\b|\bbatatas?\b|\bfritas\b|\baneis de cebola\b|\banel de cebola\b|\bonion rings?\b|\bpolenta\b|"
    r"\bmandioca\b|\bnuggets?\b|\bpetiscos?\b|\biscas?\b|\btiras? de\b|\bbolinhos?\b|\ba passarinho\b"
)
_SOBREMESAS = re.compile(
    r"\bsobremesas?\b|\bsundaes?\b|\bbrownies?\b|\bpetit gateau\b|\bpudi[mn]s?\b|\bsorvetes?\b|\bmilk ?shakes?\b|\bshakes?\b|\bacai\b|"
    r"\bmousses?\b|\bchurros?\b|\bbrigadeiros?\b|\bcookies?\b|\bbolos?\b|\bgelatos?\b|\bpacoca\b|\bdoces?\b|\bdonuts?\b|\btrufas?\b|\bbomboms?\b"
)
_PRATOS = re.compile(
    r"\bpratos?\b|\bmarmit\w+|\bexecutivos?\b|\bparmegiana\b|\bfeijoada\b|\bstrogonoff\b|\blasanhas?\b|\bmacarrao\b|\brisotos?\b|"
    r"\bpizzas?\b|\bsushis?\b|\btemakis?\b|\bpokes?\b|\bsaladas?\b|\bfile\b|\bfilet\b|\bcostela\b|\bomelete\b|\bpanquecas?\b|\byakisoba\b|\bfeijao\b|\bcanja\b"
)
_BEVERAGE = re.compile(
    r"\brefrigerantes?\b|\brefris?\b|\bsucos?\b|\baguas?\b|\bcervejas?\b|\bchopp?\b|\benergeticos?\b|\bisotonicos?\b|\bcha gelado\b|"
    r"\bice tea\b|\blimonada\b|\bguarana\b|\btonica\b|\bcafes?\b|\bcappuccino\b"
)
_DESCRIPTION_LANCHES = re.compile(r"\bpao\b|\bblend\b|\bhamburgu?er\b|\bburgu?er\b")
_DESCRIPTION_PRATOS = re.compile(r"\barroz\b|\bfeijao\b|\bmassa\b")
_COMBO_WORDS = re.compile(r"\bcombos?\b|\bkits?\b|\bdupla\b|\btrio\b|\bcasadinha\b|\+")
_WITH_SIDE = re.compile(r"\bcom (?:batatas?|fritas)\b|\blatas?\b")
# A count before a word: "2 batatas". A size ("600ml", "2 l") is no count.
_COUNT = re.compile(r"(?<![\d.,])\d+\s*-?\s*(?!ml\b|mls\b|l\b|lt\b|lts\b|litros?\b|g\b|gr\b|grs\b|gramas?\b|kg\b|un\b|und\b|unid\b|unidades?\b)[a-z]")
_LEADING_COUNT = re.compile(
    r"^(?:([2-9])\s*(?:-|x\b|\s)\s*(?!queijos|carnes|estacoes|coracoes|sabores)(?=[a-z])|(dois|duas|tres|quatro|cinco|seis)\s+(?=[a-z]))"
)
_TRAILING_COUNT = re.compile(r"\b([2-9]) ?x$")
_COUNT_WORDS = {"dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6}
# Brands that only ever name a drink: under any section they are a drink.
_DRINK_ONLY = frozenset(
    "coca_cola pepsi sprite fanta kuat schweppes h2oh heineken brahma skol budweiser amstel red_bull gatorade powerade".split()
)
_FOOD_WORDS = (_LANCHES, _PORCOES, _PRATOS)


def _is_beverage_word(n: str) -> bool:
    return bool(_BEVERAGE.search(n)) or any(b.pattern.search(n) for b in _BRANDS)


def _name_category(n: str) -> Category | None:
    if _ADDON_LEAD.search(n):
        return "adicionais"
    tokens = re.findall(r"[a-z0-9]+", n)
    if tokens and all(t in _INGREDIENTS for t in tokens) and not _LANCHES.search(n.replace("hamburguer", "")):
        return "adicionais"
    if _LANCHES.search(n):
        return "lanches"
    if _SOBREMESAS.search(n):
        return "sobremesas"
    if _PORCOES.search(n):
        return "porcoes"
    if _PRATOS.search(n):
        return "pratos"
    if _is_beverage_word(n):
        return "bebidas"
    return None


def category_m1_04(
    name: str | None,
    section: str | None = None,
    description: str | None = None,
    taxonomy_level2: str | None = None,
) -> Category | None:
    """M1-04: our category. `taxonomy_level2` when it says one, then the menu section, then the words of the name, then
    a description that says bread or rice. None when nothing says: such an item never pairs on its own."""
    n = plain(name)
    if _reads_as_drink(n) and section_category(taxonomy_level2) is None:
        return "bebidas"
    return (
        section_category(taxonomy_level2)
        or section_category(section)
        or _name_category(n)
        or _description_category(plain(description))
    )


def _reads_as_drink(n: str) -> bool:
    """A drink filed under another section ("Lanches") stays a drink, or its sizes would mix by price per ml."""
    if _ADDON_LEAD.search(n) or any(p.search(n) for p in (*_FOOD_WORDS, _SOBREMESAS)):
        return False
    return bool(_BEVERAGE.search(n)) or any(b.name in _DRINK_ONLY and b.pattern.search(n) for b in _BRANDS)


def _description_category(d: str) -> Category | None:
    if _DESCRIPTION_LANCHES.search(d):
        return "lanches"
    if _DESCRIPTION_PRATOS.search(d):
        return "pratos"
    return None


def is_combo_m1_04(name: str | None, section: str | None = None) -> bool:
    """M1-04: more than one item sold together, by its words: combo, kit, "+", or food and a drink in one name. A section
    called Combos says it too. A pack of one thing is no combo; a pack without a count is (normalize_m1_03)."""
    n = plain(name)
    if _COMBO_WORDS.search(n) or _COMBO_SECTION.search(plain(section)):
        return True
    if len(_COUNT.findall(n)) > 1:
        return True
    food = any(p.search(n) for p in _FOOD_WORDS)
    if food and (_is_beverage_word(n) or (_LANCHES.search(n) and _WITH_SIDE.search(n))):
        return True
    return False


def quantity_m1_04(name: str | None) -> int:
    """M1-04: how many of the thing one sale holds, when the name opens with a count: "4 Burger", "2 - Burger", "dois
    burgers", or ends with "2x". A padded or long number ("03 - Burger", "12 - Burger") is a menu code. "4 queijos" is a
    flavor. A count in units ("6 un") is M1-03's. An item only pairs with an item of the same quantity."""
    n = plain(name)
    if m := _LEADING_COUNT.search(n):
        return int(m.group(1)) if m.group(1) else _COUNT_WORDS[m.group(2)]
    if m := _TRAILING_COUNT.search(n):
        return int(m.group(1))
    return 1
