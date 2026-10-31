"""A06: no secret value in any git file, log line or HTTP response.

Sample secrets are assembled at runtime so this file never contains one.
"""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import secret_scan  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "secret_scan.py"


def kinds(path: str, text: str) -> list[str]:
    return [f.kind for f in secret_scan.scan_text(path, text)]


# Fake values built from parts; none is a real credential.
ANTHROPIC = "sk-" + "ant-api03-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"
ASAAS = "$" + "aact_" + "YTU5YTE0M2M2N2I4MTZlMGI0OGI2N2Q4"
JWT = (
    "eyJ"
    + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    + ".eyJ"
    + "zdWIiOiIxMjM0NTY3ODkwIn0"
    + ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
)
PEM = "-----BEGIN " + "RSA PRIVATE KEY-----"
AWS = "AKIA" + "IOSFODNN7EXAMPLE"
GITHUB = "ghp_" + "a" * 18 + "B1" * 9
SUPABASE_SECRET = "sb_" + "secret_" + "N7xQ2pL9vR4tY8wZ1aB3cD5e"
# Valid check digits (public example CNPJ and CPF used in docs and validators).
CNPJ_VALID = "11.222.333/" + "0001-81"
CNPJ_VALID_BARE = "11222333" + "000181"
CPF_VALID = "529.982." + "247-25"
ASSIGNED = "client_secret = " + '"Zx81kLmQ92vBn47TrW5pYc3d"'


@pytest.mark.parametrize(
    "text,kind",
    [
        (f'ANTHROPIC_API_KEY="{ANTHROPIC}"', "anthropic_key"),
        (f"key: {ASAAS}", "asaas_key"),
        (f"const k = '{JWT}'", "jwt"),
        (PEM, "private_key"),
        (f"aws={AWS}", "aws_key"),
        (f"token {GITHUB}", "github_token"),
        (f"service: {SUPABASE_SECRET}", "supabase_secret"),
        (ASSIGNED, "assigned_secret"),
        (f"cnpj {CNPJ_VALID}", "cnpj"),
        (f"cnpj={CNPJ_VALID_BARE}", "cnpj"),
        (f"cpf {CPF_VALID}", "cpf"),
    ],
)
def test_A06_detects_secret_and_document_patterns(text: str, kind: str) -> None:
    assert kind in kinds("apps/web/lib/x.ts", text)


@pytest.mark.parametrize(
    "text",
    [
        "00.000.000/0000-00",  # placeholder drawn in design/
        "11.222.333/0001-82",  # wrong check digit
        "111.111.111-11",  # repeated digits are invalid documents
        "token_hash text not null",
        "const apiKey = process.env.ASAAS_API_KEY",
        'ASAAS_API_KEY=""',
        'secret: "<set in Vercel>"',
        's3_secret_key = "env(S3_SECRET_KEY_2)"',  # Supabase config env substitution
        'password = "changeme-placeholder-value"',
        "created_at 20261030123456",  # 14 digits, invalid CNPJ check digits
    ],
)
def test_A06_ignores_placeholders_and_invalid_documents(text: str) -> None:
    assert kinds("apps/web/lib/x.ts", text) == []


def test_A06_fixtures_may_hold_documents_but_not_keys() -> None:
    assert kinds("fixtures/ifood/orders.json", f"cnpj {CNPJ_VALID}") == []
    assert kinds("fixtures/ifood/orders.json", f"k={ANTHROPIC}") == ["anthropic_key"]


def test_A06_env_files_are_findings_without_reading_them(tmp_path: Path) -> None:
    env = tmp_path / ".env.local"
    env.write_text("X=1\n")
    env.chmod(0)  # unreadable: the scanner must not open it
    try:
        findings = secret_scan.scan_paths(tmp_path, [Path(".env.local")])
    finally:
        env.chmod(0o600)
    assert [f.kind for f in findings] == ["env_file"]


def test_A06_env_example_with_empty_values_is_allowed(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text("ASAAS_API_KEY=\nIFOOD_CLIENT_ID=\n")
    assert secret_scan.scan_paths(tmp_path, [Path(".env.example")]) == []


def test_A06_finding_never_prints_the_value(tmp_path: Path) -> None:
    (tmp_path / "log.txt").write_text(f"call ok auth={ANTHROPIC}\n")
    out = subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(tmp_path), "log.txt"],
        capture_output=True,
        text=True,
    )
    assert out.returncode == 1
    assert "log.txt:1: anthropic_key" in out.stdout
    assert ANTHROPIC not in out.stdout + out.stderr


def test_A06_scans_directories_of_logs_and_responses(tmp_path: Path) -> None:
    resp = tmp_path / "artifacts" / "responses"
    resp.mkdir(parents=True)
    (resp / "c14.html").write_text(f"<td>{SUPABASE_SECRET}</td>")
    (resp / "ok.html").write_text("<td>set</td>")
    findings = secret_scan.scan_paths(tmp_path, [Path("artifacts/responses")])
    assert [(f.path, f.kind) for f in findings] == [("artifacts/responses/c14.html", "supabase_secret")]


def test_A06_clean_tree_exits_zero(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("export const x = 1\n")
    out = subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(tmp_path), "a.ts"],
        capture_output=True,
        text=True,
    )
    assert out.returncode == 0, out.stdout
