"""D02 and D14: GTIN, rules, AI suggestions behind a fake Suggester, and confirmation (C11).

No test calls the Claude API or replays an invented answer (06, D40): the AI step is the `Suggester`
interface and the tests implement it. With MARGO_DB_TESTS=1 the database tests run against the seeded
local stack inside a transaction that is rolled back.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator, Sequence
from decimal import Decimal
from typing import Any

import pytest
from margo_match.ai import (
    DEFAULT_MODEL,
    AiLine,
    ClaudeSuggester,
    Suggestion,
    build_request,
    supplier_for_prompt,
    unit_price_text,
    validate,
)
from margo_match.matching import (
    CatalogItem,
    LineIn,
    Rule,
    auto_match,
    conversion_factor,
    learned_rule,
    normalize,
    price_per_base_unit,
)

DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))

CATALOG = [
    CatalogItem("carne", "Carne bovina moída (blend)", "carnes", "g"),
    CatalogItem("refri", "Refrigerante lata 350 ml", "bebidas", "un", frozenset({"2000000001014"})),
    CatalogItem("batata", "Batata congelada palito", "congelados", "g"),
    CatalogItem("cheddar", "Queijo cheddar fatiado", "laticínios", "g"),
    CatalogItem("brioche", "Pão brioche", "padaria", "un"),
]
RULES = [
    Rule("r1", "carne", ("CARNE", "MOIDA"), "0201"),
    Rule("r2", "batata", ("BAT", "PALITO"), None, "PC"),
]


def line(desc: str, unit: str, ncm: str | None = None, gtin: str | None = None, id_: str = "l1") -> LineIn:
    return LineIn(id_, desc, ncm, gtin, unit)


# D14 steps 1 and 2 ------------------------------------------------------------------------------------


def test_D14_gtin_first_then_rules() -> None:
    m = auto_match(line("REFRIG COCA COLA LT 350ML", "UN", "22021000", "2000000001014"), CATALOG, RULES)
    assert m and (m.ingredient_id, m.method, m.conversion_factor) == ("refri", "gtin", 1)
    m = auto_match(line("CARNE BOV MOIDA PATINHO/ACEM 80/20 KG", "KG", "02013000"), CATALOG, RULES)
    assert m and (m.ingredient_id, m.method, m.rule_note, m.conversion_factor) == (
        "carne",
        "rule",
        "texto + NCM 0201",
        1000,
    )
    assert RULES[1].note == "texto + unidade"
    m = auto_match(line("BAT PRE FRITA CONG 2,5KG PALITO 9MM", "PC", "20041000"), CATALOG, RULES)
    assert m and (m.ingredient_id, m.conversion_factor) == ("batata", Decimal("2500"))
    assert auto_match(line("BAT PRE FRITA CONG 2,5KG PALITO 9MM", "CX", "20041000"), CATALOG, RULES) is None
    assert auto_match(line("CARNE MOIDA SUINA", "KG", "02032900"), CATALOG, RULES) is None, "NCM 0203 is pork"
    assert auto_match(line("QJO PROC CHED FAT 2,27KG 160FT", "PC", "04063000"), CATALOG, RULES) is None


def test_D14_conversion_from_unit_or_package() -> None:
    assert conversion_factor("QJO PROC CHED FAT 2,27KG 160FT", "PC", "g") == Decimal("2270")
    assert conversion_factor("PAO HAMB BRIOCHE GERG C/12", "PCT", "un") == 12
    assert conversion_factor("OLEO SOJA REFINADO PET 900ML", "UN", "ml") == 900
    assert conversion_factor("REFRIG COCA COLA LT 350ML", "UN", "un") == 1
    assert conversion_factor("MOLHO ESPECIAL", "BD", "g") is None


def test_D14_confirmation_teaches_the_next_client() -> None:
    rule = learned_rule("QJO PROC CHED FAT 2,27KG 160FT", "04063000", "pc", "cheddar")
    assert rule.keywords == ("CHED", "FAT", "PROC", "QJO"), "words only, no quantities"
    assert rule.ncm_prefix == "04063000" and rule.unit == "PC"
    other_client = line("QJO PROC CHED FAT 2,27KG 160FT", "PC", "04063000", id_="x")
    m = auto_match(other_client, CATALOG, [rule])
    assert m and (m.ingredient_id, m.method) == ("cheddar", "rule")


def test_D14_cst01_price_per_base_unit() -> None:
    # C11 drawn: QJO PROC CHED FAT 2,27KG at R$ 118,27 the piece is R$ 52,10/kg.
    p = price_per_base_unit(23654, Decimal(2), Decimal(2270))
    assert (p * 1000).quantize(Decimal(1)) == 5210


# D14 step 3: the AI behind the interface --------------------------------------------------------------


class FakeSuggester:
    """Implements Suggester; records what it was asked."""

    def __init__(self, answers: dict[str, str]) -> None:
        self.answers = answers
        self.asked: list[AiLine] = []

    def suggest(self, lines: Sequence[AiLine], catalog: Sequence[CatalogItem]) -> list[Suggestion]:
        self.asked.extend(lines)
        by_name = {c.name: c.id for c in catalog}
        return [
            Suggestion(li.ref, by_name[self.answers[li.description]], Decimal("0.9100"), None)
            for li in lines
            if self.answers.get(li.description) in by_name
        ]


def test_D02_D14_request_carries_supplier_item_unit_price_and_catalog_only() -> None:
    """06 §6 and D14 (Marlon, 31/out): supplier name, item, unit and price; no CNPJ, no restaurant, no person."""
    req = build_request(
        [
            AiLine(
                "0", "QJO PROC CHED FAT 2,27KG 160FT", "04063000", "PC", "Laticínios Exemplo", "118.27 R$/PC"
            )
        ],
        CATALOG,
        DEFAULT_MODEL,
    )
    assert req["model"] == "claude-sonnet-5-5"
    body = json.loads(req["messages"][0]["content"])
    assert set(body) == {"catalogo", "itens"}
    assert body["itens"][0] == {
        "ref": "0",
        "descricao": "QJO PROC CHED FAT 2,27KG 160FT",
        "ncm": "04063000",
        "unidade": "PC",
        "fornecedor": "Laticínios Exemplo",
        "preco_unitario": "118.27 R$/PC",
    }
    assert set(body["catalogo"][0]) == {"nome", "categoria", "unidade_base"}
    text = json.dumps(req, ensure_ascii=False)
    for forbidden in ("98765432000150", "12345678000100", "Pantanos", "cnpj", "CNPJ", "cpf", "CPF"):
        assert forbidden not in text
    assert "fornecedor" in req["system"] and "preço" in req["system"]
    assert req["output_config"]["format"]["type"] == "json_schema"


def test_D02_D14_line_without_supplier_or_price_sends_null() -> None:
    body = json.loads(
        build_request([AiLine("0", "LUVA DESCARTAVEL", None, "CX")], CATALOG, DEFAULT_MODEL)["messages"][0][
            "content"
        ]
    )
    assert body["itens"][0]["fornecedor"] is None and body["itens"][0]["preco_unitario"] is None


def test_D02_D14_supplier_name_only_for_a_company_issuer() -> None:
    assert supplier_for_prompt("90000002000183", "Laticínios Exemplo") == "Laticínios Exemplo"
    assert supplier_for_prompt("90000002000183", "  Laticínios   Exemplo ") == "Laticínios Exemplo"
    assert supplier_for_prompt("12345678900", "Maria Produtora") is None, "CPF issuer: a person, no name"
    assert supplier_for_prompt("90000002000183", "JOAO DA SILVA 12345678900") is None, (
        "MEI name carries a CPF"
    )
    assert supplier_for_prompt("90000002000183", "JOAO DA SILVA 123.456.789-00") is None
    assert supplier_for_prompt("90000002000183", None) is None
    assert supplier_for_prompt("90000002000183", "   ") is None


def test_D02_D14_unit_price_in_reais_from_centavos() -> None:
    assert unit_price_text(23654, Decimal(2), "PC") == "118.27 R$/PC"
    assert unit_price_text(38900, Decimal(10), "KG") == "38.90 R$/KG"
    assert unit_price_text(1000, Decimal(3), "KG") == "3.3333 R$/KG", (
        "total / qty keeps sub-centavo precision"
    )
    assert unit_price_text(2990, Decimal("1.5"), "kg") == "19.9333 R$/kg"
    assert unit_price_text(0, Decimal(1), "UN") == "0.00 R$/UN"
    assert unit_price_text(None, Decimal(1), "UN") is None
    assert unit_price_text(100, None, "UN") is None


def test_D02_D14_recorder_builds_the_worker_prompt() -> None:
    """`uv run record-anthropic` sends the same shape the worker sends (synthetic supplier and price)."""
    from margo_match import record

    body = json.loads(build_request(record.LINES, record.CATALOG, DEFAULT_MODEL)["messages"][0]["content"])
    assert all(
        set(it) == {"ref", "descricao", "ncm", "unidade", "fornecedor", "preco_unitario"}
        for it in body["itens"]
    )
    assert all(it["fornecedor"] and it["preco_unitario"] for it in body["itens"])
    assert all("Exemplo" in it["fornecedor"] for it in body["itens"]), "synthetic G-SYN suppliers only"


def test_D14_model_is_a_parameter(monkeypatch: pytest.MonkeyPatch) -> None:
    assert ClaudeSuggester(client=object()).model == DEFAULT_MODEL
    monkeypatch.setenv("MARGO_MATCH_MODEL", "outro-modelo")
    assert ClaudeSuggester(client=object()).model == "outro-modelo"
    assert ClaudeSuggester(client=object(), model="m").model == "m"


def test_D14_real_client_needs_the_key_by_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        ClaudeSuggester()


def test_D14_suggestions_are_validated_against_what_was_sent() -> None:
    items = [
        {
            "ref": "0",
            "ingredient": "Queijo cheddar fatiado",
            "confidence": 1.4,
            "base_units_per_invoice_unit": 2270,
        },
        {"ref": "0", "ingredient": "Pão brioche", "confidence": 0.5, "base_units_per_invoice_unit": None},
        {
            "ref": "1",
            "ingredient": "Insumo inventado",
            "confidence": 0.9,
            "base_units_per_invoice_unit": None,
        },
        {"ref": "9", "ingredient": "Pão brioche", "confidence": 0.9, "base_units_per_invoice_unit": None},
        {"ref": "2", "ingredient": None, "confidence": 0.0, "base_units_per_invoice_unit": None},
    ]
    out = validate(items, {"0", "1", "2"}, CATALOG)
    assert [(s.ref, s.ingredient_id, s.confidence, s.conversion_factor) for s in out] == [
        ("0", "cheddar", Decimal("1.0000"), Decimal("2270"))
    ]


def test_normalize() -> None:
    assert normalize("Pão  brioche c/12") == "PAO BRIOCHE C/12"


# Against the local stack (D02) ------------------------------------------------------------------------

pytestmark_db = pytest.mark.skipif(not DB_TESTS, reason="MARGO_DB_TESTS=1 runs it against the local stack")


@pytest.fixture
def conn() -> Iterator[Any]:
    import psycopg
    from margo_match import db

    c = db.connect()
    try:
        with c.transaction():
            yield c
            raise psycopg.Rollback()
    finally:
        c.close()


def _setup(
    conn: Any, issuer_cnpj: str = "12345678000100", issuer_name: str = "Laticínios Teste"
) -> dict[str, str]:
    """A small invoice of G-01 with three lines and a three-item catalog, all inside the test transaction."""
    acc = conn.execute(
        "select id, (select id from public.company where account_id = a.id) as co from public.account a where code = 'G-01'"
    ).fetchone()
    ids: dict[str, str] = {"account": str(acc["id"])}
    for name, cat, unit in (
        ("T Carne", "carnes", "g"),
        ("T Cheddar", "laticínios", "g"),
        ("T Brioche", "padaria", "un"),
    ):
        ids[name] = str(
            conn.execute(
                "insert into public.ingredient (name, category, base_unit) values (%s, %s, %s) returning id",
                (name, cat, unit),
            ).fetchone()["id"]
        )
    conn.execute(
        "insert into public.ingredient_rule (ingredient_id, keywords, ncm_prefix, source) values (%s, '{TCARNE,MOIDA}', '0201', 'catalog')",
        (ids["T Carne"],),
    )
    key = "4126101234567800019055001000001234112345678"
    key += "6"
    inv = conn.execute(
        """insert into public.invoice (account_id, company_id, access_key, model, issuer_cnpj, issuer_name, issued_at, total_cents, source)
           values (%s, %s, %s, 55, %s, %s, '2026-10-12 10:00-03', 50000, 'key_typed') returning id""",
        (acc["id"], acc["co"], key, issuer_cnpj, issuer_name),
    ).fetchone()["id"]
    for n, desc, ncm, unit, qty, total in (
        (1, "TCARNE BOV MOIDA KG", "02013000", "KG", 10, 38900),
        (2, "QJO PROC CHED FAT 2,27KG 160FT", "04063000", "PC", 2, 23654),
        (3, "LUVA DESCARTAVEL", "39262000", "CX", 1, 2990),
    ):
        ids[f"line{n}"] = str(
            conn.execute(
                """insert into public.invoice_line (account_id, invoice_id, line_no, description, ncm, unit, qty, unit_price_cents, total_cents)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                (acc["id"], inv, n, desc, ncm, unit, qty, total // qty, total),
            ).fetchone()["id"]
        )
    return ids


def _prices(conn: Any, account: str) -> list[tuple[Any, ...]]:
    return [
        tuple(r.values())
        for r in conn.execute(
            "select ingredient_id::text, price_per_base_unit_cents, invoice_line_id::text from public.ingredient_price where account_id = %s order by 3",
            (account,),
        ).fetchall()
    ]


@pytestmark_db
def test_D02_ai_suggestion_changes_no_price_until_a_person_confirms(conn: Any) -> None:
    from margo_match import db
    from margo_match.jobs import run_match

    ids = _setup(conn)
    acc = ids["account"]
    fake = FakeSuggester({"QJO PROC CHED FAT 2,27KG 160FT": "T Cheddar"})
    out = run_match(conn, acc, fake)
    assert out["auto_confirmed"] == 1, "TCARNE line by rule, confirmed with its price"
    assert out["ai_suggested"] == 1
    assert sorted(a.description for a in fake.asked) == ["LUVA DESCARTAVEL", "QJO PROC CHED FAT 2,27KG 160FT"]
    assert all("CNPJ" not in a.description for a in fake.asked)
    sent = {a.description: a for a in fake.asked}
    assert sent["QJO PROC CHED FAT 2,27KG 160FT"].supplier == "Laticínios Teste"
    assert sent["QJO PROC CHED FAT 2,27KG 160FT"].unit_price == "118.27 R$/PC"
    assert sent["LUVA DESCARTAVEL"].unit_price == "29.90 R$/CX"

    before = _prices(conn, acc)
    assert [p[2] for p in before] == [ids["line1"]], "only the rule match has a price"
    ai = conn.execute(
        "select id, status, method, confidence, conversion_factor from public.ingredient_match where invoice_line_id = %s",
        (ids["line2"],),
    ).fetchone()
    assert (ai["status"], ai["method"], ai["confidence"], ai["conversion_factor"]) == (
        "suggested",
        "ai",
        Decimal("0.9100"),
        Decimal("2270"),
    )

    # Running again asks nothing new and still writes no price.
    fake.asked.clear()
    run_match(conn, acc, fake)
    assert fake.asked == [] and _prices(conn, acc) == before

    # D14: an AI match needs a person.
    with pytest.raises(Exception, match="person_required"):
        with conn.transaction():
            conn.execute("select public.confirm_ingredient_match(%s, null, null)", (ai["id"],))
    assert _prices(conn, acc) == before

    person = conn.execute("select person_id from public.staff limit 1").fetchone()["person_id"]
    conn.execute("select public.confirm_ingredient_match(%s, %s, null)", (ai["id"], person))
    after = {p[2]: p for p in _prices(conn, acc)}
    assert set(after) == {ids["line1"], ids["line2"]}
    assert (after[ids["line2"]][1] * 1000).quantize(Decimal(1)) == 5210, "R$ 52,10/kg as drawn in C11"

    # D14: the confirmation is a rule now; another account's same line matches without AI.
    assert db.learn_rules(conn) >= 1
    rules = db.rules(conn)
    assert any(r.ingredient_id == ids["T Cheddar"] and r.ncm_prefix == "04063000" for r in rules)


@pytestmark_db
def test_D02_rejected_suggestion_writes_nothing_and_is_not_asked_again(conn: Any) -> None:
    from margo_match.jobs import run_match

    ids = _setup(conn)
    fake = FakeSuggester({"QJO PROC CHED FAT 2,27KG 160FT": "T Brioche"})
    run_match(conn, ids["account"], fake)
    conn.execute(
        "update public.ingredient_match set status = 'rejected' where invoice_line_id = %s", (ids["line2"],)
    )
    before = _prices(conn, ids["account"])
    fake.asked.clear()
    run_match(conn, ids["account"], fake)
    assert "QJO PROC CHED FAT 2,27KG 160FT" not in [a.description for a in fake.asked]
    assert _prices(conn, ids["account"]) == before


@pytestmark_db
def test_D02_cpf_issuer_sends_no_supplier_name_and_still_no_price_is_written(conn: Any) -> None:
    from margo_match.jobs import run_match

    ids = _setup(conn, issuer_cnpj="12345678900", issuer_name="Maria Produtora Rural")
    fake = FakeSuggester({"QJO PROC CHED FAT 2,27KG 160FT": "T Cheddar"})
    run_match(conn, ids["account"], fake)
    assert fake.asked and all(a.supplier is None for a in fake.asked)
    assert all("Maria" not in json.dumps(a.__dict__, ensure_ascii=False) for a in fake.asked)
    assert {a.unit_price for a in fake.asked} == {"118.27 R$/PC", "29.90 R$/CX"}
    assert [p[2] for p in _prices(conn, ids["account"])] == [ids["line1"]], "AI suggestion writes no price"
