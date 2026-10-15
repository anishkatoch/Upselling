from __future__ import annotations

import pytest
from pydantic import BaseModel

from upsell_poc.config import CircuitBreakerConfig, LLMConfig, LLMEndpoint
from upsell_poc.llm.base import FatalError, RefusalError, SchemaError, TransientError, TruncatedError, Usage
from upsell_poc.llm.chain import AllProvidersFailed, CircuitBreaker, LLMChain


class Out(BaseModel):
    value: str


class Scripted:
    """Provider that raises the queued errors, then succeeds."""

    def __init__(self, name: str, errors: list[Exception] | None = None) -> None:
        self.name = name
        self.model = name
        self.errors = list(errors or [])
        self.prompts: list[str] = []
        self.max_tokens: list[int] = []

    def generate(self, *, system, user, schema, effort, max_tokens):  # type: ignore[no-untyped-def]
        self.prompts.append(user)
        self.max_tokens.append(max_tokens)
        if self.errors:
            raise self.errors.pop(0)
        return schema(value=self.name), Usage(1, 1)


def cfg() -> LLMConfig:
    return LLMConfig(
        chain=[LLMEndpoint(provider="openai", model="x")],
        circuit_breaker=CircuitBreakerConfig(failures=2, window_seconds=60, cooldown_seconds=60),
    )


def test_falls_back_on_transient_error():
    logs = []
    a, b = Scripted("a", [TransientError("429")]), Scripted("b")
    chain = LLMChain([a, b], cfg(), on_call=logs.append)
    result, by = chain.generate(step="s", system="sys", user="u", schema=Out)
    assert result.value == "b" and by == "b"
    assert [entry.ok for entry in logs] == [False, True]
    assert logs[1].fallback_index == 1


def test_schema_error_gets_one_repair_on_same_provider():
    a = Scripted("a", [SchemaError("missing field")])
    result, _ = LLMChain([a], cfg()).generate(step="s", system="", user="u", schema=Out)
    assert result.value == "a"
    assert "failed schema validation" in a.prompts[1]


def test_schema_error_twice_moves_on():
    a, b = Scripted("a", [SchemaError("x"), SchemaError("y")]), Scripted("b")
    result, _ = LLMChain([a, b], cfg()).generate(step="s", system="", user="u", schema=Out)
    assert result.value == "b"


def test_truncation_retries_with_more_tokens():
    a = Scripted("a", [TruncatedError("max")])
    LLMChain([a], cfg()).generate(step="s", system="", user="u", schema=Out, max_tokens=1000)
    assert a.max_tokens == [1000, 2000]


@pytest.mark.parametrize("error", [FatalError("404"), RefusalError("no")])
def test_fatal_and_refusal_skip_without_retry(error):
    a, b = Scripted("a", [error]), Scripted("b")
    LLMChain([a, b], cfg()).generate(step="s", system="", user="u", schema=Out)
    assert len(a.prompts) == 1


def test_all_fail_raises():
    chain = LLMChain([Scripted("a", [TransientError("x")])], cfg())
    with pytest.raises(AllProvidersFailed):
        chain.generate(step="s", system="", user="u", schema=Out)


def test_circuit_breaker_skips_provider():
    breaker = CircuitBreaker(CircuitBreakerConfig(failures=2, window_seconds=60, cooldown_seconds=60))
    a = Scripted("a", [TransientError("1"), TransientError("2"), TransientError("3")])
    b = Scripted("b")
    chain = LLMChain([a, b], cfg(), breaker=breaker)
    chain.generate(step="s", system="", user="u", schema=Out)
    chain.generate(step="s", system="", user="u", schema=Out)
    assert breaker.is_open("a")
    chain.generate(step="s", system="", user="u", schema=Out)
    assert len(a.prompts) == 2  # third call skipped "a"


def test_unexpected_exception_moves_to_next_provider():
    a, b = Scripted("a", [ValueError("missing credentials")]), Scripted("b")
    result, _ = LLMChain([a, b], cfg()).generate(step="s", system="", user="u", schema=Out)
    assert result.value == "b"


def test_missing_openai_key_is_fatal_provider_error(monkeypatch):
    from upsell_poc.llm.openai_llm import OpenAIProvider

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    provider = OpenAIProvider(LLMEndpoint(provider="openai", model="x"), cfg())  # no network, no key
    with pytest.raises(FatalError):
        provider.generate(system="", user="u", schema=Out, effort="low", max_tokens=10)
