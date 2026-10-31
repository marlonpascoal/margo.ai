#!/usr/bin/env python3
"""Generate the PDF renderer's tokens from apps/web/app/tokens.css (02 §9).

    uv run python scripts/gen_tokens.py          write workers/render/src/margo_render/tokens.py
    uv run python scripts/gen_tokens.py --check  fail when the file is out of date
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = ROOT / "apps/web/app/tokens.css"
OUT = ROOT / "workers/render/src/margo_render/tokens.py"

DECL = re.compile(r"^\s*--([a-z0-9-]+)\s*:\s*([^;]+);", re.M)


def parse(css: str) -> dict[str, str]:
    """Every `--name: value;` declaration; wildcard resets such as `--color-*: initial` are skipped."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return {name: value.strip() for name, value in DECL.findall(css)}


def render(tokens: dict[str, str]) -> str:
    lines = [
        '"""Design tokens for PDFs, generated from apps/web/app/tokens.css by scripts/gen_tokens.py.',
        "",
        'Do not edit by hand: change the CSS file and run the script."""',
        "",
        "TOKENS: dict[str, str] = {",
        *(f"    {json.dumps(name)}: {json.dumps(value)}," for name, value in tokens.items()),
        "}",
        "",
        "",
        "def token(name: str) -> str:",
        '    """Value of `--name`, e.g. token("color-ink")."""',
        "    return TOKENS[name]",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    expected = render(parse(CSS.read_text()))
    if args.check:
        if not OUT.exists() or OUT.read_text() != expected:
            print(f"{OUT.relative_to(ROOT)} is out of date: run scripts/gen_tokens.py")
            return 1
        print("gen_tokens: ok")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(expected)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
