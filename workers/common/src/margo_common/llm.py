"""One structured AI call behind one interface (D70, Marlon 08/nov: OpenAI now; a benchmark may change it).

Every AI use (worker-match D14, M1-04 Stage 2 attributes, P23 "Oportunidades") sends a system text, a user
JSON and a JSON schema, and reads back one JSON object that follows the schema. Only this module knows the
provider:

- `MARGO_AI_PROVIDER`: `openai` (default) or `anthropic`.
- The key by name only: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, passed explicitly to the SDK so a local
  profile is never picked up by accident; never logged or stored. Without it the caller skips its AI step.
- The model is a parameter: each use has its own env override, else `DEFAULT_MODELS[provider]`.

A refusal or a cut answer reads as no answer (None). Each caller still validates what comes back: the provider
never decides what is stored. Tests use fake clients and replay recorded answers (D40); none calls an API.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

PROVIDERS = ("openai", "anthropic", "claude_cli")
DEFAULT_PROVIDER = "openai"
DEFAULT_MODELS = {
    "openai": "gpt-6.1-sol",
    "anthropic": "claude-sonnet-5-5",
    "claude_cli": "claude-sonnet-5-5",
}
"""Configured defaults, not branches in the logic; each use's env var overrides the model."""
USE_DEFAULTS: dict[str, dict[str, str]] = {
    "openai": {"MARGO_FAMILY_MODEL": "gpt-6-luna", "MARGO_PAIR_MODEL": "gpt-6-luna"}
}
"""D78: simple high-volume reading runs on the provider's low-cost model; judgment stays on the default."""
KEY_ENV = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


def provider_from_env() -> str:
    """`MARGO_AI_PROVIDER`, `openai` when unset; an unknown name is an error, never a silent fallback."""
    provider = (os.environ.get("MARGO_AI_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    if provider not in PROVIDERS:
        raise ValueError(f"MARGO_AI_PROVIDER must be one of {', '.join(PROVIDERS)}")
    return provider


def key_present(provider: str | None = None) -> bool:
    """Whether the key of the provider in use is set (the AI steps run only then)."""
    name = provider or provider_from_env()
    if name == "claude_cli":
        return shutil.which("claude") is not None
    return bool(os.environ.get(KEY_ENV[name]))


def model_for(provider: str, model_env: str | None = None) -> str:
    """The use's env override (`MARGO_MATCH_MODEL`, ...), its low-cost default, or the provider's default."""
    use_default = USE_DEFAULTS.get(provider, {}).get(model_env or "")
    return (os.environ.get(model_env) if model_env else None) or use_default or DEFAULT_MODELS[provider]


class ClaudeCli:
    """D79: the logged-in Claude Code, for local experiments only (`MARGO_AI_PROVIDER=claude_cli`). It uses
    the developer's plan and its limits. Never in production: no key, no service level, one person's login."""

    @staticmethod
    def command(
        request: Mapping[str, Any], environ: Mapping[str, str]
    ) -> tuple[list[str], dict[str, str]]:
        """No tools, no project settings, no saved session; API keys are removed, so the login is used."""
        env = {k: v for k, v in environ.items() if k not in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")}
        cmd = [
            "claude", "-p", "--output-format", "json", "--model", request["model"],
            "--system-prompt", request["system"], "--json-schema", json.dumps(request["schema"]),
            "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
        ]  # fmt: skip
        return cmd, env

    def run(self, request: Mapping[str, Any]) -> dict[str, Any]:
        cmd, env = self.command(request, os.environ)
        done = subprocess.run(  # noqa: S603 (fixed binary, no shell)
            cmd, input=request["user"], capture_output=True, text=True, timeout=600, env=env,
            cwd=tempfile.gettempdir(), check=False,
        )  # fmt: skip
        if done.returncode != 0 and not done.stdout:
            raise RuntimeError(f"claude CLI failed: {done.stderr[:300]}")
        return json.loads(done.stdout)


def make_client(provider: str) -> Any:
    if provider == "claude_cli":
        return ClaudeCli()
    key = os.environ.get(KEY_ENV[provider])
    if not key:
        raise RuntimeError(f"{KEY_ENV[provider]} is not set")
    if provider == "openai":
        import openai

        return openai.OpenAI(api_key=key)
    import anthropic

    return anthropic.Anthropic(api_key=key)


@dataclass(frozen=True)
class Call:
    """What one use asks: the rules, the payload (sent as JSON), the answer's schema and its size."""

    name: str
    system: str
    payload: Mapping[str, Any]
    schema: Mapping[str, Any]
    max_tokens: int


def build_request(provider: str, model: str, call: Call) -> dict[str, Any]:
    """The SDK arguments: OpenAI Responses API with a strict json_schema, or the Anthropic Messages API."""
    user = json.dumps(call.payload, ensure_ascii=False)
    if provider == "claude_cli":
        return {"model": model, "system": call.system, "user": user, "schema": call.schema}
    if provider == "openai":
        return {
            "model": model,
            "max_output_tokens": call.max_tokens,
            "input": [{"role": "system", "content": call.system}, {"role": "user", "content": user}],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": call.name,
                    "schema": call.schema,
                    "strict": True,
                }
            },
        }
    return {
        "model": model,
        "max_tokens": call.max_tokens,
        "system": call.system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"format": {"type": "json_schema", "schema": call.schema}},
    }


def request_payload(provider: str, request: Mapping[str, Any]) -> Any:
    """The payload a request carries, decoded (tests check what goes out)."""
    if provider == "openai":
        return json.loads(request["input"][1]["content"])
    return json.loads(request["messages"][0]["content"])


def send(provider: str, client: Any, request: Mapping[str, Any]) -> Any:
    if provider == "claude_cli":
        return client.run(request)
    if provider == "openai":
        return client.responses.create(**request)
    return client.messages.create(**request)


def _get(obj: Any, key: str) -> Any:
    return obj.get(key) if isinstance(obj, Mapping) else getattr(obj, key, None)


def response_text(provider: str, response: Any) -> str | None:
    """The answer's JSON text from an SDK response or its recorded dict; None on a refusal or a cut answer."""
    if provider == "claude_cli":
        output = None if _get(response, "is_error") else _get(response, "structured_output")
        return json.dumps(output, ensure_ascii=False) if output is not None else None
    if provider == "openai":
        if _get(response, "status") != "completed":
            return None
        parts = [
            p
            for item in _get(response, "output") or []
            if _get(item, "type") == "message"
            for p in _get(item, "content") or []
        ]
        if any(_get(p, "type") == "refusal" for p in parts):
            return None
        return next((_get(p, "text") for p in parts if _get(p, "type") == "output_text"), None)
    if _get(response, "stop_reason") != "end_turn":
        return None
    return next(
        (_get(b, "text") for b in _get(response, "content") or [] if _get(b, "type") == "text"), None
    )


def response_json(provider: str, response: Any) -> dict[str, Any] | None:
    """The answer as a JSON object, or None (refused, cut, not JSON, not an object)."""
    text = response_text(provider, response)
    if not text:
        return None
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def response_dict(response: Any) -> Any:
    """The SDK response as a plain dict, for the recorders."""
    return response.to_dict() if hasattr(response, "to_dict") else response


_usage: dict[str, dict[str, int]] = {}
_usage_lock = threading.Lock()


def _record_usage(name: str, model: str, response: Any) -> None:
    """D78: the tokens of each call, by use and model, so a run's cost can be known."""
    usage = _get(response, "usage")
    input_tokens = int(_get(usage, "input_tokens") or 0) if usage is not None else 0
    output_tokens = int(_get(usage, "output_tokens") or 0) if usage is not None else 0
    with _usage_lock:
        row = _usage.setdefault(f"{name}:{model}", {"calls": 0, "input_tokens": 0, "output_tokens": 0})
        row["calls"] += 1
        row["input_tokens"] += input_tokens
        row["output_tokens"] += output_tokens


def take_usage() -> dict[str, dict[str, int]]:
    """The tokens used since the last take. One worker process runs one job at a time."""
    with _usage_lock:
        out = {k: dict(v) for k, v in _usage.items()}
        _usage.clear()
    return out


class StructuredClient:
    """The provider, model and SDK client of one AI use. `client` is injected in tests (a fake)."""

    def __init__(
        self,
        client: Any = None,
        model: str | None = None,
        provider: str | None = None,
        model_env: str | None = None,
    ) -> None:
        self.provider = provider or provider_from_env()
        if self.provider not in PROVIDERS:
            raise ValueError(f"unknown AI provider {self.provider!r}")
        self.client = client if client is not None else make_client(self.provider)
        self.model = model or model_for(self.provider, model_env)

    def request(self, call: Call) -> dict[str, Any]:
        return build_request(self.provider, self.model, call)

    def ask(self, call: Call) -> dict[str, Any] | None:
        """One call; the answer object or None. The caller validates every field."""
        response = send(self.provider, self.client, self.request(call))
        _record_usage(call.name, self.model, response)
        return response_json(self.provider, response)
