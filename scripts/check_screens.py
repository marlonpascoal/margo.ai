#!/usr/bin/env python3
"""F01: every design/*.dc.html has one entry in spec/05-screens.md and a route or template in the code.

A screen not built yet must be listed in scripts/screens_pending.txt; a listed screen that is
already built fails too, so the list never goes stale.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SPEC = "spec/05-screens.md"
PENDING = "scripts/screens_pending.txt"
APP_DIR = "apps/web/app"
TEMPLATE_DIRS = ("apps", "workers", "extension")

# Flow map only, nothing to build.
REFERENCE_ONLY = {"Main"}
# Hosted by Asaas (05 §B, P10).
EXTERNAL = {"P10"}
# After 15/fev: routes reserved, not built (05 §D).
RESERVED_ROUTES = {"L01": "/app/painel", "L02": "/app/cupom/[id]"}
# Shared components named by file in the spec intro rather than by code.
COMPONENTS = {"Menu", "MenuDono"}

CODE = r"[A-Z]\d{2}"
HEADING = re.compile(rf"^###\s+({CODE}(?:\s*/\s*{CODE})*)\.", re.M)
TABLE_ROW = re.compile(rf"^\|\s*({CODE})\s*\|", re.M)
ROUTE = re.compile(r"\*\*Route\*\*\s+`([^`]+)`")
SKIP_DIRS = {"node_modules", ".next", ".venv", "__pycache__", "dist", "build"}


def design_names(root: Path) -> list[str]:
    return sorted(p.name.removesuffix(".dc.html") for p in (root / "design").glob("*.dc.html"))


def screen_code(design_name: str) -> str:
    return design_name.split("-", 1)[0]


def spec_entries(text: str) -> tuple[dict[str, int], dict[str, str]]:
    """Return (times each code is listed, route per code) from 05-screens."""
    counts: dict[str, int] = {}
    routes: dict[str, str] = {}
    headings = list(HEADING.finditer(text))
    for i, m in enumerate(headings):
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        route = ROUTE.search(text, m.end(), end)
        for code in re.findall(CODE, m.group(1)):
            counts[code] = counts.get(code, 0) + 1
            if route:
                routes[code] = route.group(1)
    for m in TABLE_ROW.finditer(text):
        if m.group(1) != "Code":
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return counts, routes


def app_routes(root: Path) -> set[str]:
    app = root / APP_DIR
    routes = set()
    for page in app.rglob("page.tsx"):
        parts = [p for p in page.parent.relative_to(app).parts if not p.startswith("(")]
        routes.add("/" + "/".join(parts))
    return routes


def template_files(root: Path) -> list[str]:
    names = []
    for d in TEMPLATE_DIRS:
        base = root / d
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and not SKIP_DIRS.intersection(p.relative_to(root).parts):
                names.append(p.name)
    return names


def has_template(names: list[str], code: str) -> bool:
    pattern = re.compile(rf"^{re.escape(code)}(?:[^A-Za-z0-9]|$)")
    return any(pattern.match(n) for n in names)


def read_pending(root: Path) -> set[str]:
    path = root / PENDING
    if not path.exists():
        return set()
    codes = set()
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            codes.add(line)
    return codes


def check(root: Path) -> list[str]:
    spec_text = (root / SPEC).read_text()
    counts, routes = spec_entries(spec_text)
    built_routes = app_routes(root)
    templates = template_files(root)
    pending = read_pending(root)
    errors: list[str] = []

    for name in design_names(root):
        code = screen_code(name)
        if code in REFERENCE_ONLY or code in COMPONENTS:
            if f"design/{name}.dc.html" not in spec_text:
                errors.append(f"{code}: design/{name}.dc.html is not named in {SPEC}")
            if code in REFERENCE_ONLY:
                continue
        elif counts.get(code, 0) == 0:
            errors.append(f"{code}: design/{name}.dc.html has no entry in {SPEC}")
            continue
        elif counts[code] > 1:
            errors.append(f"{code}: listed {counts[code]} times in {SPEC}, expected once")
            continue
        if code in EXTERNAL:
            continue

        route = routes.get(code) or RESERVED_ROUTES.get(code)
        if route:
            built = route in built_routes
            missing = f"{code}: no page for route {route}"
        else:
            built = has_template(templates, code)
            missing = f"{code}: no template file named {code}* in apps/, workers/ or extension/"
        if built and code in pending:
            errors.append(f"{code}: built but still listed in {PENDING}")
        elif not built and code not in pending:
            errors.append(f"{missing} (or list it in {PENDING})")

    # A P and W drawing share one route, so report each code once.
    return sorted(dict.fromkeys(errors))


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    errors = check(root)
    for e in errors:
        print(e)
    if not errors:
        pending = sorted(read_pending(root))
        print(f"check_screens: ok ({len(design_names(root))} drawings, {len(pending)} pending)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
