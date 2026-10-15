"""Provider interface and the error classes the fallback chain acts on."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class ProviderError(Exception):
    """Base class. `retryable` errors already exhausted SDK retries."""

    retryable = True


class TransientError(ProviderError):
    """429 / 5xx / timeout / connection error after SDK retries -> next provider."""


class FatalError(ProviderError):
    """400/401/403/404 - config or code bug. No retry; alert and move to next provider."""

    retryable = False


class RefusalError(ProviderError):
    """Model declined (stop_reason == refusal) -> next provider."""


class TruncatedError(ProviderError):
    """Output hit max_tokens."""


class SchemaError(ProviderError):
    """Output did not validate against the schema -> one repair try, then next provider."""

    def __init__(self, message: str, raw: str | None = None) -> None:
        super().__init__(message)
        self.raw = raw


@dataclass
class Usage:
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(Protocol):
    name: str
    model: str

    def generate(self, *, system: str, user: str, schema: type[T], effort: str, max_tokens: int) -> tuple[T, Usage]: ...
