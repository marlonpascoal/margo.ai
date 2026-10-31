"""Storage access for export and deletion: read, write, list a prefix, delete (02 §1).

Paths are "<bucket>/<object path>", as in import_run.file_path and close_period.pdf_path.
"""

from __future__ import annotations

import json
import urllib.parse
from typing import Protocol

from margo_common.files import MemoryFileStore, StorageFileStore, local_storage

BUCKETS = ("imports", "closes", "pdf", "exports")
"""Private buckets that may hold an account's files, each under "<account code>/" when they do."""


class AccountFiles(Protocol):
    def get(self, path: str) -> bytes: ...

    def put(self, path: str, data: bytes, content_type: str) -> None: ...

    def list(self, bucket: str, prefix: str) -> list[str]:
        """Every object path ("<bucket>/<name>") under the prefix, recursively."""
        ...

    def delete(self, paths: list[str]) -> None:
        """Remove these objects; missing ones are ignored."""
        ...


class MemoryAccountFiles(MemoryFileStore):
    def list(self, bucket: str, prefix: str) -> list[str]:
        start = f"{bucket}/{prefix}"
        return sorted(p for p in self.files if p.startswith(start))

    def delete(self, paths: list[str]) -> None:
        for p in paths:
            self.files.pop(p, None)


class StorageAccountFiles(StorageFileStore):
    """Storage REST API with the service role (list and delete added to the shared store)."""

    def _json(self, method: str, url: str, body: object) -> tuple[int, bytes]:
        headers = self._headers({"content-type": "application/json"})
        return self.transport(method, url, headers, json.dumps(body).encode())

    def list(self, bucket: str, prefix: str) -> list[str]:
        out: list[str] = []
        pending = [prefix.rstrip("/")]
        while pending:
            folder = pending.pop()
            offset = 0
            while True:
                status, body = self._json(
                    "POST",
                    self.base + "list/" + urllib.parse.quote(bucket),
                    {"prefix": folder, "limit": 1000, "offset": offset},
                )
                if status >= 300:
                    raise OSError(f"storage list returned {status}")
                entries = json.loads(body or b"[]")
                for e in entries:
                    name = f"{folder}/{e['name']}" if folder else e["name"]
                    if e.get("id") is None:
                        pending.append(name)
                    else:
                        out.append(f"{bucket}/{name}")
                if len(entries) < 1000:
                    break
                offset += 1000
        return sorted(out)

    def delete(self, paths: list[str]) -> None:
        by_bucket: dict[str, list[str]] = {}
        for p in paths:
            bucket, _, name = p.partition("/")
            by_bucket.setdefault(bucket, []).append(name)
        for bucket, names in by_bucket.items():
            for i in range(0, len(names), 500):
                status, _ = self._json(
                    "DELETE", self.base + urllib.parse.quote(bucket), {"prefixes": names[i : i + 500]}
                )
                if status >= 300:
                    raise OSError(f"storage delete returned {status}")


def local_account_files() -> StorageAccountFiles:
    s = local_storage()
    files = StorageAccountFiles(s.base.removesuffix("/storage/v1/object/"), s._key)  # noqa: SLF001
    files.transport = s.transport
    return files
