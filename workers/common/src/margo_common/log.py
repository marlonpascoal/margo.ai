"""One JSON line per event on stderr (02 §8).

Ids and counts only (02 §7); secret-looking keys are redacted (02 §6).
"""

from __future__ import annotations

import json
import re
import sys
from datetime import UTC, datetime
from typing import Any

SECRET_KEY = re.compile(r"key|secret|token|authorization", re.IGNORECASE)


def log_event(event: str, **fields: Any) -> None:
    line: dict[str, Any] = {"at": datetime.now(UTC).isoformat(), "event": event}
    for k, v in fields.items():
        line[k] = "[redacted]" if SECRET_KEY.search(k) else v
    print(json.dumps(line, default=str), file=sys.stderr, flush=True)
