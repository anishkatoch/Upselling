from __future__ import annotations

from upsell_poc.cost import estimate_cost_usd


def test_priced_model_computes_expected_cost():
    # claude-sonnet-5-5: $2/$10 per MTok -> 100k in + 100k out = 0.2 + 1.0
    assert estimate_cost_usd("anthropic.claude-sonnet-5-5", 100_000, 100_000) == 1.2


def test_unpriced_model_returns_none():
    assert estimate_cost_usd("gpt-6.1-sol", 1000, 1000) is None


def test_missing_token_counts_return_none():
    assert estimate_cost_usd("anthropic.claude-sonnet-5-5", None, 100) is None
    assert estimate_cost_usd("anthropic.claude-sonnet-5-5", 100, None) is None
