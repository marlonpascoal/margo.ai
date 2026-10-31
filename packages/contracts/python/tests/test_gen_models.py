"""Pydantic models generated from the migrations (CLAUDE.md: the SQL migrations are the contract)."""

import os
from decimal import Decimal

import pytest
from margo_contracts import gen
from pydantic import ValidationError

COLUMNS = [
    # table, column, data_type, udt_name, is_nullable
    ("membership", "id", "uuid", "uuid", False),
    ("membership", "role", "USER-DEFINED", "member_role", False),
    ("membership", "all_kitchens", "boolean", "bool", False),
    ("pilot", "pct_months_1_2", "numeric", "numeric", True),
    ("pilot", "cap_cents", "bigint", "int8", True),
    ("pilot", "started_on", "date", "date", True),
    ("invite", "kitchen_ids", "ARRAY", "_uuid", False),
    ("invite", "expires_at", "timestamp with time zone", "timestamptz", False),
    ("job", "payload", "jsonb", "jsonb", False),
    ("audit_log", "ip", "inet", "inet", True),
    ("kitchen", "uf", "character", "bpchar", True),
]
ENUMS = {"member_role": ["dono", "financeiro", "gerente"]}


def test_render_maps_postgres_types_to_python() -> None:
    src = gen.render(COLUMNS, ENUMS)
    assert "class MemberRole(StrEnum):" in src
    assert '    DONO = "dono"' in src
    assert "class Membership(Row):" in src
    assert "    role: MemberRole\n" in src
    assert "    pct_months_1_2: Decimal | None\n" in src
    assert "    cap_cents: int | None\n" in src
    assert "    kitchen_ids: list[UUID]\n" in src
    assert "    expires_at: datetime\n" in src
    assert "    payload: JsonValue\n" in src
    assert "    uf: str | None\n" in src


def test_rendered_models_validate_rows() -> None:
    ns: dict = {}
    exec(gen.render(COLUMNS, ENUMS), ns)
    row = ns["Pilot"].model_validate(
        {"pct_months_1_2": "0.2000", "cap_cents": 100000, "started_on": None}
    )
    assert row.pct_months_1_2 == Decimal("0.2000")
    with pytest.raises(ValidationError):
        ns["Membership"].model_validate({"id": "x", "role": "chefe", "all_kitchens": True})


def test_rendered_output_is_deterministic() -> None:
    assert gen.render(COLUMNS, ENUMS) == gen.render(list(reversed(COLUMNS)), ENUMS)


@pytest.mark.skipif(not os.environ.get("MARGO_DB_TESTS"), reason="needs the local Supabase stack")
def test_committed_models_match_the_migrations() -> None:
    assert gen.generate(gen.LOCAL_DB_URL) == gen.MODELS_PATH.read_text(), "run: uv run gen-models"
