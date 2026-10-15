"""OpenAI Responses API with structured outputs (cross-provider fallback)."""

from __future__ import annotations

import openai
import pydantic

from upsell_poc.config import LLMConfig, LLMEndpoint
from upsell_poc.llm.base import (
    FatalError,
    RefusalError,
    SchemaError,
    T,
    TransientError,
    TruncatedError,
    Usage,
)


def classify_openai_error(e: Exception) -> Exception:
    if isinstance(
        e, (openai.RateLimitError, openai.InternalServerError, openai.APITimeoutError, openai.APIConnectionError)
    ):
        return TransientError(str(e))
    if isinstance(e, openai.APIStatusError):
        if e.status_code >= 500 or e.status_code in (408, 409, 429):
            return TransientError(str(e))
        return FatalError(str(e))
    if isinstance(e, openai.OpenAIError):  # e.g. missing API key
        return FatalError(str(e))
    return e


class OpenAIProvider:
    def __init__(self, endpoint: LLMEndpoint, cfg: LLMConfig) -> None:
        self.model = endpoint.model
        self.reasoning = endpoint.reasoning
        self.name = f"openai:{self.model}"
        self.cfg = cfg
        self._client: openai.OpenAI | None = None

    @property
    def client(self) -> openai.OpenAI:
        if self._client is None:
            self._client = openai.OpenAI(max_retries=self.cfg.sdk_max_retries, timeout=float(self.cfg.timeout_seconds))
        return self._client

    def generate(self, *, system: str, user: str, schema: type[T], effort: str, max_tokens: int) -> tuple[T, Usage]:
        kwargs: dict = {}
        if self.reasoning:
            kwargs["reasoning"] = {"effort": effort}
        try:
            response = self.client.responses.parse(
                model=self.model,
                instructions=system,
                input=user,
                text_format=schema,
                max_output_tokens=max_tokens,
                **kwargs,
            )
        except pydantic.ValidationError as e:
            raise SchemaError(str(e)) from e
        except openai.OpenAIError as e:
            raise classify_openai_error(e) from e

        if response.status == "incomplete":
            reason = getattr(response.incomplete_details, "reason", None)
            if reason == "max_output_tokens":
                raise TruncatedError(f"max_output_tokens={max_tokens}")
            raise RefusalError(f"incomplete: {reason}")
        for item in response.output:
            for part in getattr(item, "content", None) or []:
                if getattr(part, "type", None) == "refusal":
                    raise RefusalError(part.refusal)

        parsed = response.output_parsed
        if parsed is None:
            raise SchemaError("no parsed output")
        usage = Usage(getattr(response.usage, "input_tokens", None), getattr(response.usage, "output_tokens", None))
        return parsed, usage
