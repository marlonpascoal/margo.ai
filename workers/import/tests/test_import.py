"""C01, C02, C03, C06: the G-SYN statements through the parsers, the close and the import run.

Pure tests read the synthetic files in fixtures/m2. With MARGO_DB_TESTS=1 the same files go through
process_run against the seeded local stack, inside a transaction that is rolled back.
"""

from __future__ import annotations

import os
from collections import Counter
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest
from margo_import import food99_file, ifood_file
from margo_import.layout import (
    SAO_PAULO,
    LayoutError,
    Mapping_,
    apply,
    propose,
    read_table,
    signature,
    to_cents,
)
from margo_import.process import authorization_refusal
from margo_import.synthetic_layouts import (
    F99_MAPPING,
    F99_NEW,
    F99_V2_MAPPING,
    IFOOD_MAPPING,
)

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "m2"
IFOOD = "ifood-conciliacao-set2026-SINTETICO.csv"
F99_V1 = "99food-extrato-set2026-SINTETICO-v1.xlsx"
F99_V2 = "99food-extrato-set2026-SINTETICO.xlsx"
F99_OCT = "99food-extrato-out2026-SINTETICO.xlsx"
DB_TESTS = bool(os.environ.get("MARGO_DB_TESTS"))


def data(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


# C01: canonical rows -----------------------------------------------------------------------------


def test_C01_ifood_export_file_to_canonical_rows() -> None:
    p = ifood_file.parse(data(IFOOD), IFOOD, IFOOD_MAPPING)
    statuses = Counter(o.status for o in p.orders.values())
    assert statuses == {"concluido": 1540, "cancelado": 12}
    assert p.payout_total_file_cents == p.payout_total_mapped_cents == 6_882_900
    concluded = [o for o in p.orders.values() if o.status == "concluido"]
    assert sum(o.gross_cents for o in concluded) == 9_240_000
    assert {e.type for e in p.entries.values()} == {
        "commission",
        "payment_fee",
        "delivery",
        "promotion",
        "anticipation",
        "payout",
    }
    assert all(o.gross_cents == o.items_cents + o.delivery_fee_cents for o in p.orders.values())


def test_C01_99food_statement_to_canonical_rows() -> None:
    p = food99_file.parse(data(F99_V1), F99_V1, F99_MAPPING)
    assert p.rows_in_file == 1022, "two installments per order, as the C17 drawing counts"
    assert len(p.orders) == 516 + 5 + 1, (
        "September orders, five cancelled, one August order paid in September"
    )
    assert p.payout_total_file_cents == p.payout_total_mapped_cents == 1_447_100
    assert sum(1 for e in p.entries.values() if e.type == "payout") == 1016


def test_C01_both_layouts_of_the_99food_statement_give_the_same_rows() -> None:
    v1 = food99_file.parse(data(F99_V1), F99_V1, F99_MAPPING)
    v2 = food99_file.parse(data(F99_V2), F99_V2, F99_V2_MAPPING)
    assert set(v1.entries) == set(v2.entries)
    assert set(v1.orders) == set(v2.orders)


def test_C01_a_row_repeated_in_one_file_counts_once() -> None:
    table = read_table(data(IFOOD), IFOOD)
    table.rows = table.rows + table.rows[:10]
    p = apply(table, IFOOD_MAPPING)
    assert len(p.orders) == 1552
    assert p.payout_total_file_cents != p.payout_total_mapped_cents, "the payout check catches the repetition"


def test_C01_file_is_labeled_sintetico_and_header_found_below_it() -> None:
    t = read_table(data(F99_V2), F99_V2)
    assert t.preamble and t.preamble[0].startswith("SINTÉTICO")
    assert t.headers[:3] == ["Data do pedido", "ID da loja", "ID do pedido"]
    with pytest.raises(LayoutError):
        read_table(b"so,uma\n", "x.csv")


def test_money_and_layout_signature() -> None:
    assert to_cents("1.234,56") == 123_456
    assert to_cents("-3,32") == -332
    assert to_cents(36.9) == 3690
    assert to_cents("−1.088") == -108_800
    assert signature(["Valor dos itens", "ID"]) == signature([" valor  dos ITENS", "id"])


# C02 (worker side): a changed layout is proposed for C17 --------------------------------------------


def test_C02_changed_99food_layout_needs_mapping_with_a_proposal() -> None:
    t = read_table(data(F99_V2), F99_V2)
    assert signature(t.headers) != signature(list(F99_MAPPING.columns))
    proposal, statuses, _ = propose(t.headers, [F99_MAPPING])
    assert [s.name for s in statuses if not s.known] == F99_NEW
    p = apply(t, proposal)
    assert p.payout_total_file_cents == p.payout_total_mapped_cents == 1_447_100, "C17 'bate' before saving"


# C03: close and differences of the seed ---------------------------------------------------------------


def test_C03_close_and_differences_of_gsyn_september(gsyn_months: list[Any]) -> None:
    from margo_import.close import compute_close
    from margo_import.rules import Params

    result = compute_close(gsyn_months, Params(), date(2026, 10, 30))
    channel = {"s1": "ifood", "s2": "ifood", "s4": "ifood", "s3": "food99", "s5": "food99"}
    totals: dict[str, Counter[str]] = {}
    for line in result.lines:
        c = totals.setdefault(channel[line.store_id], Counter())
        for k in ("gross", "commission", "payment", "delivery", "promotion", "anticipation", "payout"):
            c[k] += getattr(line, f"{k}_cents")
    # C08 as drawn.
    assert dict(totals["ifood"]) == dict(
        gross=9_240_000,
        commission=-1_108_800,
        payment=-295_700,
        delivery=-462_000,
        promotion=-369_600,
        anticipation=-121_000,
        payout=6_882_900,
    )
    assert dict(totals["food99"]) == dict(
        gross=1_860_000,
        commission=-167_400,
        payment=-59_500,
        delivery=-130_200,
        promotion=-55_800,
        anticipation=0,
        payout=1_447_100,
    )
    # C09 as drawn: rule, what happened, channel, orders, value, confidence.
    rows = sorted(
        (x.rule_id, x.description, channel[x.store_id], x.orders_count, x.amount_cents, x.confidence)
        for x in result.findings
    )
    assert rows == sorted(
        [
            ("DIF-01", "Comissão de 15% onde o contrato diz 12%", "ifood", 214, 41_200, "certa"),
            ("DIF-02", "Cancelamento pelo cliente cobrado da loja", "ifood", 9, 23_800, "certa"),
            ("DIF-03", "Cupom cofinanciado debitado inteiro da loja", "ifood", 31, 18_600, "certa"),
            ("DIF-02", "Cancelamento por atraso do entregador", "food99", 5, 12_000, "certa"),
            ("DIF-03", "Promoção da semana sem acordo registrado", "ifood", 22, 14_800, "provavel"),
            ("DIF-04", "Repasse da semana 37 menor que a apuração", "food99", 1, 8_000, "provavel"),
        ]
    )
    assert result.shown == {"DIF-01", "DIF-02", "DIF-03", "DIF-04"}


def test_C03_claim_text_of_the_cofunded_coupon_is_the_drawn_one(gsyn_months: list[Any]) -> None:
    from margo_import.claims import claim_text
    from margo_import.close import compute_close
    from margo_import.rules import Params

    result = compute_close(gsyn_months, Params(), date(2026, 10, 30))
    [x] = [f for f in result.findings if f.rule_id == "DIF-03" and f.confidence == "certa"]
    assert claim_text(x, date(2026, 9, 1), "ifood") == (
        "Em setembro, 31 pedidos com o cupom da campanha de 20% tiveram o desconto debitado inteiro da loja. "
        "Pelo acordo da campanha, o iFood cofinancia metade. Diferença: R$ 186,00. Segue planilha com os pedidos."
    )


# C06 ------------------------------------------------------------------------------------------------


def test_C06_real_file_refused_without_owner_authorization() -> None:
    from margo_import.db import StoreRef

    refs = {
        "a": StoreRef("1", "co1", True),
        "b": StoreRef("2", "co2", False),
        "c": StoreRef("3", None, False),
    }
    assert authorization_refusal(False, {"a"}, refs, set(), {"12345678000110"}) is None
    assert authorization_refusal(False, {"a", "b"}, refs, set(), set()) == 1, "a CNPJ without authorization"
    assert authorization_refusal(False, {"c"}, refs, set(), set()) == 1, "a store without kitchen has no CNPJ"
    assert authorization_refusal(False, {"a"}, refs, {"99999999000199"}, {"12345678000110"}) == 1
    assert authorization_refusal(True, {"a", "b", "c"}, refs, set(), set()) is None, "G-SYN is synthetic"


# Against the seeded local stack ---------------------------------------------------------------------

pytestmark_db = pytest.mark.skipif(not DB_TESTS, reason="MARGO_DB_TESTS=1 runs it against the local stack")


@pytest.fixture
def conn() -> Iterator[Any]:
    import psycopg
    from margo_import import db

    c = db.connect()
    try:
        with c.transaction():
            yield c
            raise psycopg.Rollback()
    finally:
        c.close()


def new_run(conn: Any, channel: str, path: str, name: str, account: str = "G-02") -> str:
    return str(
        conn.execute(
            """insert into public.import_run (account_id, trigger, channel, file_path, file_name)
           select id, 'upload', %s, %s, %s from public.account where code = %s returning id""",
            (channel, path, name, account),
        ).fetchone()["id"]
    )


def run_status(conn: Any, run_id: str) -> dict[str, Any]:
    return conn.execute("select * from public.import_run where id = %s", (run_id,)).fetchone()


def snapshot(conn: Any) -> tuple[list[Any], list[Any]]:
    lines = conn.execute(
        """select channel_store_id, gross_cents, commission_cents, payment_cents, delivery_cents, promotion_cents,
                  anticipation_cents, payout_cents from public.close_line cl join public.close_period cp on cp.id = cl.close_period_id
           join public.account a on a.id = cp.account_id where a.code = 'G-02' and cp.month = '2026-09-01' order by 1"""
    ).fetchall()
    diffs = conn.execute(
        """select d.channel_store_id, d.finding_key, d.description, d.orders_count, d.amount_cents, d.confidence, d.shown,
                  (select array_agg(order_fact_id order by order_fact_id) from public.difference_order o where o.difference_id = d.id)
           from public.difference d join public.account a on a.id = d.account_id where a.code = 'G-02' order by 1, 2"""
    ).fetchall()
    return [tuple(r.values()) for r in lines], [tuple(r.values()) for r in diffs]


@pytestmark_db
def test_C01_reimport_of_the_seeded_statements_adds_zero_rows(conn: Any) -> None:
    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    files = MemoryFileStore({"imports/t/ifood.csv": data(IFOOD), "imports/t/99.xlsx": data(F99_V1)})
    before = snapshot(conn)
    for channel, path, name in (
        ("ifood", "imports/t/ifood.csv", IFOOD),
        ("food99", "imports/t/99.xlsx", F99_V1),
    ):
        run = new_run(conn, channel, path, name)
        assert process_run(conn, files, run, channel).status == "ok"
        r = run_status(conn, run)
        assert (r["rows_new"], r["rows_duplicate"]) == (0, r["rows_total"]), (
            "every row is a duplicate of the seed"
        )
    assert snapshot(conn) == before, "recomputing the close from the same rows changes nothing (C03)"


@pytestmark_db
def test_C01_C03_import_from_empty_rebuilds_the_seeded_close(conn: Any) -> None:
    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    before = snapshot(conn)
    conn.execute(
        "delete from public.contestation where account_id = (select id from public.account where code = 'G-02')"
    )
    conn.execute(
        "delete from public.difference where account_id = (select id from public.account where code = 'G-02')"
    )
    conn.execute(
        "delete from public.ledger_entry where account_id = (select id from public.account where code = 'G-02')"
    )
    conn.execute(
        "delete from public.order_fact where account_id = (select id from public.account where code = 'G-02')"
    )
    files = MemoryFileStore({"imports/t/ifood.csv": data(IFOOD), "imports/t/99.xlsx": data(F99_V2)})
    conn.execute(
        "insert into public.column_mapping (channel, file_signature, name, mapping) values ('food99', %s, 'v2', %s)",
        (
            signature(read_table(data(F99_V2), F99_V2).headers),
            __import__("json").dumps(F99_V2_MAPPING.to_json()),
        ),
    )
    for channel, path, name in (
        ("ifood", "imports/t/ifood.csv", IFOOD),
        ("food99", "imports/t/99.xlsx", F99_V2),
    ):
        run = new_run(conn, channel, path, name)
        # On 20/out, before the default deadlines (30 days from the last order) pass.
        now = datetime(2026, 10, 20, 12, tzinfo=SAO_PAULO)
        assert process_run(conn, files, run, channel, now).status == "ok"
        r = run_status(conn, run)
        assert r["rows_new"] == r["rows_total"] and r["rows_duplicate"] == 0
    lines, diffs = snapshot(conn)
    assert lines == before[0]
    # The differences are found again; their ids and order lists come from the new rows.
    assert [d[:7] for d in diffs] == [d[:7] for d in before[1]]
    statuses = Counter(
        r["status"]
        for r in conn.execute(
            "select status::text from public.contestation c join public.account a on a.id = c.account_id where a.code = 'G-02'"
        ).fetchall()
    )
    assert statuses == {"a_contestar": 4, "precisa_resposta": 1}, "certa and provável start as 04 §3 says"


@pytestmark_db
def test_C02_changed_layout_needs_mapping_then_imports_and_the_next_file_imports_alone(conn: Any) -> None:
    import json

    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    files = MemoryFileStore({"imports/t/set.xlsx": data(F99_V2), "imports/t/out.xlsx": data(F99_OCT)})
    run = new_run(conn, "food99", "imports/t/set.xlsx", F99_V2)
    assert process_run(conn, files, run, "food99").status == "needs_mapping"
    r = run_status(conn, run)
    assert [c["name"] for c in r["log"]["columns"] if not c["known"]] == F99_NEW
    assert r["log"]["payout_total_file_cents"] == r["log"]["payout_total_mapped_cents"] == 1_447_100
    # C17 saves the mapping for that signature and requeues the run.
    conn.execute(
        "insert into public.column_mapping (channel, file_signature, name, mapping) values ('food99', %s, 'c17', %s)",
        (r["log"]["signature"], json.dumps(F99_V2_MAPPING.to_json())),
    )
    assert process_run(conn, files, run, "food99").status == "ok"
    r = run_status(conn, run)
    assert (r["rows_new"], r["rows_duplicate"]) == (0, 1022), "same September rows as the seed"
    nxt = new_run(conn, "food99", "imports/t/out.xlsx", F99_OCT)
    assert process_run(conn, files, nxt, "food99").status == "ok", (
        "the next file with the layout imports alone"
    )
    assert run_status(conn, nxt)["rows_new"] == run_status(conn, nxt)["rows_total"] > 0


@pytestmark_db
def test_C02_payout_total_mismatch_fails_the_run(conn: Any) -> None:
    import json

    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    files = MemoryFileStore({"imports/t/set.xlsx": data(F99_V2)})
    sig = signature(read_table(data(F99_V2), F99_V2).headers)
    wrong = Mapping_({**F99_V2_MAPPING.columns, "ID da transação": "ignorar", "Repasse dividido": "ignorar"})
    conn.execute(
        "insert into public.column_mapping (channel, file_signature, name, mapping) values ('food99', %s, 'x', %s)",
        (sig, json.dumps(wrong.to_json())),
    )
    run = new_run(conn, "food99", "imports/t/set.xlsx", F99_V2)
    out = process_run(conn, files, run, "food99")
    assert (out.status, out.reason) == ("failed", "payout_total_mismatch")


@pytestmark_db
def test_C06_real_file_refused_when_its_cnpj_has_no_authorization(conn: Any) -> None:
    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    conn.execute("update public.account set is_synthetic = false where code = 'G-02'")
    conn.execute(
        "delete from public.owner_authorization where account_id = (select id from public.account where code = 'G-02')"
    )
    files = MemoryFileStore({"imports/t/ifood.csv": data(IFOOD)})
    run = new_run(conn, "ifood", "imports/t/ifood.csv", IFOOD)
    out = process_run(conn, files, run, "ifood")
    assert (out.status, out.reason) == ("failed", "no_owner_authorization")
    assert run_status(conn, run)["rows_new"] is None, "nothing was written"


@pytestmark_db
def test_E02_run_of_a_paused_source_is_skipped_and_writes_nothing(conn: Any) -> None:
    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    files = MemoryFileStore({"imports/t/ifood.csv": data(IFOOD)})
    source = conn.execute(
        """insert into public.import_source (account_id, channel, kind, paused_at, paused_reason)
           select id, 'ifood', 'upload', now(), 'trial_ended' from public.account where code = 'G-02'
           on conflict (account_id, channel, kind) do update set paused_at = now(), paused_reason = 'trial_ended'
           returning id"""
    ).fetchone()["id"]
    run = new_run(conn, "ifood", "imports/t/ifood.csv", IFOOD)
    conn.execute("update public.import_run set source_id = %s where id = %s", (source, run))
    out = process_run(conn, files, run, "ifood")
    assert (out.status, out.reason) == ("failed", "source_paused")
    assert run_status(conn, run)["rows_new"] is None, "nothing was written"

    # 04 §7: resuming the source (a plan was chosen) lets the same run through.
    conn.execute(
        "update public.import_source set paused_at = null, paused_reason = null where id = %s", (source,)
    )
    run2 = new_run(conn, "ifood", "imports/t/ifood.csv", IFOOD)
    conn.execute("update public.import_run set source_id = %s where id = %s", (source, run2))
    assert process_run(conn, files, run2, "ifood").status == "ok"


@pytestmark_db
def test_E02_run_without_source_is_skipped_while_the_account_is_paused(conn: Any) -> None:
    from margo_common.files import MemoryFileStore
    from margo_import.process import process_run

    files = MemoryFileStore({"imports/t/ifood.csv": data(IFOOD)})
    conn.execute(
        """insert into public.import_source (account_id, channel, kind, paused_at, paused_reason)
           select id, 'ifood', 'extension', now(), 'trial_ended' from public.account where code = 'G-02'
           on conflict (account_id, channel, kind) do update set paused_at = now(), paused_reason = 'trial_ended'"""
    )
    run = new_run(conn, "ifood", "imports/t/ifood.csv", IFOOD)
    out = process_run(conn, files, run, "ifood")
    assert (out.status, out.reason) == ("failed", "source_paused")
