"""D78 (Marlon, 08/nov): the same AI question is paid once. Wraps the attribute reader and the pair
reviewer: a question already answered with the same model and prompt version comes from
`public.m1_ai_cache`, with no call. A new model or prompt version asks again, because the key holds both."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from typing import Any, Protocol

from .food import FoodAttrs, attrs_from_json, attrs_to_json
from .learning import AiItem, AttrReader
from .pair_review import PairReviewer, ReviewAnswers, ReviewPair, Verdict, side_of

ATTR_PROMPT = "atributos.v1"


class CacheStore(Protocol):
    def ai_cache_get(self, use: str, keys: Sequence[str]) -> dict[str, Any]: ...

    def ai_cache_put(self, use: str, answers: dict[str, Any], model: str) -> None: ...


def cache_key(*parts: Any) -> str:
    text = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(text.encode()).hexdigest()


class CachedAttrReader:
    """An AttrReader that asks only what was never answered."""

    def __init__(self, inner: AttrReader, store: CacheStore) -> None:
        self.inner, self.store, self.model = inner, store, inner.model

    def read(self, items: Sequence[AiItem]) -> dict[str, tuple[FoodAttrs, float | None]]:
        keys = {i.ref: cache_key(self.model, ATTR_PROMPT, i.name, i.description, i.category) for i in items}
        hits = self.store.ai_cache_get("atributos", list(keys.values()))
        out: dict[str, tuple[FoodAttrs, float | None]] = {}
        for ref, key in keys.items():
            attrs = attrs_from_json(hits[key]["attrs"], "ia") if key in hits else None
            if attrs is not None:
                out[ref] = (attrs, hits[key]["confidence"])
        missing = [i for i in items if i.ref not in out]
        if missing:
            found = self.inner.read(missing)
            out.update(found)
            answers = {
                keys[ref]: {"attrs": attrs_to_json(attrs), "confidence": confidence}
                for ref, (attrs, confidence) in found.items()
            }
            self.store.ai_cache_put("atributos", answers, self.model)
        return out


class CachedPairReviewer:
    """A PairReviewer that asks only what was never answered. Price and size are part of the question."""

    def __init__(self, inner: PairReviewer, store: CacheStore) -> None:
        self.inner, self.store = inner, store
        self.model, self.prompt_version = inner.model, inner.prompt_version

    def review(self, pairs: Sequence[ReviewPair], cuisine: str | None = None) -> ReviewAnswers:
        keys = {
            p.ref: cache_key(
                self.model, self.prompt_version, cuisine, p.category, side_of(p.own), side_of(p.candidate)
            )
            for p in pairs
        }
        hits = self.store.ai_cache_get("revisao", list(set(keys.values())))
        out: ReviewAnswers = {ref: Verdict(hits[key]) for ref, key in keys.items() if key in hits}
        missing = [p for p in pairs if p.ref not in out]
        if missing:
            found = self.inner.review(missing, cuisine)
            out.update(found)
            answers = {keys[r]: dict(v.checks) for r, v in found.items()}
            self.store.ai_cache_put("revisao", answers, self.model)
        return out
