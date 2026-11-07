"""M1-04 Stage 2 (spec/04-rules.md): what a lanche or a porção is, by rule, with no AI. Pure functions over
the name and description of a `public_menu_item`.

Attributes: the base (dog, burguer, beirute, wrap... for lanches; batata, isca, aneis... for porções), the
main proteins, the count of patties (or sausages in a dog), the weight in grams when written, the portion
size when written, and the extra ingredients the name lists (cheese, salad, other). Two items pair only with
the same proteins and patty count, the same base, weight and portion size when both sides state them, and the
extras rule (`extras_differ_m1_04`). Name similarity is a tie-break inside that block.

The name decides; the description fills only what the name leaves out (the base, the count, the weight, the
proteins of a name that names none). The lists are word lists, not data about any restaurant."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from .attributes import plain


def _w(*alternatives: str) -> re.Pattern[str]:
    return re.compile(r"\b(?:" + "|".join(alternatives) + r")\b")


# Bases --------------------------------------------------------------------------------------------

_LANCHE_BASES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("dog", _w(r"x[- ]?dogs?", r"dog(?:s|ao|uinho)?", r"hot ?dogs?", r"cachorro[- ]quente", "cachorrao")),
    ("beirute", _w("beirutes?")),
    ("wrap", _w("wraps?")),
    ("misto", _w(r"misto(?: quente)?")),
    ("pastel", _w("pasteis", "pastel")),
    ("coxinha", _w("coxinhas?")),
    ("esfiha", _w("esfihas?", "esfirras?")),
    ("tapioca", _w("tapiocas?")),
    ("crepe", _w("crepes?")),
    ("kibe", _w("kibes?", "quibes?")),
    (
        "burguer",
        _w(
            r"\w*burgu?ers?",
            r"\w*burgers?",
            r"hamburgu?er\w*",
            r"x[- ]?\w+",
            "cheese",
            r"smash\w*",
            r"bauru",
            "prensad\\w*",
        ),
    ),
)
_PORCAO_BASES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("aneis_cebola", _w(r"aneis de cebola", r"anel de cebola", r"onion rings?", r"cebola empanada")),
    ("batata", _w("batatas?", "fritas", "fritinhas", "chips")),
    ("mandioca", _w("mandiocas?", "aipim", "macaxeira")),
    ("polenta", _w("polentas?")),
    ("isca", _w("iscas?", r"tiras?", "tirinhas?", "strips?", r"cubos?")),
    ("passarinho", _w(r"a passarinho", "passarinho")),
    ("nuggets", _w("nuggets?")),
    ("bolinho", _w("bolinhos?", "croquetes?")),
    ("coxinha", _w("coxinhas?", "coxinhinhas?")),
    ("pastel", _w("pasteis", "pastel", "pasteizinhos?")),
    ("torresmo", _w("torresmos?")),
    ("calabresa_acebolada", _w("calabresa acebolada")),
    ("salgados", _w("salgados?", "salgadinhos?")),
)
# What a description says when the name says no base.
_DESC_DOG = _w(r"pao de (?:hot )?dog", "salsichas?")
_DESC_BURGUER = _w(
    r"pao (?:de )?(?:brioche|hamburgu?er|burgu?er|australiano|bola)",
    r"hamburgu?er\w*",
    r"burgu?ers?",
    "blend",
    "smash",
)


# Proteins -----------------------------------------------------------------------------------------

# A patty protein is the main meat of the item; a topping is a protein laid on top. The implied patty (beef
# in a burger, a sausage in a dog) is added only when no patty protein is named.
_PATTY: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "bovino",
        _w(
            "carnes?",
            r"bovin\w*",
            "boi",
            "angus",
            "wagyu",
            "alcatra",
            "fraldinha",
            "maminha",
            "contra ?file",
            "patinho",
            "acem",
            "carne seca",
            "carne de sol",
            "file mignon",
            "mignon",
        ),
    ),
    ("costela", _w("costelas?")),
    ("picanha", _w("picanha")),
    ("cupim", _w("cupim")),
    ("frango", _w("frangos?", "chicken", "galinha", "sobrecoxa", "coxinha da asa", "peito de frango")),
    ("peixe", _w("peixes?", "tilapia", "salmao", "merluza", "pescada", "bacalhau", "atum", "fish")),
    ("camarao", _w("camaroes", "camarao", "shrimp")),
    ("porco", _w("porco", "lombo", "pernil", "suino", "suina", "pork", "costelinha", "panceta", "barriga")),
    ("vegetal", _w(r"veg\w*", "falafel", "soja", "grao de bico", "plant based", "cogumelos?", "shimeji")),
)
_TOPPING: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("bacon", _w("bacon")),
    ("calabresa", _w("calabresa", "linguica", "linguicinha")),
    ("salsicha", _w("salsichas?", "vina", "salsichao")),
    ("ovo", _w("ovos?", "egg")),
    ("presunto", _w("presunto")),
    ("frios", _w("frios")),
)
# A beef patty in a description, not the bread ("pão de hambúrguer") nor another patty ("hambúrguer de
# frango").
_DESC_PAT_BREAD = re.compile(r"\bpao (?:de |p/ |para )?(?:hamburgu?er|burgu?er)\b")
_DESC_OTHER_PATTY = re.compile(
    r"\b(?:hamburgu?er|burgu?er|blend)\w* (?:\w+ ){0,2}(?:de |do )?"
    r"(?:frango|costela|picanha|peixe|salmao|soja|grao|vegetal|veg\w*|cupim|porco|lombo|camarao|falafel)"
)
_DESC_BEEF = _w(r"hamburgu?er\w*", r"burgu?ers?", r"blends?", r"carnes?", r"bovin\w*", r"smash", "hamb")
_BURGER_WORD = _w(r"\w*burgu?ers?", r"hamburgu?er\w*", r"x[- ]?(?!dog)\w+", "cheese", r"smash\w*", "bauru")


# Patty count ----------------------------------------------------------------------------------------

_COUNT_NAME = (
    (
        2,
        re.compile(
            r"\b(?:dupl[oa]|double|duplex|2 carnes|duas carnes|2 burgu?ers?|2 hamburgu?er\w*"
            r"|2 salsichas|duas salsichas)\b"
            r"(?! (?:queijo|cheddar|mussarela|mucarela|catupiry|requeijao|cheese))"
        ),
    ),
    (
        3,
        re.compile(
            r"\b(?:tripl[oa]|triple|3 carnes|tres carnes|3 burgu?ers?|3 hamburgu?er\w*"
            r"|3 salsichas|tres salsichas)\b"
            r"(?! (?:queijo|cheddar|mussarela|mucarela))"
        ),
    ),
    (1, re.compile(r"\b(?:simples|single)\b")),
)
_PATTY_NOUN = r"(?:hamburgu?er\w*|burgu?ers?|carnes?|blends?|smash\w*|salsichas?|discos?|hamb\.?)"
_COUNT_DESC = (
    (3, re.compile(rf"\b(?:3|tres|triplo|tripla)\s*(?:x\s*)?{_PATTY_NOUN}")),
    (
        2,
        re.compile(
            rf"\b(?:2|duas|dois|duplo|dupla)\s*(?:x\s*)?{_PATTY_NOUN}|\b{_PATTY_NOUN} (?:duplo|dupla)\b"
        ),
    ),
)


# Weight and portion -------------------------------------------------------------------------------

_GRAMS = re.compile(r"(?<![\d,.])(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|quilos?|g|gr|grs|gramas?)\b")
_PEOPLE = re.compile(
    r"\b(?:serve|servem|para|p/|ate)\s*(\d+|duas|dois|tres|quatro|cinco|seis)\s*pessoas?\b|\b(\d+)\s*pessoas?\b"
)
_PEOPLE_WORDS = {"dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6}
_SIZE_WORDS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("pequena", re.compile(r"\b(?:pequen[oa]|mini|individual|kids|meia)\b|(?:^|[-(/|]\s*)p\s*(?:$|[)/|-])")),
    ("media", re.compile(r"\b(?:medi[oa]|mediana)\b|(?:^|[-(/|]\s*)m\s*(?:$|[)/|-])")),
    (
        "grande",
        re.compile(r"\b(?:grande|familia|gigante|inteira|completa)\b|(?:^|[-(/|]\s*)g\s*(?:$|[)/|-])"),
    ),
)


# Extras -------------------------------------------------------------------------------------------

ExtraClass = Literal["queijo", "salada", "outro"]
_EXTRAS: tuple[tuple[str, ExtraClass, re.Pattern[str]], ...] = (
    (
        "queijo",
        "queijo",
        _w(
            "queijos?",
            "cheddar",
            "mussarela",
            "mucarela",
            "muzzarela",
            "catupiry",
            "requeijao",
            "cream cheese",
            "gorgonzola",
            "provolone",
            "parmesao",
            "coalho",
            "prato",
            "brie",
            "cheese",
            r"x(?=[- ]?\w)",
        ),
    ),
    (
        "salada",
        "salada",
        _w("salada", "salad", "alface", "tomates?", "rucula", "vinagrete", "picles", "verdes?"),
    ),
    ("cebola", "outro", _w("cebolas?", "onion", "onions", "caramelizad\\w*")),
    ("milho", "outro", _w("milho")),
    ("batata_palha", "outro", _w("batata palha", "palha")),
    ("barbecue", "outro", _w("barbecue", "bbq", "barbecue")),
    ("molho", "outro", _w("molhos?", "maionese", "pesto", "ketchup", "mostarda", "geleia")),
    ("pure", "outro", _w("pure")),
    ("abacaxi", "outro", _w("abacaxi")),
    ("jalapeno", "outro", _w("jalapenos?", "pimentas?", "apimentad\\w*", "picante")),
)


@dataclass(frozen=True)
class FoodAttrs:
    """M1-04 Stage 2: a lanche or a porção by rule. None is what the text does not give; an empty protein set
    of a lanche is unreadable."""

    base: str | None
    proteins: frozenset[str]
    patties: int
    weight_g: int | None
    portion: str | None
    """pequena, media, grande, or "N pessoas"."""
    extras: frozenset[str] = field(default_factory=frozenset)
    source: Literal["regra", "aprendido", "ia", "fundador"] = "regra"

    def core(self) -> tuple[object, ...]:
        """What must be equal, in the shape the AI returns and the learnings store."""
        return (
            self.base,
            tuple(sorted(self.proteins)),
            self.patties,
            self.weight_g,
            self.portion,
            tuple(sorted(self.extras)),
        )


def _found(patterns: tuple[tuple[str, re.Pattern[str]], ...], text: str) -> set[str]:
    return {name for name, p in patterns if p.search(text)}


def _first(patterns: tuple[tuple[str, re.Pattern[str]], ...], text: str) -> str | None:
    best: tuple[int, str] | None = None
    for name, p in patterns:
        m = p.search(text)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None


def _grams(text: str) -> int | None:
    m = _GRAMS.search(text)
    if not m:
        return None
    v = float(m.group(1).replace(",", "."))
    if m.group(2).startswith(("k", "q")):
        v *= 1000
    g = round(v)
    return g if 10 <= g <= 10000 else None


def _portion(text: str) -> str | None:
    if m := _PEOPLE.search(text):
        raw = m.group(1) or m.group(2)
        n = _PEOPLE_WORDS.get(raw) or int(raw)
        return f"{n} pessoas"
    return _first(_SIZE_WORDS, text)


def _patties(name: str, desc: str) -> int:
    for n, p in _COUNT_NAME:
        if p.search(name):
            return n
    for n, p in _COUNT_DESC:
        if p.search(desc):
            return n
    return 1


def _strip_breads(desc: str) -> str:
    return _DESC_OTHER_PATTY.sub(" ", _DESC_PAT_BREAD.sub(" ", desc))


def food_attrs_m1_04(name: str | None, description: str | None, category: str | None) -> FoodAttrs:
    """M1-04 Stage 2: the attributes of a lanche or a porção, by rule. The name decides; the description
    fills what the name leaves out. A burger's beef and a dog's sausage are implied when no other patty is
    named."""
    n, d = plain(name), plain(description)
    lanche = category == "lanches"
    bases = _LANCHE_BASES if lanche else _PORCAO_BASES
    base = _first(bases, n)
    if base is None and lanche:
        # The description: a named base first ("um pastel de frango"), then a dog's bread or sausage, then a
        # burger's.
        base = _first(_LANCHE_BASES[1:-1], d)
        if base is None:
            dog = _DESC_DOG.search(d) and not _DESC_BURGUER.search(_DESC_PAT_BREAD.sub(" ", d))
            base = "dog" if dog else ("burguer" if _DESC_BURGUER.search(d) else None)
    if base is None and not lanche:
        base = _first(bases, d) if not _found(_PATTY + _TOPPING, n) else None
    patty = _found(_PATTY, n)
    topping = _found(_TOPPING, n)
    if not patty and not topping:
        # A name with no protein ("Especial da vila", "Cheese de filé"): the description says them, sausage
        # and ham as fillers.
        patty = _found(_PATTY, _strip_breads(d))
        topping = _found(_TOPPING, d) - {"presunto", "frios"}
        if base == "dog":
            topping.discard("salsicha")
    patties = _patties(n, d) if lanche else 1
    if lanche and base == "dog":
        topping.add("salsicha")
    elif lanche:
        beef_in_desc = bool(_DESC_BEEF.search(_strip_breads(d)))
        if not patty:
            # A burger is beef unless it says another patty; the description shows the patty when it lists
            # one.
            burger_named = bool(_BURGER_WORD.search(n)) or patties > 1
            if beef_in_desc or (burger_named and not _found(_PATTY, _DESC_PAT_BREAD.sub(" ", d))):
                patty = {"bovino"}
        elif base == "burguer" and "bovino" not in patty and beef_in_desc:
            patty.add("bovino")
    weight = _grams(n) or _grams(d)
    portion = _portion(n) if not lanche else None
    extras = {name for name, _, p in _EXTRAS if p.search(n)}
    return FoodAttrs(base, frozenset(patty | topping), patties, weight, portion, frozenset(extras))


def extra_class(extra: str) -> ExtraClass:
    return next(c for name, c, _ in _EXTRAS if name == extra)


def extras_differ_m1_04(a: FoodAttrs, b: FoodAttrs) -> bool:
    """M1-04 Stage 2, the extras rule (proposed default, Marlon decides): an extra main ingredient makes two
    items different, and it already shows as a protein; cheese or salad alone does not. The other extras the
    name lists (onion, corn, sauce...) do not either: they are how a store describes the same item."""
    del a, b
    return False


FoodMatch = Literal["identical", "unreadable", "conflict"]


def unreadable_food_m1_04(a: FoodAttrs, category: str | None) -> str | None:
    """M1-04 Stage 2: why the rule cannot read an item, as C04 says it; None when it can. A lanche needs its
    proteins; a porção needs its base or its proteins."""
    if category == "lanches" and not a.proteins:
        return "proteína ilegível"
    if category == "porcoes" and a.base is None and not a.proteins:
        return "tipo ilegível"
    return None


def compare_food_m1_04(a: FoodAttrs, b: FoodAttrs, *, by_weight: bool = False) -> FoodMatch:
    """M1-04 Stage 2: `identical` when proteins and patty count are equal, and base, weight and portion size
    are equal where both sides state them, and the extras rule lets it through. Weight and portion size do
    not count for an item normalized by weight (M1-03 already compares per 100 g)."""
    if a.proteins != b.proteins or a.patties != b.patties:
        return "conflict"
    if a.base is not None and b.base is not None and a.base != b.base:
        return "conflict"
    if not by_weight:
        if a.weight_g is not None and b.weight_g is not None and a.weight_g != b.weight_g:
            return "conflict"
        if a.portion is not None and b.portion is not None and a.portion != b.portion:
            return "conflict"
    if extras_differ_m1_04(a, b):
        return "conflict"
    if not a.proteins and (a.base is None or b.base is None):
        return "unreadable"
    return "identical"


# Exclusive items ----------------------------------------------------------------------------------

EXCLUSIVE_NOTE = "exclusivo, sem comparação"
SIGNATURE = re.compile(r"\b(?:especial|da casa|do chef|tudao|tudo|monstro|mega|super|premium|supremo|top)\b")


def signature_hint(name: str | None, store_name: str | None = None) -> bool:
    """A hint, never a rule on its own: words a store uses for its own creation, or the store's own name."""
    n = plain(name)
    if SIGNATURE.search(n):
        return True
    words = [
        w
        for w in re.findall(r"[a-z]{4,}", plain(store_name))
        if w not in {"lanches", "burguer", "burger", "hamburgueria", "lanchonete", "delivery"}
    ]
    return any(re.search(rf"\b{re.escape(w)}\b", n) for w in words)


# The shape the AI returns and the learnings store ----------------------------------------------------

LANCHE_BASES = tuple(name for name, _ in _LANCHE_BASES)
PORCAO_BASES = tuple(name for name, _ in _PORCAO_BASES)
PROTEINS = tuple(name for name, _ in (*_PATTY, *_TOPPING))
EXTRAS = tuple(name for name, _, _ in _EXTRAS)
PORTIONS = ("pequena", "media", "grande")


def attrs_to_json(a: FoodAttrs) -> dict[str, object]:
    """The attributes as the learnings store them and the AI returns them (same keys, sorted lists)."""
    return {
        "base": a.base,
        "proteinas": sorted(a.proteins),
        "carnes": a.patties,
        "peso_g": a.weight_g,
        "porcao": a.portion,
        "extras": sorted(a.extras),
    }


def attrs_from_json(d: dict[str, object], source: str = "ia") -> FoodAttrs | None:
    """Back from the stored or returned shape; None when it is not one (unknown words are dropped, a count
    out of 1 to 3 or a weight out of 10 g to 10 kg is refused)."""
    try:
        base = d.get("base")
        proteins = frozenset(str(p) for p in (d.get("proteinas") or []) if str(p) in PROTEINS)
        patties = int(d.get("carnes") or 1)  # type: ignore[call-overload]
        weight = d.get("peso_g")
        weight_g = int(weight) if weight is not None else None  # type: ignore[call-overload]
        portion = d.get("porcao")
        extras = frozenset(str(e) for e in (d.get("extras") or []) if str(e) in EXTRAS)
    except (TypeError, ValueError):
        return None
    if not 1 <= patties <= 3 or (weight_g is not None and not 10 <= weight_g <= 10000):
        return None
    if base is not None and base not in (*LANCHE_BASES, *PORCAO_BASES):
        base = None
    if portion is not None and portion not in PORTIONS and not re.fullmatch(r"\d{1,2} pessoas", str(portion)):
        portion = None
    return FoodAttrs(base, proteins, patties, weight_g, portion, extras, source)  # type: ignore[arg-type]


def description_hints_m1_04(description: str | None, category: str | None) -> tuple[str, ...]:
    """The words of the fixed lists a description holds: base, proteins, patty count. With the name tokens,
    the pattern a learning is kept under; never free text."""
    d = plain(description)
    if not d:
        return ()
    bases = _LANCHE_BASES if category == "lanches" else _PORCAO_BASES
    out = {f"base:{b}" for b in _found(bases, d)}
    out |= {f"proteina:{p}" for p in _found(_PATTY, _strip_breads(d)) | _found(_TOPPING, d)}
    for n, p in _COUNT_DESC:
        if p.search(d):
            out.add(f"carnes:{n}")
            break
    return tuple(sorted(out))


def vocabulary_word(token: str) -> bool:
    """A name token that is one of the generic words of these lists, safe to print in a report; any other
    token (a store's own word) is masked there."""
    t = token.lower()
    lists = (_LANCHE_BASES, _PORCAO_BASES, _PATTY, _TOPPING)
    if any(p.fullmatch(t) for _, p in lists[0] + lists[1] + lists[2] + lists[3]):
        return True
    if any(p.fullmatch(t) for _, _, p in _EXTRAS) or any(p.fullmatch(t) for _, p in _SIZE_WORDS):
        return True
    return t in {
        "duplo",
        "dupla",
        "triplo",
        "tripla",
        "simples",
        "porcao",
        "lanche",
        "frito",
        "frita",
        "empanado",
        "crocante",
        "artesanal",
        "especial",
        "casa",
        "tradicional",
    }
