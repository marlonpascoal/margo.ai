"""D70: one structured AI call behind one interface, OpenAI by default. Fake clients only; no test calls an API."""

from __future__ import annotations

import json
from typing import Any

import pytest
from margo_common import llm

SCHEMA = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"], "additionalProperties": False}
CALL = llm.Call("teste", "Regras.", {"itens": ["x"]}, SCHEMA, 100)


def openai_answer(text: str, status: str = "completed") -> dict[str, Any]:
    reasoning = {"type": "reasoning", "summary": []}
    message = {"type": "message", "content": [{"type": "output_text", "text": text}]}
    return {"status": status, "output": [reasoning, message]}


def test_D70_provider_defaults_to_openai_and_rejects_unknown_names(monkeypatch):
    monkeypatch.delenv("MARGO_AI_PROVIDER", raising=False)
    assert llm.provider_from_env() == "openai"
    monkeypatch.setenv("MARGO_AI_PROVIDER", "Anthropic")
    assert llm.provider_from_env() == "anthropic"
    monkeypatch.setenv("MARGO_AI_PROVIDER", "deepseek")
    with pytest.raises(ValueError, match="MARGO_AI_PROVIDER"):
        llm.provider_from_env()


def test_D70_key_is_the_providers_and_read_by_name(monkeypatch):
    monkeypatch.delenv("MARGO_AI_PROVIDER", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    assert not llm.key_present(), "an Anthropic key does not run the OpenAI provider"
    assert llm.key_present("anthropic")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        llm.StructuredClient()


def test_D70_model_env_overrides_the_providers_default(monkeypatch):
    monkeypatch.delenv("MARGO_X_MODEL", raising=False)
    assert llm.StructuredClient(client=object(), provider="openai", model_env="MARGO_X_MODEL").model == "gpt-6.1-sol"
    assert llm.StructuredClient(client=object(), provider="anthropic").model == "claude-sonnet-5-5"
    monkeypatch.setenv("MARGO_X_MODEL", "outro")
    assert llm.StructuredClient(client=object(), provider="openai", model_env="MARGO_X_MODEL").model == "outro"


def test_D70_requests_carry_the_same_payload_and_a_strict_schema():
    o = llm.build_request("openai", "m", CALL)
    assert o["input"][0] == {"role": "system", "content": "Regras."}
    assert o["text"]["format"] == {"type": "json_schema", "name": "teste", "schema": SCHEMA, "strict": True}
    assert o["max_output_tokens"] == 100
    a = llm.build_request("anthropic", "m", CALL)
    assert a["system"] == "Regras." and a["output_config"]["format"]["schema"] == SCHEMA
    assert llm.request_payload("openai", o) == llm.request_payload("anthropic", a) == {"itens": ["x"]}


def test_D70_openai_answer_reads_only_when_complete_and_not_refused():
    assert llm.response_json("openai", openai_answer('{"a": "b"}')) == {"a": "b"}
    assert llm.response_json("openai", openai_answer('{"a": "b"}', "incomplete")) is None
    assert llm.response_json("openai", openai_answer("não é json")) is None
    assert llm.response_json("openai", openai_answer("[1]")) is None, "an object, never a list"
    refused = {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "não"}]}]}
    assert llm.response_json("openai", refused) is None


def test_D70_anthropic_answer_reads_only_at_end_turn():
    ok = {"stop_reason": "end_turn", "content": [{"type": "text", "text": '{"a": "b"}'}]}
    assert llm.response_json("anthropic", ok) == {"a": "b"}
    assert llm.response_json("anthropic", dict(ok, stop_reason="max_tokens")) is None


def test_D70_ask_sends_one_request_through_the_providers_endpoint():
    class Fake:
        def __init__(self) -> None:
            self.sent: list[dict[str, Any]] = []
            self.responses = self

        def create(self, **kw: Any) -> dict[str, Any]:
            self.sent.append(kw)
            return openai_answer(json.dumps({"a": "b"}))

    fake = Fake()
    ai = llm.StructuredClient(client=fake, model="m", provider="openai")
    assert ai.ask(CALL) == {"a": "b"}
    assert len(fake.sent) == 1 and fake.sent[0]["model"] == "m"
