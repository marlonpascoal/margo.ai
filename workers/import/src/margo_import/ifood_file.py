"""iFood Partner Portal export file (06 §2, D08, D45): same canonical output as the future API adapter.

The layout is a column_mapping. The one shipped is `gsyn-sintetico-v1`, synthetic: the real
reconciliation and sales report layouts are mapped in C17 once Marlon provides an anonymized sample
(fixtures/m2/README.md). The rows produced are order_fact, order_item_fact and ledger_entry.
"""

from __future__ import annotations

from .layout import Mapping_, Parsed, apply, read_table

CHANNEL = "ifood"
JOB_TYPE = "import_ifood_file"


def parse(data: bytes, file_name: str, mapping: Mapping_) -> Parsed:
    return apply(read_table(data, file_name), mapping)
