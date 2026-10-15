"""Claude on Amazon Bedrock via the Mantle (Messages API) client.

Sonnet 5.5 / Opus 5.5 notes: thinking is adaptive by default and cannot be
disabled; depth is set with output_config.effort. Do not send temperature/top_p,
forced tool_choice or assistant prefill (all 400). Server-side fallbacks are not
available on Bedrock, so fallback lives in LLMChain.
"""

from __future__ import annotations

from typing import cast

import anthropic
import pydantic
from anthropic import AnthropicBedrockMantle
from anthropic.types import OutputConfigParam
from botocore.exceptions import BotoCoreError

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


class BedrockClaudeProvider:
    def __init__(self, endpoint: LLMEndpoint, cfg: LLMConfig) -> None:
        self.model = endpoint.model
        self.region = endpoint.region or "us-east-1"
        self.name = f"bedrock:{self.model}@{self.region}"
        self.cfg = cfg
        self._client: AnthropicBedrockMantle | None = None

    @property
    def client(self) -> AnthropicBedrockMantle:
        # Created on first use so missing credentials fail this provider, not the whole job.
        if self._client is None:
            self._client = AnthropicBedrockMantle(
                aws_region=self.region, max_retries=self.cfg.sdk_max_retries, timeout=float(self.cfg.timeout_seconds)
            )
        return self._client

    def generate(self, *, system: str, user: str, schema: type[T], effort: str, max_tokens: int) -> tuple[T, Usage]:
        try:
            with self.client.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                # Fixed instructions first and cached; per-request content goes in messages.
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
                output_format=schema,
                output_config=cast(OutputConfigParam, {"effort": effort}),
            ) as stream:
                response = stream.get_final_message()
        except (
            anthropic.RateLimitError,
            anthropic.InternalServerError,
            anthropic.APITimeoutError,
            anthropic.APIConnectionError,
        ) as e:
            raise TransientError(str(e)) from e
        except (
            anthropic.BadRequestError,
            anthropic.AuthenticationError,
            anthropic.PermissionDeniedError,
            anthropic.NotFoundError,
        ) as e:
            raise FatalError(str(e)) from e
        except anthropic.APIStatusError as e:
            if e.status_code >= 500 or e.status_code in (408, 409, 429):
                raise TransientError(str(e)) from e
            raise FatalError(str(e)) from e
        except BotoCoreError as e:  # e.g. no AWS credentials
            raise FatalError(f"aws: {e}") from e
        except pydantic.ValidationError as e:
            # The SDK parses each text block when it closes, before stop_reason arrives,
            # so output cut off at max_tokens surfaces here as unterminated JSON.
            if any(err["type"] == "json_invalid" and "EOF" in err["msg"] for err in e.errors()):
                raise TruncatedError(f"max_tokens={max_tokens}") from e
            raise SchemaError(str(e)) from e

        if response.stop_reason == "refusal":
            raise RefusalError(str(getattr(response, "stop_details", "") or "refusal"))
        if response.stop_reason == "max_tokens":
            raise TruncatedError(f"max_tokens={max_tokens}")

        parsed = response.parsed_output
        if parsed is None:
            raise SchemaError("no parsed output")
        usage = Usage(response.usage.input_tokens, response.usage.output_tokens)
        return parsed, usage
