"""Shared G-SYN facts for the C03 tests: the September statements as margo_import.close sees them."""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path
from typing import Any

import pytest

GENERATOR = Path(__file__).resolve().parents[3] / "fixtures" / "m2" / "generate.py"


def _generator() -> Any:
    spec = importlib.util.spec_from_file_location("gsyn_generate", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def gsyn_months() -> list[Any]:
    """StoreMonth per G-02 store for September, parsed from the committed fixture files."""
    gen = _generator()
    from margo_import.layout import apply, read_table

    ifood = apply(read_table((gen.OUT / gen.IFOOD_CSV).read_bytes(), gen.IFOOD_CSV), gen.IFOOD_MAPPING)
    f99 = apply(read_table((gen.OUT / gen.F99_V1).read_bytes(), gen.F99_V1), gen.F99_MAPPING)
    return gen.as_store_month([ifood, f99], date(2026, 9, 1))
