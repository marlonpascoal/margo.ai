"""Feature flags for workers (04 §6, D34, A05).

The rule lives in one place, the SQL function ``public.flag_enabled``, which the web app's OpenFeature
provider calls too, so Python and TypeScript never disagree. Workers call it through an injectable RPC
callable (the Supabase client's ``rpc`` in production, a fake in tests), and a job whose flag is off
refuses to run.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from typing import Any, Literal

FlagEnv = Literal["sandbox", "production"]

# rpc(function_name, params) -> the function's result. With supabase-py:
#   lambda fn, params: client.rpc(fn, params).execute().data
Rpc = Callable[[str, Mapping[str, Any]], Any]


class FlagOff(Exception):
    """Raised by require_flag: the job must not run (A05)."""

    def __init__(self, key: str, account_id: str | None, env: FlagEnv) -> None:
        super().__init__(f"flag {key} is off for account {account_id} in {env}")
        self.key = key
        self.account_id = account_id
        self.env = env


def flag_env(environ: Mapping[str, str] = os.environ) -> FlagEnv:
    """04 §6: sandbox and production keep separate values. MARGO_FLAG_ENV, default sandbox."""
    value = environ.get("MARGO_FLAG_ENV") or "sandbox"
    if value not in ("sandbox", "production"):
        raise ValueError(f"MARGO_FLAG_ENV must be sandbox or production, got {value}")
    return value  # type: ignore[return-value]


def flag_enabled(key: str, account_id: str | None, env: FlagEnv, *, rpc: Rpc) -> bool:
    """04 §6 evaluation through public.flag_enabled. account_id None: system work with no account.

    Only a literal true counts as on. Errors from the RPC propagate, so the job fails and is retried
    instead of being silently skipped.
    """
    result = rpc("flag_enabled", {"p_key": key, "p_account": account_id, "p_env": env})
    return result is True


def require_flag(key: str, account_id: str | None, env: FlagEnv, *, rpc: Rpc) -> None:
    """A05: call before a job does any work; raises FlagOff when the flag is off."""
    if not flag_enabled(key, account_id, env, rpc=rpc):
        raise FlagOff(key, account_id, env)
