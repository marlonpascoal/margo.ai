"""D78: a repeated AI question is paid once, and every call reports its tokens. No test calls the API. SINTÉTICO."""

from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace

from margo_collector.ai_cache import CachedAttrReader, CachedPairReviewer
from margo_collector.food import FoodAttrs
from margo_collector.learning import AiItem
from margo_collector.pair_review import CHECKS, ReviewPair, Verdict
from margo_collector.repo import MemoryXrayRepo
from margo_collector.rules import Item
from margo_common import llm


class Reviewer:
    model, prompt_version = "m1", "v1"

    def __init__(self) -> None:
        self.asked: list[str] = []

    def review(self, pairs: Sequence[ReviewPair], cuisine: str | None = None):
        self.asked += [p.ref for p in pairs]
        return {p.ref: Verdict(dict.fromkeys(CHECKS, True)) for p in pairs}


class Reader:
    model = "m1"

    def __init__(self) -> None:
        self.asked: list[str] = []

    def read(self, items):
        self.asked += [i.ref for i in items]
        attrs = FoodAttrs("burguer", frozenset({"bovino"}), 1, None, None)
        return {i.ref: (attrs, 0.9) for i in items}


def _pair(ref: str = "0", cents: int = 2000) -> ReviewPair:
    item = Item(id="a", store_id="s", name="Temaki", price_cents=cents, section="Temakis")
    return ReviewPair(ref, "pratos", item, item)


def test_D78_a_repeated_pair_is_not_asked_again():
    repo, inner = MemoryXrayRepo(), Reviewer()
    cached = CachedPairReviewer(inner, repo)
    assert cached.review([_pair()], "japonesa")["0"].approved
    assert cached.review([_pair("1")], "japonesa")["1"].approved
    assert inner.asked == ["0"]


def test_D78_a_new_price_cuisine_or_model_asks_again():
    repo, inner = MemoryXrayRepo(), Reviewer()
    cached = CachedPairReviewer(inner, repo)
    cached.review([_pair()], "japonesa")
    cached.review([_pair(cents=2100)], "japonesa")
    cached.review([_pair()], "pizza")
    inner.model = "m2"
    CachedPairReviewer(inner, repo).review([_pair()], "japonesa")
    assert len(inner.asked) == 4


def test_D78_an_attribute_is_asked_once():
    repo, inner = MemoryXrayRepo(), Reader()
    cached = CachedAttrReader(inner, repo)
    first = cached.read([AiItem("0", "X-bacon", None, "lanches")])
    second = cached.read([AiItem("7", "X-bacon", None, "lanches")])
    assert inner.asked == ["0"]
    assert second["7"][0].base == first["0"][0].base
    assert second["7"][1] == 0.9


class _Responses:
    def create(self, **_):
        text = SimpleNamespace(type="output_text", text='{"ok": 1}')
        msg = SimpleNamespace(type="message", content=[text])
        usage = SimpleNamespace(input_tokens=120, output_tokens=30)
        return SimpleNamespace(status="completed", output=[msg], usage=usage)


def test_D78_every_call_reports_its_tokens():
    llm.take_usage()
    ai = llm.StructuredClient(SimpleNamespace(responses=_Responses()), "m1", "openai")
    call = llm.Call("uso", "s", {"a": 1}, {"type": "object"}, 10)
    ai.ask(call)
    ai.ask(call)
    assert llm.take_usage() == {"uso:m1": {"calls": 2, "input_tokens": 240, "output_tokens": 60}}
    assert llm.take_usage() == {}
