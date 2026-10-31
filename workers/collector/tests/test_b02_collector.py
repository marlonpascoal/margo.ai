"""B02: the collector waits at least 3 s between requests and stops on a block (D47).

A fake clock and a fake transport stand in for time and the network. The fake transport answers with
generic HTTP statuses and a generic captcha marker; no iFood page is imitated (D40: pages are recorded,
never invented). The collection itself is driven by a test double of the PublicPages interface.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from margo_collector.cli import record, scrub
from margo_collector.fetcher import (
    CaptchaBlock,
    CollectorBusy,
    CollectorStopped,
    FetchFailed,
    ForbiddenBlock,
    LiveCallRefused,
    LoginWall,
    MemoryLock,
    MemoryPageCache,
    NotPublicPage,
    PoliteFetcher,
    RateLimitBlock,
    RefusingTransport,
    Response,
    live_transport_allowed,
    user_agent,
)
from margo_collector.ifood_public import (
    AwaitingRecordings,
    ParsedItem,
    ParsedStore,
    UnrecordedPages,
    canonical_store_url,
    store_id_from_url,
)
from margo_collector.repo import MemoryXrayRepo
from margo_collector.steps import XrayRun, collect_step

STORE = "https://www.ifood.com.br/delivery/londrina-pr/loja/0b6f6f2e-1111-4222-8333-944455556666"


@dataclass
class FakeClock:
    t: float = 1000.0
    wall: datetime = datetime(2026, 10, 28, 13, 0, tzinfo=UTC)
    sleeps: list[float] = field(default_factory=list)

    def now(self) -> datetime:
        return self.wall + timedelta(seconds=self.t - 1000.0)

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += seconds

    def advance(self, seconds: float) -> None:
        self.t += seconds


@dataclass
class FakeTransport:
    """Answers by URL; records (clock time, url, headers) of every request."""

    clock: FakeClock
    answers: dict[str, Response] = field(default_factory=dict)
    calls: list[tuple[float, str, dict[str, str]]] = field(default_factory=list)

    def get(self, url, headers):
        self.calls.append((self.clock.monotonic(), url, dict(headers)))
        return self.answers.get(url, Response(200, b"<html>ok</html>", url))


def page(n: int) -> str:
    return f"{STORE}?p={n}"


def fetcher(clock: FakeClock, transport: FakeTransport, cache=None) -> PoliteFetcher:
    return PoliteFetcher(transport, clock, cache or MemoryPageCache(), contact="contato@margoai.com")


def test_B02_waits_3s_between_requests():
    clock = FakeClock()
    t = FakeTransport(clock)
    f = fetcher(clock, t)
    for n in range(4):
        f.fetch(page(n))
    starts = [c[0] for c in t.calls]
    assert all(b - a >= 3.0 for a, b in zip(starts, starts[1:], strict=False))
    assert clock.sleeps == [3.0, 3.0, 3.0]


def test_B02_waits_only_what_is_left_of_the_3s():
    clock = FakeClock()
    t = FakeTransport(clock)
    f = fetcher(clock, t)
    f.fetch(page(1))
    clock.advance(1.25)
    f.fetch(page(2))
    clock.advance(5)
    f.fetch(page(3))
    assert clock.sleeps == [1.75]
    starts = [c[0] for c in t.calls]
    assert starts[1] - starts[0] == 3.0


@pytest.mark.parametrize(
    ("answer", "error"),
    [
        (Response(403, b"", STORE), ForbiddenBlock),
        (Response(401, b"", STORE), ForbiddenBlock),
        (Response(429, b"", STORE), RateLimitBlock),
        (Response(200, b"<html><div class='g-recaptcha'></div></html>", STORE), CaptchaBlock),
        (Response(200, b"<p>Are you a robot?</p>", STORE), CaptchaBlock),
        (Response(302, b"", "https://www.ifood.com.br/entrar?next=/"), LoginWall),
        (Response(302, b"", "https://portal.ifood.com.br/"), LoginWall),
    ],
)
def test_B02_stops_on_a_block_and_never_retries(answer, error):
    clock = FakeClock()
    t = FakeTransport(clock, {page(2): answer})
    f = fetcher(clock, t)
    f.fetch(page(1))
    with pytest.raises(error):
        f.fetch(page(2))
    # Stopped: nothing else goes out, not even a different page.
    with pytest.raises(CollectorStopped):
        f.fetch(page(3))
    with pytest.raises(CollectorStopped):
        f.fetch(page(2))
    assert [c[1] for c in t.calls] == [page(1), page(2)]


def test_B02_other_http_errors_fail_without_retry():
    clock = FakeClock()
    t = FakeTransport(clock, {page(1): Response(500, b"", page(1))})
    with pytest.raises(FetchFailed):
        fetcher(clock, t).fetch(page(1))
    assert len(t.calls) == 1


def test_B02_user_agent_names_margoai_with_a_contact_and_sends_no_credentials():
    clock = FakeClock()
    t = FakeTransport(clock)
    fetcher(clock, t).fetch(page(1))
    headers = t.calls[0][2]
    assert headers["User-Agent"] == user_agent("contato@margoai.com")
    assert "MargoAI" in headers["User-Agent"] and "contato@margoai.com" in headers["User-Agent"]
    assert set(headers) == {"User-Agent", "Accept", "Accept-Language"}


@pytest.mark.parametrize(
    "url",
    [
        "http://www.ifood.com.br/delivery/x/y/0b6f6f2e-1111-4222-8333-944455556666",
        "https://portal.ifood.com.br/financeiro",
        "https://www.ifood.com.br/entrar",
        "https://www.ifood.com.br/login?next=/",
        "https://user:pw@www.ifood.com.br/delivery/x",
        "https://example.com/delivery/x",
    ],
)
def test_B02_only_public_ifood_pages(url):
    clock = FakeClock()
    t = FakeTransport(clock)
    with pytest.raises(NotPublicPage):
        fetcher(clock, t).fetch(url)
    assert t.calls == []


def test_B02_raw_pages_are_cached_7_days():
    clock = FakeClock()
    t = FakeTransport(clock)
    cache = MemoryPageCache()
    fetcher(clock, t, cache).fetch(page(1))
    clock.advance(6 * 86400)
    fetcher(clock, t, cache).fetch(page(1))
    assert len(t.calls) == 1, "served from the cache within 7 days"
    clock.advance(86400)
    assert cache.purge(clock.now()) == 1
    fetcher(clock, t, cache).fetch(page(1))
    assert len(t.calls) == 2


def test_B02_live_http_is_refused_by_default():
    with pytest.raises(LiveCallRefused):
        RefusingTransport().get(STORE, {})
    assert live_transport_allowed({}) is False
    assert live_transport_allowed({"MARGO_COLLECTOR_LIVE": "1"}) is True


def test_D29_store_id_from_the_end_of_the_url():
    assert store_id_from_url(STORE) == "0b6f6f2e-1111-4222-8333-944455556666"
    assert store_id_from_url(
        "ifood.com.br/delivery/londrina-pr/x/0B6F6F2E-1111-4222-8333-944455556666/?utm=1"
    ) == ("0b6f6f2e-1111-4222-8333-944455556666")
    assert store_id_from_url("https://www.ifood.com.br/delivery/londrina-pr/x") is None
    assert store_id_from_url("https://example.com/delivery/a/b/0b6f6f2e-1111-4222-8333-944455556666") is None
    assert canonical_store_url("ifood.com.br/delivery/a/b/c?x=1") == "https://www.ifood.com.br/delivery/a/b/c"


# The collection run ----------------------------------------------------------------------------------


class ScriptedPages:
    """Test double of PublicPages: it returns rows it was given and never reads the page body."""

    def __init__(self, stores: dict[str, ParsedStore], listing: list[str]):
        self.stores = stores
        self.listing = listing

    def ready(self) -> bool:
        return True

    def neighborhood_urls(self, target, radius_km, categories):
        return ["https://www.ifood.com.br/lista-de-teste"]

    def parse_listing(self, body):
        return self.listing

    def parse_store(self, url, body, seen_at):
        return self.stores[url]


def parsed(n: int, km_north: float, **kw) -> ParsedStore:
    url = f"https://www.ifood.com.br/delivery/londrina-pr/loja-{n}/0b6f6f2e-1111-4222-8333-9444555566{n:02d}"
    lat = Decimal(str(round(-23.33 + km_north / 111.19508, 6)))
    return ParsedStore(
        f"id-{n}",
        url,
        f"Loja {n}",
        "Londrina",
        "Lanches",
        lat,
        Decimal("-51.15"),
        datetime(2026, 10, 28, tzinfo=UTC),
        items=(ParsedItem("1", "Sundae", 1000),),
        **kw,
    )


def run_setup(listing_n: int = 3):
    target = parsed(0, 0)
    stores = {target.url: target} | {
        parsed(n, n * 0.5).url: parsed(n, n * 0.5) for n in range(1, listing_n + 1)
    }
    pages = ScriptedPages(stores, [u for u in stores if u != target.url])
    repo = MemoryXrayRepo()
    tid = repo.save_public_store(target)
    repo.xrays["x1"] = XrayRun("x1", None, tid, target.url, 3, ["Lanches"], {}, None)
    return repo, pages, target


def test_B02_collection_keeps_the_pace_and_builds_the_neighborhood():
    repo, pages, _ = run_setup()
    clock = FakeClock()
    t = FakeTransport(clock)
    out = collect_step(repo, "x1", fetcher=fetcher(clock, t), pages=pages, lock=MemoryLock(), clock=clock)
    assert out == {"stores": 3, "in_set": 3, "requests": 5}  # target, listing, three stores
    starts = [c[0] for c in t.calls]
    assert all(b - a >= 3.0 for a, b in zip(starts, starts[1:], strict=False))
    assert repo.xrays["x1"].collected_at is not None


def test_B02_collection_stops_on_a_block_and_writes_no_neighborhood():
    repo, pages, _ = run_setup()
    clock = FakeClock()
    blocked_url = pages.listing[1]
    t = FakeTransport(clock, {blocked_url: Response(200, b"<div id='captcha'></div>", blocked_url)})
    with pytest.raises(CaptchaBlock):
        collect_step(repo, "x1", fetcher=fetcher(clock, t), pages=pages, lock=MemoryLock(), clock=clock)
    assert [c[1] for c in t.calls][-1] == blocked_url, "no request after the block"
    assert "x1" not in repo.hood
    assert repo.xrays["x1"].collected_at is None


def test_B02_one_collector_at_a_time():
    repo, pages, _ = run_setup()
    clock = FakeClock()
    t = FakeTransport(clock)
    lock = MemoryLock()
    assert lock.try_acquire()
    with pytest.raises(CollectorBusy):
        collect_step(repo, "x1", fetcher=fetcher(clock, t), pages=pages, lock=lock, clock=clock)
    assert t.calls == []
    lock.release()
    collect_step(repo, "x1", fetcher=fetcher(clock, t), pages=pages, lock=lock, clock=clock)
    assert lock.held is False, "the lock is released after the run"


def test_B02_without_recorded_pages_no_request_is_made():
    repo, _, _ = run_setup()
    clock = FakeClock()
    t = FakeTransport(clock)
    with pytest.raises(AwaitingRecordings):
        collect_step(
            repo, "x1", fetcher=fetcher(clock, t), pages=UnrecordedPages(), lock=MemoryLock(), clock=clock
        )
    assert t.calls == []


# The record command ------------------------------------------------------------------------------------


def test_B02_record_scrubs_personal_data_and_writes_a_manifest(tmp_path):
    clock = FakeClock()
    body = (
        b"<p>Loja 1</p><p>contato: dono@exemplo.com.br, (43) 99999-1234, CPF 111.222.333-00</p><p>R$ 5,00</p>"
    )
    t = FakeTransport(clock, {page(1): Response(200, body, page(1))})
    assert record([page(1), page(2)], tmp_path, transport=t, clock=clock) == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    first = (tmp_path / manifest["pages"][0]["file"]).read_bytes()
    assert b"dono@exemplo" not in first and b"99999-1234" not in first and b"111.222.333-00" not in first
    assert b"Loja 1" in first and b"R$ 5,00" in first
    assert manifest["pages"][0]["personal_data_removed"] == 3
    assert "MargoAI" in manifest["user_agent"]
    assert clock.sleeps == [3.0]


def test_B02_record_stops_at_the_first_block(tmp_path):
    clock = FakeClock()
    t = FakeTransport(clock, {page(2): Response(429, b"", page(2))})
    assert record([page(1), page(2), page(3)], tmp_path, transport=t, clock=clock) == 2
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["stopped"] == {"url": page(2), "reason": "RateLimitBlock"}
    assert len(manifest["pages"]) == 1
    assert [c[1] for c in t.calls] == [page(1), page(2)]


def test_B02_record_refuses_non_public_urls_before_any_request(tmp_path):
    clock = FakeClock()
    t = FakeTransport(clock)
    with pytest.raises(NotPublicPage):
        record([page(1), "https://portal.ifood.com.br/"], tmp_path, transport=t, clock=clock)
    assert t.calls == []


def test_scrub_keeps_prices_and_ids():
    clean, n = scrub(b'{"id": "1730000000", "price": 1490, "name": "Batata"}')
    assert n == 0 and b"1730000000" in clean
