"""M1-12: how good the pair reviewer is, measured offline against pairs whose right answer is known (D73).

`LABELED` holds SINTÉTICO pairs: generic products, no restaurant's menu, each with the verdict a person
would give. `uv run record-ai-pair-review` (Marlon runs it) stores what the model answered; `uv run score-
ai-pair-review` scores every recording with no API call, so a new prompt version or model can be compared
with the last one."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from margo_common import llm

from .pair_review import ReviewPair, parse_response
from .rules import Item

OUT = Path(__file__).resolve().parents[4] / "fixtures" / "ai"


def _pair(ref: int, category: str, own: tuple[str, str, int], other: tuple[str, str, int]) -> ReviewPair:
    return ReviewPair(
        str(ref),
        category,
        Item(id=f"o{ref}", store_id="t", name=own[0], section=own[1], price_cents=own[2]),
        Item(id=f"c{ref}", store_id="v", name=other[0], section=other[1], price_cents=other[2]),
    )


_CASES: tuple[tuple[str, tuple[str, str, int], tuple[str, str, int], bool], ...] = (
    ("pratos", ("Frango", "Espetos", 1590), ("Espeto de frango", "Churrasco", 1700), True),
    ("pratos", ("Frango", "Espetos", 1590), ("Estrogonofe de frango", "Pratos", 4990), False),
    ("pratos", ("Frango", "Espetos", 1590), ("Bowl de frango xadrez", "Delícias", 3990), False),
    ("pratos", ("Temaki de salmão", "Temakis", 3200), ("Temaki salmão completo", "Temaki", 3500), True),
    ("pratos", ("Temaki mini de salmão", "Temaki Mini", 2790), ("Temaki de salmão", "Temakis", 4000), False),
    ("porcoes", ("Sashimi de peixe", "Porções", 4290), ("Sashimi de peixe branco", "Entradas", 4800), True),
    ("porcoes", ("Sashimi de peixe", "Porções", 4290), ("Isca de peixe", "Porções", 3300), False),
    ("porcoes", ("Sashimi de peixe", "Porções", 4290), ("Peixe à milanesa", "Pratos", 8590), False),
    ("porcoes", ("Carpaccio de salmão", "Entradas", 4090), ("Carpaccio de salmão", "Opções", 4700), True),
    ("porcoes", ("Carpaccio de salmão", "Entradas", 4090), ("Bolinho de salmão", "Porções", 3200), False),
    ("porcoes", ("Batata frita média", "Porções", 2500), ("Batata frita", "Porções", 2700), True),
    ("lanches", ("X-bacon", "Lanches", 3900), ("X-bacon artesanal", "Burgers", 4200), True),
    ("lanches", ("X-bacon", "Lanches", 3900), ("Dog com bacon", "Dogs", 2800), False),
    ("sobremesas", ("Brownie de chocolate", "Doces", 1800), ("Brownie chocolate", "Sobremesas", 1900), True),
    ("sobremesas", ("Brownie de chocolate", "Doces", 1800), ("Sorvete de chocolate", "Doces", 1500), False),
    ("bebidas", ("Refrigerante cola 350ml", "Bebidas", 800), ("Cola lata 350ml", "Bebidas", 750), True),
    ("bebidas", ("Refrigerante cola 350ml", "Bebidas", 800), ("Suco laranja 300ml", "Bebidas", 1200), False),
)
LABELED: tuple[tuple[ReviewPair, bool], ...] = tuple(
    (_pair(n, cat, own, other), ok) for n, (cat, own, other, ok) in enumerate(_CASES)
)


def score_answers(
    approved: Mapping[str, bool], labeled: Sequence[tuple[ReviewPair, bool]] = LABELED
) -> dict[str, Any]:
    """Accuracy over the pairs answered, bad pairs let through and good pairs rejected."""
    let_through = rejected_good = hits = answered = 0
    for pair, right in labeled:
        got = approved.get(pair.ref)
        if got is None:
            continue
        answered += 1
        hits += got == right
        let_through += got and not right
        rejected_good += right and not got
    return {
        "pares": len(labeled),
        "respondidos": answered,
        "acerto": round(hits / answered, 3) if answered else None,
        "ruins_que_passaram": let_through,
        "bons_reprovados": rejected_good,
    }


def score_recording(record: Mapping[str, Any]) -> dict[str, Any]:
    refs = {p.ref for p, _ in LABELED}
    answers = parse_response(record["response"], refs, record.get("provider", llm.DEFAULT_PROVIDER))
    return {
        "modelo": record.get("request", {}).get("model"),
        "versao": record.get("prompt_version"),
        **score_answers({ref: v.approved for ref, v in answers.items()}),
    }


def main(argv: list[str] | None = None) -> int:
    """`uv run score-ai-pair-review [file ...]`: one line per recording (default: all of them)."""
    args = sys.argv[1:] if argv is None else argv
    files = [Path(a) for a in args] or sorted(OUT.glob("pair-review-*.json"))
    if not files:
        print("nenhuma gravação: rode uv run record-ai-pair-review")
        return 1
    for f in files:
        print(f.name, json.dumps(score_recording(json.loads(f.read_text())), ensure_ascii=False))
    return 0
