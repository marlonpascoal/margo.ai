"""Job handler of worker-match (`uv run worker match_ai --local`).

The runner checks m3.depara_ia for the job's account first (JOB_FLAGS, A05). Payload: {"account_id": ...}.
Steps: learn rules from confirmations, GTIN and rules, then Claude suggestions for what is left (D14).
"""

from __future__ import annotations

import os

from margo_common.runner import JobRun, LogValue
from pydantic import BaseModel

from . import db
from .ai import ClaudeSuggester, Suggester


class MatchPayload(BaseModel):
    account_id: str


def run_match(conn: object, account_id: str, suggester: Suggester | None) -> dict[str, LogValue]:
    """Without a suggester (no ANTHROPIC_API_KEY, e.g. local development) the AI step is skipped and the
    lines stay for the next run."""
    learned = db.learn_rules(conn)
    auto = db.run_auto(conn, account_id)
    ai = db.run_ai(conn, account_id, suggester) if suggester is not None else db.Counts()
    return {
        "account_id": account_id,
        "rules_learned": learned,
        "auto_confirmed": auto.auto_confirmed,
        "auto_suggested": auto.auto_suggested,
        "ai_lines_sent": ai.ai_lines_sent,
        "ai_suggested": ai.ai_suggested,
        "ai_skipped": suggester is None,
    }


def match_ai(job: JobRun[MatchPayload]) -> dict[str, LogValue]:
    if job.job.account_id is not None and str(job.job.account_id) != job.payload.account_id:
        raise ValueError("payload account differs from the job's account")
    conn = db.connect()
    try:
        suggester = ClaudeSuggester() if os.environ.get("ANTHROPIC_API_KEY") else None
        return run_match(conn, job.payload.account_id, suggester)
    finally:
        conn.close()


match_ai.payload_model = MatchPayload  # type: ignore[attr-defined]
