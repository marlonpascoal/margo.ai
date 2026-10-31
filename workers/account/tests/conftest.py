"""DB tests run inside one transaction that is rolled back, so the G-SYN seed stays as it is."""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest

LOCAL_DB_URL = os.environ.get("MARGO_LOCAL_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


@pytest.fixture
def conn() -> Iterator[Any]:
    import psycopg
    from psycopg.rows import dict_row

    c = psycopg.connect(LOCAL_DB_URL, autocommit=True, row_factory=dict_row)
    try:
        with c.transaction():
            yield c
            raise psycopg.Rollback()
    finally:
        c.close()
