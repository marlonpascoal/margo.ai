"""`uv run collector record`: record public iFood pages as fixtures, in a command Marlon types (D40).

    uv run collector record --url <public store or listing URL> [--url ...] --out fixtures/m1/<name>

The only live path in worker-collector. It obeys D47 like the worker: public iFood pages only, the MargoAI
user agent with a contact address, one request every 3 seconds, and it stops at the first captcha or block
(exit code 2), keeping what it already recorded. Before writing, it removes what looks personal (e-mail
addresses, phone numbers, CPF and CNPJ numbers). See fixtures/m1/README.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Sequence
from pathlib import Path

from .fetcher import (
    DEFAULT_CONTACT,
    Blocked,
    Clock,
    FetchFailed,
    MemoryPageCache,
    NotPublicPage,
    PoliteFetcher,
    SystemClock,
    Transport,
    UrllibTransport,
    check_public_url,
    user_agent,
)

SCRUB = [
    (re.compile(rb"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), b"[email removido]"),
    (re.compile(rb"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"), b"[cpf removido]"),
    (re.compile(rb"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"), b"[cnpj removido]"),
    (
        re.compile(rb"(?:\+55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}\b|\+55\s?\d{2}\s?9?\d{4}-?\d{4}\b"),
        b"[telefone removido]",
    ),
]
"""Personal data patterns. Store names, prices and menu text stay (D47)."""


def scrub(body: bytes) -> tuple[bytes, int]:
    """Remove what looks personal; returns the clean body and how many matches were removed."""
    total = 0
    for pattern, repl in SCRUB:
        body, n = pattern.subn(repl, body)
        total += n
    return body, total


def slug(url: str) -> str:
    tail = re.sub(r"[^a-z0-9]+", "-", url.lower().split("://", 1)[-1]).strip("-")
    return tail[-80:] or "page"


def record(
    urls: Sequence[str],
    out: Path,
    *,
    transport: Transport,
    clock: Clock,
    contact: str = DEFAULT_CONTACT,
) -> int:
    """Fetch each URL politely, scrub it, write it and a manifest. 0 ok, 2 stopped on a block, 1 error."""
    for u in urls:
        check_public_url(u)
    out.mkdir(parents=True, exist_ok=True)
    fetcher = PoliteFetcher(transport, clock, MemoryPageCache(), contact=contact)
    manifest: dict[str, object] = {"user_agent": user_agent(contact), "pages": []}
    pages: list[dict[str, object]] = manifest["pages"]  # type: ignore[assignment]
    code = 0
    for i, url in enumerate(urls, start=1):
        try:
            body = fetcher.fetch(url)
        except Blocked as e:
            manifest["stopped"] = {"url": url, "reason": type(e).__name__}
            code = 2
            break
        except FetchFailed as e:
            manifest["stopped"] = {"url": url, "reason": f"http {e.args[0]}"}
            code = 1
            break
        clean, removed = scrub(body)
        name = f"{i:02d}-{slug(url)}.html"
        (out / name).write_bytes(clean)
        pages.append(
            {
                "url": url,
                "file": name,
                "fetched_at": clock.now().isoformat(),
                "bytes": len(clean),
                "sha256": hashlib.sha256(clean).hexdigest(),
                "personal_data_removed": removed,
            }
        )
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="collector", description="worker-collector tools (D47).")
    sub = parser.add_subparsers(dest="command", required=True)
    rec = sub.add_parser("record", help="record public iFood pages as fixtures (live, Marlon only)")
    rec.add_argument("--url", action="append", required=True, help="public iFood page; repeat for more")
    rec.add_argument("--out", required=True, type=Path, help="directory under fixtures/m1/")
    rec.add_argument("--contact", default=DEFAULT_CONTACT, help="contact address in the user agent")
    args = parser.parse_args(argv)
    try:
        code = record(
            args.url, args.out, transport=UrllibTransport(), clock=SystemClock(), contact=args.contact
        )
    except NotPublicPage:
        print("only public https://www.ifood.com.br pages, without login (D47)", file=sys.stderr)
        return 1
    print(
        {0: "recorded", 1: "stopped: http error", 2: "stopped: blocked (D47, no retry)"}[code],
        file=sys.stderr,
    )
    return code


if __name__ == "__main__":
    sys.exit(main())
