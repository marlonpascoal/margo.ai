"""B01 (seed side): the G-SYN X-ray seed is exactly what the generator writes, and the generator's own
checks of the drawn numbers (C03 to C06, P01) pass on rows derived by the worker's functions."""

import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("gen_g_syn_m1", Path(__file__).resolve().parents[1] / "gen_g_syn_m1.py")
gen = importlib.util.module_from_spec(_spec)
sys.modules["gen_g_syn_m1"] = gen  # dataclasses look their module up
_spec.loader.exec_module(gen)


def test_B01_seed_file_matches_the_generator_and_the_drawings():
    assert gen.main(["--check"]) == 0


def test_B01_seed_is_synthetic_and_has_no_em_dash():
    sql = gen.build().sql
    assert "—" not in sql
    assert "Synthetic (D46)" in sql
