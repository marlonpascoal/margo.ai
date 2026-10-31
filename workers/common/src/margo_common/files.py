"""Files of imports and closes in Supabase Storage (02 §1), behind a small interface so tests use memory.

Paths are "<bucket>/<object path>", as kept in import_run.file_path and close_period.pdf_path.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.parse
from pathlib import Path
from typing import Protocol

from margo_common.stores import Transport, urllib_transport


class FileStore(Protocol):
    def get(self, path: str) -> bytes: ...

    def put(self, path: str, data: bytes, content_type: str) -> None: ...


class MemoryFileStore:
    def __init__(self, files: dict[str, bytes] | None = None) -> None:
        self.files = dict(files or {})

    def get(self, path: str) -> bytes:
        if path not in self.files:
            raise FileNotFoundError(path)
        return self.files[path]

    def put(self, path: str, data: bytes, content_type: str) -> None:
        self.files[path] = data


class StorageFileStore:
    """Storage REST API with the service role. Locally the URL and key are the stack's public defaults."""

    def __init__(self, url: str, key: str, transport: Transport = urllib_transport) -> None:
        self.base = url.rstrip("/") + "/storage/v1/object/"
        self._key = key
        self.transport = transport

    def _url(self, path: str) -> str:
        return self.base + urllib.parse.quote(path)

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"authorization": f"Bearer {self._key}", "apikey": self._key, **(extra or {})}

    def get(self, path: str) -> bytes:
        status, body = self.transport("GET", self._url(path), self._headers(), None)
        if status == 404 or status == 400:
            raise FileNotFoundError(path)
        if status >= 300:
            raise OSError(f"storage get returned {status}")
        return body

    def put(self, path: str, data: bytes, content_type: str) -> None:
        headers = self._headers({"content-type": content_type, "x-upsert": "true"})
        status, _ = self.transport("POST", self._url(path), headers, data)
        if status >= 300:
            raise OSError(f"storage put returned {status}")


def local_storage() -> StorageFileStore:
    """Storage of the local stack: env first (scripts/with-local-env.mjs), else `supabase status`."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        status = json.loads(
            subprocess.run(
                ["supabase", "status", "-o", "json"],
                capture_output=True,
                text=True,
                check=True,
                cwd=Path(__file__).resolve().parents[4],
            ).stdout
        )
        url = status["API_URL"]
        key = status.get("SECRET_KEY") or status["SERVICE_ROLE_KEY"]
    return StorageFileStore(url, key)
