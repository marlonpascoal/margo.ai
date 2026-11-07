"""B01 from extraction copies (docs/extract-api.md, D47b): C02 queues a discovery instead of reading pages, and
the neighborhood builds from the applied copies. Memory repository; the database side is
test_b01_extract_db.py and supabase/tests/m1/m1_extract.test.sql."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from margo_collector.ifood_public import ParsedItem, ParsedStore
from margo_collector.repo import MemoryXrayRepo
from margo_collector.rules import (
    Item,
    Settings,
    Store,
    candidate_m1_02,
    neighborhood_m1_01,
    pair_item_m1_04,
)
from margo_collector.steps import (
    Discovered,
    ExtractionOff,
    XrayRun,
    calc_step,
    collect_step,
    neighborhood_job_step,
    neighborhood_step,
    pair_step,
)

NOW = datetime(2026, 11, 7, 13, 0, tzinfo=UTC)
TARGET = Store("t", "Alvo", "Lanches", Decimal("-23.33"), Decimal("-51.15"))


def near(sid: str, km_north: float) -> Store:
    return Store(sid, sid, "Lanches", Decimal(str(round(-23.33 + km_north / 111.19508, 6))), Decimal("-51.15"))


def bare(sid: str) -> Store:
    return Store(sid, sid, "Lanches", None, None)


def test_B01_M1_01_uses_the_discovery_distance_when_coordinates_are_missing():
    found = neighborhood_m1_01(TARGET, [bare("a"), bare("b"), bare("sem-dado")], 3, {"a": 1200, "b": 3400})
    assert [(s.id, d) for s, d in found] == [("a", 1200)]


def test_B01_M1_01_haversine_stays_when_both_have_coordinates():
    found = neighborhood_m1_01(TARGET, [near("a", 1.0)], 3, {"a": 2900})
    assert found[0][1] == 1000


def test_B01_M1_01_target_without_coordinates_works_from_the_discovery():
    found = neighborhood_m1_01(bare("t"), [near("a", 1.0)], 3, {"a": 800})
    assert found[0][1] == 800
    with pytest.raises(ValueError, match="M1-01"):
        neighborhood_m1_01(bare("t"), [near("a", 1.0)], 3)


def test_B01_M1_02_candidate_when_terms_intersect_ignoring_case_and_accents():
    assert candidate_m1_02(["Hambúrguer", "PASTEIS"], ["hamburguer"])
    assert candidate_m1_02(["PASTEIS"], ["PASTEIS", "PIZZA"])
    assert not candidate_m1_02(["PASTEIS"], ["SUSHI"])


def test_B01_M1_02_no_terms_says_nothing_and_the_store_stays():
    assert candidate_m1_02([], ["SUSHI"])
    assert candidate_m1_02(["PASTEIS"], [])


def item(iid: str, store: str, name: str, cents: int, level2: str | None = None, level1: str | None = None) -> Item:
    return Item(iid, store, name, cents, "un", None, level1, level2)


FIVE = Settings(min_pairs=1)


def test_B01_M1_04_taxonomy_filters_before_the_name():
    own = item("o", "t", "Pastel de carne", 1000, "PASTEIS")
    same = item("c1", "s", "Pastel de carne", 1100, "PASTEIS")
    other = item("c2", "s", "Pastel de carne", 900, "DOCES")
    got = pair_item_m1_04(own, [same, other], FIVE)
    assert [c.item.id for c in got.candidates] == ["c1"]


def test_B01_M1_04_falls_back_to_level_1_and_without_taxonomy_is_unchanged():
    own = item("o", "t", "Pastel de carne", 1000, None, "SALGADOS")
    assert [c.item.id for c in pair_item_m1_04(own, [item("c1", "s", "Pastel de carne", 1, None, "DOCES")], FIVE).candidates] == []
    assert [c.item.id for c in pair_item_m1_04(own, [item("c2", "s", "Pastel de carne", 1)], FIVE).candidates] == ["c2"]
    plain = item("p", "t", "Gigante da casa", 1000)
    assert [c.item.id for c in pair_item_m1_04(plain, [item("c3", "s", "Gigante da casa", 1, "PASTEIS")], FIVE).candidates] == ["c3"]


def setup_repo() -> MemoryXrayRepo:
    repo = MemoryXrayRepo()
    tid = repo.save_public_store(
        ParsedStore("t", "https://exemplo.test/t", "Alvo", None, "Lanches", Decimal("-23.33"), Decimal("-51.15"), None)
    )
    repo.xrays["x"] = XrayRun("x", None, tid, "https://exemplo.test/t", 3, ["Lanches"], {}, NOW)
    return repo


def add(repo: MemoryXrayRepo, ext: str, *, price: int = 1000) -> str:
    return repo.save_public_store(
        ParsedStore(ext, f"https://exemplo.test/{ext}", ext, None, "Lanches", None, None, None,
                    items=(ParsedItem("1", "Sundae", price),))
    )


def test_B01_collect_queues_the_discovery_and_reads_no_page():
    repo = setup_repo()
    assert collect_step(repo, "x", "sandbox") == {"queued": 1}
    assert repo.queued == [("extract_discover", "x")]


def test_B01_A05_collect_with_the_extraction_flag_off_fails_with_its_name():
    repo = setup_repo()
    repo.extraction_on = False
    with pytest.raises(ExtractionOff):
        collect_step(repo, "x", "sandbox")
    assert repo.queued == []


def test_B01_neighborhood_from_copies_excludes_other_categories_and_queues_captures_once():
    repo = setup_repo()
    a, b, far = add(repo, "a"), add(repo, "b"), add(repo, "longe")
    repo.discoveries["x"] = {
        a: Discovered(800, ("Lanches",)),
        b: Discovered(1500, ("Sushi",)),
        far: Discovered(9000, ("Lanches",)),
    }
    out = neighborhood_job_step(repo, "x", "sandbox", queue_captures=True)
    assert out == {"stores": 2, "in_set": 1, "captures": 2}
    rows = {r.public_store_id: r for r in repo.hood["x"]}
    assert rows[a].distance_m == 800 and rows[a].included
    assert rows[b].exclusion_reason == "regra: outra categoria"
    assert repo.queued == [("extract_capture", repo.xrays["x"].target_store_id), ("extract_capture", a)]
    assert neighborhood_job_step(repo, "x", "sandbox", queue_captures=False)["captures"] == 0


def test_B01_neighborhood_keeps_manual_choices_and_toggles():
    repo = setup_repo()
    a = add(repo, "a")
    repo.discoveries["x"] = {a: Discovered(800, ("Sushi",))}
    neighborhood_step(repo, "x")
    repo.hood["x"] = [replace(repo.hood["x"][0], included=True, exclusion_reason="manual")]
    neighborhood_step(repo, "x")
    assert repo.hood["x"][0].included and repo.hood["x"][0].exclusion_reason == "manual"


def test_B01_history_a_later_run_keeps_the_first_runs_prices():
    repo = setup_repo()
    a = add(repo, "a")
    repo.discoveries["x"] = {a: Discovered(800, ())}
    neighborhood_step(repo, "x")
    pair_step(repo, "x")
    calc_step(repo, "x")
    first = dict(repo.price_snapshots["x"])
    assert set(first.values()) == {1000}
    add(repo, "a", price=1200)
    repo.xrays["y"] = replace(repo.xrays["x"], id="y")
    repo.discoveries["y"] = repo.discoveries["x"]
    neighborhood_step(repo, "y")
    pair_step(repo, "y")
    calc_step(repo, "y")
    assert repo.price_snapshots["x"] == first
    assert set(repo.price_snapshots["y"].values()) == {1200}




def add_near(repo: MemoryXrayRepo, ext: str) -> str:
    return repo.save_public_store(
        ParsedStore(ext, f"https://exemplo.test/{ext}", ext, None, "Lanches", Decimal("-23.331"), Decimal("-51.151"), None)
    )


def test_B01_M1_01_with_a_discovery_a_store_it_did_not_find_is_no_neighbor():
    repo = setup_repo()
    found, other = add_near(repo, "achada"), add_near(repo, "outra-execucao")
    repo.discoveries["x"] = {found: Discovered(800, ("Lanches",))}
    neighborhood_job_step(repo, "x", "sandbox", queue_captures=True)
    assert [r.public_store_id for r in repo.hood["x"]] == [found]
    assert ("extract_capture", other) not in repo.queued


def test_B01_M1_01_without_a_discovery_the_catalog_by_coordinates_still_counts():
    repo = setup_repo()
    near_store = add_near(repo, "seed")
    neighborhood_step(repo, "x")
    assert [r.public_store_id for r in repo.hood["x"]] == [near_store]
