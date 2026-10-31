"""How worker-collector reads public pages (D47).

Only public iFood store pages, no login, a user agent that names MargoAI with a contact address, at most
one request every 3 seconds, one collector at a time, raw pages cached 7 days, and the run stops on any
captcha or block: no retry, no way around it, ever.

The HTTP transport, the clock, the page cache and the lock are interfaces, so tests run with fakes (B02)
and nothing here opens a socket unless a live transport is passed in.
"""

from __future__ import annotations

import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol

MIN_INTERVAL_S = 3.0
"""D47: at most one request every 3 seconds."""
CACHE_DAYS = 7
"""D47: raw pages are kept 7 days."""
DEFAULT_CONTACT = "contato@margoai.com"
PUBLIC_HOSTS = frozenset({"www.ifood.com.br", "ifood.com.br"})
"""D47: public store pages only. The Partner Portal and any login host are refused."""
LOGIN_PATH = re.compile(r"/(login|entrar|auth|conta|account|signin|sign-in)(/|$|\?)", re.IGNORECASE)
CAPTCHA_MARKERS = (
    b"captcha",
    b"recaptcha",
    b"hcaptcha",
    b"challenge-platform",
    b"cf-chl",
    b"are you a robot",
    b"are you human",
    b"n\xc3\xa3o sou um rob\xc3\xb4",  # "não sou um robô"
    b"acesso negado",
    b"access denied",
)
"""Generic signs of a challenge page in any site's HTML, matched case-insensitively."""
BLOCK_STATUS = {401: "ForbiddenBlock", 403: "ForbiddenBlock", 429: "RateLimitBlock"}


def user_agent(contact: str = DEFAULT_CONTACT) -> str:
    """D47: names MargoAI and a contact address."""
    return f"MargoAI-coletor/1.0 (+https://margoai.com; {contact})"


# Interfaces ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Response:
    status: int
    body: bytes
    url: str
    """Final URL after redirects."""
    headers: Mapping[str, str] = field(default_factory=dict)


class Transport(Protocol):
    def get(self, url: str, headers: Mapping[str, str]) -> Response: ...


class Clock(Protocol):
    def now(self) -> datetime: ...

    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


@dataclass(frozen=True)
class CachedPage:
    url: str
    status: int
    body: bytes
    fetched_at: datetime


class PageCache(Protocol):
    def get(self, url: str, now: datetime) -> CachedPage | None:
        """A page fetched less than CACHE_DAYS ago, else None."""
        ...

    def put(self, page: CachedPage) -> None: ...

    def purge(self, now: datetime) -> int:
        """Delete pages older than CACHE_DAYS; returns how many."""
        ...


class CollectorLock(Protocol):
    def try_acquire(self) -> bool: ...

    def release(self) -> None: ...


# Errors -------------------------------------------------------------------------------------------


class Blocked(Exception):
    """The site refused us. The run stops here; nothing retries or works around it (D47)."""


class CaptchaBlock(Blocked):
    pass


class ForbiddenBlock(Blocked):
    pass


class RateLimitBlock(Blocked):
    pass


class LoginWall(Blocked):
    """The page redirected to a login: not a public page any more."""


class CollectorStopped(Exception):
    """A fetch after a block in the same run."""


class CollectorBusy(Exception):
    """Another collector holds the lock (one collector at a time, D47)."""


class NotPublicPage(Exception):
    """The URL is not a public iFood page (D47)."""


class FetchFailed(Exception):
    """Any other HTTP error. Not retried either."""


class LiveCallRefused(Exception):
    """No live HTTP outside a command Marlon runs (CLAUDE.md rule 3)."""


# Implementations ----------------------------------------------------------------------------------


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)

    def monotonic(self) -> float:
        import time

        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        import time

        time.sleep(seconds)


class MemoryPageCache:
    def __init__(self) -> None:
        self.pages: dict[str, CachedPage] = {}

    def get(self, url: str, now: datetime) -> CachedPage | None:
        p = self.pages.get(url)
        return p if p and now - p.fetched_at < timedelta(days=CACHE_DAYS) else None

    def put(self, page: CachedPage) -> None:
        self.pages[page.url] = page

    def purge(self, now: datetime) -> int:
        old = [u for u, p in self.pages.items() if now - p.fetched_at >= timedelta(days=CACHE_DAYS)]
        for u in old:
            del self.pages[u]
        return len(old)


class MemoryLock:
    def __init__(self) -> None:
        self.held = False

    def try_acquire(self) -> bool:
        if self.held:
            return False
        self.held = True
        return True

    def release(self) -> None:
        self.held = False


@contextmanager
def single_collector(lock: CollectorLock) -> Iterator[None]:
    """D47: one collector at a time. A second one fails at once instead of waiting."""
    if not lock.try_acquire():
        raise CollectorBusy()
    try:
        yield
    finally:
        lock.release()


class RefusingTransport:
    """The default outside `collector record` and MARGO_COLLECTOR_LIVE=1: never opens a socket."""

    def get(self, url: str, headers: Mapping[str, str]) -> Response:
        raise LiveCallRefused()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


class UrllibTransport:
    """Live HTTP GET without cookies. Redirects are not followed: a 3xx comes back as is, and the
    fetcher treats a redirect to a login page as a block."""

    def __init__(self, timeout_s: float = 30.0) -> None:
        self.timeout_s = timeout_s
        self._opener = urllib.request.build_opener(_NoRedirect())

    def get(self, url: str, headers: Mapping[str, str]) -> Response:
        req = urllib.request.Request(url, method="GET", headers=dict(headers))
        try:
            with self._opener.open(req, timeout=self.timeout_s) as resp:  # noqa: S310 (public host checked)
                return Response(resp.status, resp.read(), resp.geturl(), dict(resp.headers))
        except urllib.error.HTTPError as e:
            location = e.headers.get("Location") if e.headers else None
            target = urllib.parse.urljoin(url, location) if location else url
            return Response(e.code, e.read() or b"", target, dict(e.headers or {}))


def live_transport_allowed(environ: Mapping[str, str] = os.environ) -> bool:
    return environ.get("MARGO_COLLECTOR_LIVE") == "1"


# The fetcher --------------------------------------------------------------------------------------


def check_public_url(url: str) -> None:
    """D47: https, a public iFood host, no login path."""
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.hostname not in PUBLIC_HOSTS or LOGIN_PATH.search(u.path) or u.username:
        raise NotPublicPage()


def looks_blocked(resp: Response) -> type[Blocked] | None:
    if resp.status in BLOCK_STATUS:
        return ForbiddenBlock if resp.status in (401, 403) else RateLimitBlock
    if 300 <= resp.status < 400:
        target = urllib.parse.urlsplit(resp.url)
        if target.hostname not in PUBLIC_HOSTS or LOGIN_PATH.search(target.path):
            return LoginWall
    lowered = resp.body[:200_000].lower()
    if any(m in lowered for m in CAPTCHA_MARKERS):
        return CaptchaBlock
    return None


class PoliteFetcher:
    """D47 in one place. One instance per run: after a block every later fetch raises CollectorStopped."""

    def __init__(
        self,
        transport: Transport,
        clock: Clock,
        cache: PageCache,
        *,
        contact: str = DEFAULT_CONTACT,
        min_interval_s: float = MIN_INTERVAL_S,
    ) -> None:
        self.transport = transport
        self.clock = clock
        self.cache = cache
        self.headers = {
            "User-Agent": user_agent(contact),
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.5",
            "Accept-Language": "pt-BR,pt;q=0.9",
        }
        self.min_interval_s = min_interval_s
        self.requests = 0
        self.stopped: Blocked | None = None
        self._last: float | None = None

    def fetch(self, url: str) -> bytes:
        if self.stopped is not None:
            raise CollectorStopped() from self.stopped
        check_public_url(url)
        cached = self.cache.get(url, self.clock.now())
        if cached is not None:
            return cached.body
        if self._last is not None:
            wait = self.min_interval_s - (self.clock.monotonic() - self._last)
            if wait > 0:
                self.clock.sleep(wait)
        self._last = self.clock.monotonic()
        self.requests += 1
        resp = self.transport.get(url, self.headers)
        blocked = looks_blocked(resp)
        if blocked is not None:
            self.stopped = blocked()
            raise self.stopped
        if resp.status != 200:
            raise FetchFailed(resp.status)
        self.cache.put(CachedPage(url, resp.status, resp.body, self.clock.now()))
        return resp.body
