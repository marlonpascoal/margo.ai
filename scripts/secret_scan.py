#!/usr/bin/env python3
"""A06: no secret value in any git file, log line or HTTP response.

With no paths, scans every file git tracks or would track (untracked, not ignored).
With paths (files or directories, e.g. saved logs or e2e responses), scans those.
Findings print path, line and kind, never the value.

CNPJ and CPF with valid check digits are allowed only under fixtures/.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

MAX_BYTES = 2_000_000
DOCUMENT_ALLOWED = ("fixtures/",)

KEY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai_key", re.compile(r"\bsk-(?:proj-|svcacct-|admin-)?(?!ant-)[A-Za-z0-9_-]{20,}")),
    ("asaas_key", re.compile(r"\$aact_[A-Za-z0-9_]{20,}")),
    ("supabase_secret", re.compile(r"sb_secret_[A-Za-z0-9_-]{20,}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("aws_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
]

ASSIGNED = re.compile(
    r"""(?ix)
    [\w.-]*(?:key|secret|token|passw(?:or)?d)[\w.-]*   # name
    ["']?\s*[:=]\s*                                     # assignment
    ["']([^"'\s]{16,})["']                              # quoted value
    """
)
PLACEHOLDER = re.compile(r"(?i)^<.*>$|^\$\{|^env\(|changeme|placeholder|example|xxxx|dummy|your[-_]")

CNPJ_FMT = re.compile(r"(?<!\d)(\d{2})\.(\d{3})\.(\d{3})/(\d{4})-(\d{2})(?!\d)")
CNPJ_BARE = re.compile(r"(?<![\d.])(\d{14})(?![\d])")
CPF_FMT = re.compile(r"(?<!\d)(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)")


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    kind: str


def _dv(digits: str, weights: list[int]) -> int:
    r = sum(int(d) * w for d, w in zip(digits, weights, strict=True)) % 11
    return 0 if r < 2 else 11 - r


def valid_cnpj(n: str) -> bool:
    if len(n) != 14 or len(set(n)) == 1:
        return False
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    d1 = _dv(n[:12], w1)
    d2 = _dv(n[:12] + str(d1), [6] + w1)
    return n[12:] == f"{d1}{d2}"


def valid_cpf(n: str) -> bool:
    if len(n) != 11 or len(set(n)) == 1:
        return False
    d1 = _dv(n[:9], list(range(10, 1, -1)))
    d2 = _dv(n[:9] + str(d1), list(range(11, 1, -1)))
    return n[9:] == f"{d1}{d2}"


def _is_secret_value(value: str) -> bool:
    if PLACEHOLDER.search(value):
        return False
    # Identifiers such as env var names or dotted paths are not values.
    if re.fullmatch(r"[A-Z0-9_]+|[a-z0-9_.]+", value):
        return False
    return bool(re.search(r"\d", value) and re.search(r"[A-Za-z]", value))


def scan_text(path: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    check_documents = not path.startswith(DOCUMENT_ALLOWED)
    for lineno, line in enumerate(text.splitlines(), 1):
        kinds: list[str] = [k for k, rx in KEY_PATTERNS if rx.search(line)]
        if not kinds:
            for m in ASSIGNED.finditer(line):
                if _is_secret_value(m.group(1)):
                    kinds.append("assigned_secret")
                    break
        if check_documents:
            if any(valid_cnpj("".join(m.groups())) for m in CNPJ_FMT.finditer(line)) or any(
                valid_cnpj(m.group(1)) for m in CNPJ_BARE.finditer(line)
            ):
                kinds.append("cnpj")
            if any(valid_cpf("".join(m.groups())) for m in CPF_FMT.finditer(line)):
                kinds.append("cpf")
        findings.extend(Finding(path, lineno, k) for k in kinds)
    return findings


def _is_env_file(rel: Path) -> bool:
    return rel.name.startswith(".env") and rel.name != ".env.example"


def _scan_file(root: Path, rel: Path) -> list[Finding]:
    rel_str = rel.as_posix()
    if _is_env_file(rel):
        # Never open it: its presence is the finding.
        return [Finding(rel_str, 0, "env_file")]
    full = root / rel
    if not full.is_file() or full.stat().st_size > MAX_BYTES:
        return []
    data = full.read_bytes()
    if b"\0" in data[:8192]:
        return []
    findings = scan_text(rel_str, data.decode("utf-8", errors="replace"))
    if rel.name == ".env.example":
        for lineno, line in enumerate(data.decode("utf-8", errors="replace").splitlines(), 1):
            if re.match(r"^\s*[A-Z0-9_]+\s*=\s*\S", line):
                findings.append(Finding(rel_str, lineno, "env_example_value"))
    return findings


def scan_paths(root: Path, paths: list[Path]) -> list[Finding]:
    findings: list[Finding] = []
    for rel in paths:
        full = root / rel
        if full.is_dir():
            files = sorted(p.relative_to(root) for p in full.rglob("*") if p.is_file() or _is_env_file(p))
        else:
            files = [rel]
        for f in files:
            findings.extend(_scan_file(root, f))
    return findings


def git_files(root: Path) -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        capture_output=True,
        check=True,
    )
    # git lists a nested repository or worktree (e.g. .claude/worktrees/agent-*) as one directory entry.
    # It is a separate checkout that runs its own scan; walking it here would read its node_modules and
    # its local .env files.
    return [
        Path(p)
        for p in out.stdout.decode().split("\0")
        if p and not (p.endswith("/") and (root / p / ".git").exists())
    ]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("paths", nargs="*", type=Path)
    args = ap.parse_args(argv)
    root = args.root.resolve()
    paths = args.paths or git_files(root)
    findings = scan_paths(root, paths)
    for f in findings:
        print(f"{f.path}:{f.line}: {f.kind}")
    if not findings:
        print(f"secret_scan: ok ({len(paths)} paths)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
