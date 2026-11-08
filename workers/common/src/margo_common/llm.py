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
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

PROVIDERS = ("openai", "anthropic")
DEFAULT_PROVIDER = "openai"
DEFAULT_MODELS = {"openai": "gpt-6.1-sol", "anthropic": "claude-sonnet-5-5"}
"""Configured defaults, not branches in the logic; each use's env var overrides the model."""
KEY_ENV = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


def provider_from_env() -> str:
    """`MARGO_AI_PROVIDER`, `openai` when unset; an unknown name is an error, never a silent fallback."""
    provider = (os.environ.get("MARGO_AI_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    if provider not in PROVIDERS:
        raise ValueError(f"MARGO_AI_PROVIDER must be one of {', '.join(PROVIDERS)}")
    return provider


def key_present(provider: str | None = None) -> bool:
    """Whether the key of the provider in use is set (the AI steps run only then)."""
    return bool(os.environ.get(KEY_ENV[provider or provider_from_env()]))


def model_for(provider: str, model_env: str | None = None) -> str:
    """The use's env override (`MARGO_MATCH_MODEL`, ...) or the provider's default model."""
    return (os.environ.get(model_env) if model_env else None) or DEFAULT_MODELS[provider]


def make_client(provider: str) -> Any:
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
    if provider == "openai":
        return {
            "model": model,
            "max_output_tokens": call.max_tokens,
            "input": [{"role": "system", "content": call.system}, {"role": "user", "content": user}],
            "text": {
                "format": {"type": "json_schema", "name": call.name, "schema": call.schema, "strict": True}
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
    if provider == "openai":
        return client.responses.create(**request)
    return client.messages.create(**request)


def _get(obj: Any, key: str) -> Any:
    return obj.get(key) if isinstance(obj, Mapping) else getattr(obj, key, None)


def response_text(provider: str, response: Any) -> str | None:
    """The answer's JSON text from an SDK response or its recorded dict; None on a refusal or a cut answer."""
    if provider == "openai":
        if _get(response, "status") != "completed":
            return None
        parts = [p for item in _get(response, "output") or [] if _get(item, "type") == "message"
                 for p in _get(item, "content") or []]
        if any(_get(p, "type") == "refusal" for p in parts):
            return None
        return next((_get(p, "text") for p in parts if _get(p, "type") == "output_text"), None)
    if _get(response, "stop_reason") != "end_turn":
        return None
    return next((_get(b, "text") for b in _get(response, "content") or [] if _get(b, "type") == "text"), None)


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
        return response_json(self.provider, send(self.provider, self.client, self.request(call)))
