"""99Food Excel statement (06 §3, D10): parsed through a column_mapping; the payout total must match.

The layouts shipped (`gsyn-sintetico-v1`, and the changed one mapped in C17) are synthetic; real ones
arrive as new mappings (fixtures/m2/README.md).
"""

from __future__ import annotations

from .layout import Mapping_, Parsed, apply, read_table

CHANNEL = "food99"
JOB_TYPE = "import_99food_file"


def parse(data: bytes, file_name: str, mapping: Mapping_) -> Parsed:
    return apply(read_table(data, file_name), mapping)
