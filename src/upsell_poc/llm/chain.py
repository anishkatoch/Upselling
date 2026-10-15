"""Fallback chain: providers tried in order, with JSON repair and a circuit breaker.

Transient retries (429/5xx/timeouts) happen inside each SDK (`max_retries`); this
layer only decides what to do once a provider call has finally failed.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from collections.abc import Callable

from upsell_poc.config import CircuitBreakerConfig, LLMConfig, LLMEndpoint
from upsell_poc.cost import estimate_cost_usd
from upsell_poc.llm.base import (
    FatalError,
    LLMProvider,
    ProviderError,
    SchemaError,
    T,
    TruncatedError,
)
from upsell_poc.schemas import CallLog

log = logging.getLogger(__name__)

REPAIR_SUFFIX = (
    "\n\nYour previous answer failed schema validation with this error:\n{error}\n"
    "Return a corrected answer that matches the schema exactly."
)


class AllProvidersFailed(RuntimeError):
    pass


class CircuitBreaker:
    def __init__(self, cfg: CircuitBreakerConfig) -> None:
        self.cfg = cfg
        self._failures: dict[str, deque[float]] = {}
        self._open_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def is_open(self, name: str) -> bool:
        with self._lock:
            return self._open_until.get(name, 0.0) > time.monotonic()

    def record_failure(self, name: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._failures.setdefault(name, deque())
            q.append(now)
            while q and now - q[0] > self.cfg.window_seconds:
                q.popleft()
            if len(q) >= self.cfg.failures:
                self._open_until[name] = now + self.cfg.cooldown_seconds
                q.clear()
                log.warning("circuit open for %s (%ss)", name, self.cfg.cooldown_seconds)

    def record_success(self, name: str) -> None:
        with self._lock:
            self._failures.pop(name, None)


class LLMChain:
    def __init__(
        self,
        providers: list[LLMProvider],
        cfg: LLMConfig,
        breaker: CircuitBreaker | None = None,
        on_call: Callable[[CallLog], None] | None = None,
    ) -> None:
        if not providers:
            raise ValueError("LLM chain needs at least one provider")
        self.providers = providers
        self.cfg = cfg
        self.breaker = breaker or CircuitBreaker(cfg.circuit_breaker)
        self.on_call = on_call

    def generate(
        self,
        *,
        step: str,
        system: str,
        user: str,
        schema: type[T],
        effort: str | None = None,
        max_tokens: int | None = None,
    ) -> tuple[T, str]:
        """Returns (parsed output, "provider/model" that produced it)."""
        effort = effort or self.cfg.step(step).effort
        max_tokens = max_tokens or self.cfg.max_tokens
        errors: list[str] = []

        for index, provider in enumerate(self.providers):
            if self.breaker.is_open(provider.name):
                errors.append(f"{provider.name}: circuit open")
                continue
            prompt, repaired, tokens = user, False, max_tokens
            while True:
                started = time.monotonic()
                try:
                    result, usage = provider.generate(
                        system=system, user=prompt, schema=schema, effort=effort, max_tokens=tokens
                    )
                except SchemaError as e:
                    self._log(step, provider, index, started, error=f"schema: {e}")
                    if not repaired:
                        repaired = True
                        prompt = user + REPAIR_SUFFIX.format(error=str(e)[:2000])
                        continue
                    errors.append(f"{provider.name}: schema invalid after repair")
                    break
                except TruncatedError as e:
                    self._log(step, provider, index, started, error=f"truncated: {e}")
                    if tokens < 64000:
                        tokens = min(64000, tokens * 2)
                        continue
                    errors.append(f"{provider.name}: truncated")
                    break
                except ProviderError as e:
                    self._log(step, provider, index, started, error=f"{type(e).__name__}: {e}")
                    self.breaker.record_failure(provider.name)
                    if isinstance(e, FatalError):
                        log.error("ALERT fatal provider error (check config) %s: %s", provider.name, e)
                    errors.append(f"{provider.name}: {type(e).__name__}: {e}")
                    break
                except Exception as e:  # noqa: BLE001 - unexpected provider bug: treat as fatal, try next
                    self._log(step, provider, index, started, error=f"unexpected {type(e).__name__}: {e}")
                    self.breaker.record_failure(provider.name)
                    log.exception("ALERT unexpected error from %s", provider.name)
                    errors.append(f"{provider.name}: unexpected {type(e).__name__}: {e}")
                    break
                else:
                    self.breaker.record_success(provider.name)
                    self._log(step, provider, index, started, usage=usage)
                    return result, f"{provider.name}"
        raise AllProvidersFailed(f"{step}: all providers failed: {errors}")

    def _log(
        self,
        step: str,
        provider: LLMProvider,
        index: int,
        started: float,
        usage: object | None = None,
        error: str | None = None,
    ) -> None:
        input_tokens = getattr(usage, "input_tokens", None)
        output_tokens = getattr(usage, "output_tokens", None)
        entry = CallLog(
            step=step,
            provider=provider.name,
            model=provider.model,
            ok=error is None,
            latency_s=round(time.monotonic() - started, 3),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=estimate_cost_usd(provider.model, input_tokens, output_tokens),
            error=error,
            fallback_index=index,
        )
        log.info("llm_call %s", entry.model_dump_json())
        if self.on_call:
            self.on_call(entry)


def build_provider(endpoint: LLMEndpoint, cfg: LLMConfig) -> LLMProvider:
    if endpoint.provider == "bedrock":
        from upsell_poc.llm.bedrock import BedrockClaudeProvider

        return BedrockClaudeProvider(endpoint, cfg)
    from upsell_poc.llm.openai_llm import OpenAIProvider

    return OpenAIProvider(endpoint, cfg)


_BREAKER: CircuitBreaker | None = None
_BREAKER_LOCK = threading.Lock()


def shared_breaker(cfg: CircuitBreakerConfig) -> CircuitBreaker:
    """One breaker per process so failures are remembered across jobs."""
    global _BREAKER
    with _BREAKER_LOCK:
        if _BREAKER is None:
            _BREAKER = CircuitBreaker(cfg)
        return _BREAKER


def build_chain(
    cfg: LLMConfig, endpoints: list[LLMEndpoint] | None = None, on_call: Callable[[CallLog], None] | None = None
) -> LLMChain:
    providers = [build_provider(e, cfg) for e in (endpoints or cfg.chain)]
    return LLMChain(providers, cfg, shared_breaker(cfg.circuit_breaker), on_call)
