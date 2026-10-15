"""Estimated USD cost per API call, for the per-job budget cap.

This is a best-effort estimate from token counts, not a real billing figure:

- Priced models below use rates confirmed from each provider's own docs at the time
  this was written. Prices change; re-check before relying on this for real budgets.
- Amazon Transcribe bills by audio duration, not tokens, and isn't priced here at all
  (its calls simply don't contribute to spent_usd). If the Transcribe fallback runs,
  real spend will be higher than this estimate says.
- `gpt-6.1-sol` (the OpenAI fallback model) and the transcription models
  (`gpt-4o-transcribe-diarize`, `gpt-transcribe`) have no confirmed per-token price as
  of this writing, so calls to them are also excluded from spent_usd (see
  `unpriced_calls` on the report). If a job leans on these, the real bill can exceed
  the budget even though spent_usd stays under it.

Because of the gaps above, treat BUDGET_USD as a soft, best-effort stop on the LLM
steps we can price - not a guarantee against your actual provider invoice. Set hard
spend limits in the OpenAI and AWS billing consoles as the real backstop.
"""

from __future__ import annotations

# USD per 1,000,000 tokens: (input, output). Keyed by the exact model id used in config.
PRICING_PER_MTOK: dict[str, tuple[float, float]] = {
    "anthropic.claude-sonnet-5-5": (2.00, 10.00),
    "anthropic.claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
    "gpt-audio-1.5": (32.00, 64.00),
}


def estimate_cost_usd(model: str, input_tokens: int | None, output_tokens: int | None) -> float | None:
    """None means "no pricing entry for this model" - the caller should not count it."""
    rates = PRICING_PER_MTOK.get(model)
    if rates is None or input_tokens is None or output_tokens is None:
        return None
    in_rate, out_rate = rates
    return round(input_tokens * in_rate / 1_000_000 + output_tokens * out_rate / 1_000_000, 6)
