"""Signed wake-up (02 §4.2, A07).

Body `{job_id, ts, sig}` with `ts` in Unix seconds and `sig = hex(HMAC-SHA256(key, f"{job_id}|{ts}"))`.
Workers reject unsigned calls, wrong signatures and calls more than 5 minutes away from now.
The key is read from MARITIME_WEBHOOK_SIGNING_KEY at run time, never stored (D44).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

KEY_ENV = "MARITIME_WEBHOOK_SIGNING_KEY"
MAX_AGE_SECONDS = 5 * 60


class WakeupRejected(Exception):
    """The call is not a valid signed wake-up. `reason` is safe to log; the body is not."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def key_from_env() -> bytes:
    value = os.environ.get(KEY_ENV)
    if not value:
        raise WakeupRejected("signing_key_missing")
    return value.encode()


def _sig(key: bytes, job_id: str, ts: int) -> str:
    return hmac.new(key, f"{job_id}|{ts}".encode(), hashlib.sha256).hexdigest()


def sign_wakeup(job_id: UUID, key: bytes, now: datetime) -> dict[str, Any]:
    ts = int(now.timestamp())
    return {"job_id": str(job_id), "ts": ts, "sig": _sig(key, str(job_id), ts)}


def verify_wakeup(body: Mapping[str, Any] | bytes | str, key: bytes, now: datetime) -> UUID:
    """Return the job id of a valid wake-up; raise WakeupRejected otherwise."""
    if not key:
        raise WakeupRejected("signing_key_missing")
    if isinstance(body, bytes | str):
        try:
            body = json.loads(body)
        except ValueError:
            raise WakeupRejected("malformed") from None
    if not isinstance(body, Mapping):
        raise WakeupRejected("malformed")

    job_id, ts, sig = body.get("job_id"), body.get("ts"), body.get("sig")
    if not isinstance(sig, str) or not sig:
        raise WakeupRejected("unsigned")
    if not isinstance(job_id, str) or not isinstance(ts, int) or isinstance(ts, bool):
        raise WakeupRejected("malformed")
    if not hmac.compare_digest(_sig(key, job_id, ts).encode(), sig.encode()):
        raise WakeupRejected("bad_signature")
    if abs(now.timestamp() - ts) > MAX_AGE_SECONDS:
        raise WakeupRejected("stale")
    try:
        return UUID(job_id)
    except ValueError:
        raise WakeupRejected("malformed") from None
