"""Per-conversation analysis: mood fusion, then upsell detection (with escalation)."""

from __future__ import annotations

import logging
from collections.abc import Callable

from upsell_poc.analysis import acoustics, prompts, tone
from upsell_poc.analysis.formatting import render_segments
from upsell_poc.analysis.scoring import effort_score
from upsell_poc.control import ConversationBudgetExceeded
from upsell_poc.llm.chain import LLMChain
from upsell_poc.schemas import (
    AcousticTurn,
    ConversationResult,
    ConversationSpan,
    MoodAnalysis,
    Segment,
    ToneAnalysis,
    UpsellAnalysis,
)

log = logging.getLogger(__name__)


def analyze_mood(
    chain: LLMChain,
    segments: list[Segment],
    role_map: dict[str, str],
    tone_result: ToneAnalysis | None,
    acoustic_turns: list[AcousticTurn] | None,
) -> MoodAnalysis:
    user = (
        f"WORDS (transcript):\n{render_segments(segments, role_map)}\n\n"
        f"VOICE TONE:\n{tone.render(tone_result)}\n\n"
        f"ACOUSTICS:\n{acoustics.render(acoustic_turns) if acoustic_turns else '(not available)'}"
    )
    result, _ = chain.generate(step="mood_fusion", system=prompts.MOOD_FUSION, user=user, schema=MoodAnalysis)
    for s in result.speakers:
        s.frustration_level = max(0, min(10, s.frustration_level))
    return result


def _mood_notes(mood: MoodAnalysis | None) -> str:
    if not mood:
        return "(not available)"
    lines = [
        f"{s.speaker}: overall {s.overall_mood}, frustration {s.frustration_level}/10, {s.trend} - {s.summary}"
        for s in mood.speakers
    ]
    lines += [
        f'frustration at #{m.segment_id} ({m.speaker}): "{m.quote}" [{m.evidence_source}]'
        for m in mood.frustration_moments
    ]
    return "\n".join(lines)


def analyze_upsell(
    chain: LLMChain,
    segments: list[Segment],
    role_map: dict[str, str],
    span: ConversationSpan,
    mood: MoodAnalysis | None,
    industry: str | None,
    catalog: str | None,
) -> tuple[UpsellAnalysis, str]:
    context = []
    if industry:
        context.append(f"Industry: {industry}")
    if catalog:
        context.append(f"Product catalog:\n{catalog[:20000]}")
    user = (
        ("\n".join(context) + "\n\n" if context else "") + f"Salespeople: {', '.join(span.salespeople) or 'unknown'}\n"
        f"Customers: {', '.join(span.customers) or 'unknown'}\n\n"
        f"MOOD NOTES:\n{_mood_notes(mood)}\n\n"
        f"Transcript:\n{render_segments(segments, role_map)}"
    )
    result, produced_by = chain.generate(
        step="upsell_detection", system=prompts.UPSELL_DETECTION, user=user, schema=UpsellAnalysis
    )
    return _clean(result, segments), produced_by


def _clean(result: UpsellAnalysis, segments: list[Segment]) -> UpsellAnalysis:
    ids = {s.id for s in segments}
    attempts = [a for a in result.upsell_attempts if a.segment_id in ids and a.salesperson_initiated]
    return result.model_copy(update={"upsell_attempts": attempts, "confidence": max(0.0, min(1.0, result.confidence))})


def analyze_conversation(
    chain: LLMChain,
    escalation_chain: LLMChain | None,
    threshold: float | None,
    span: ConversationSpan,
    segments: list[Segment],
    role_map: dict[str, str],
    tone_result: ToneAnalysis | None,
    acoustic_turns: list[AcousticTurn] | None,
    industry: str | None,
    catalog: str | None,
    check_budget: Callable[[], None] | None = None,
) -> ConversationResult:
    """`check_budget`, if given, raises ConversationBudgetExceeded when this one
    conversation's own spend crosses its per-conversation cap. Caught here, not
    propagated: whatever was already computed (mood, and upsell if it got that far) is
    kept, the remaining step(s) are skipped, and `budget_note` explains why.
    """
    base = ConversationResult(
        conversation_id=span.conversation_id,
        start=segments[0].start,
        end=segments[-1].end,
        topic=span.topic,
        language=span.language,
        is_sales_interaction=span.is_sales_interaction,
        salespeople=span.salespeople,
        customers=span.customers,
    )
    mood = analyze_mood(chain, segments, role_map, tone_result, acoustic_turns)
    base.mood = mood
    if not span.is_sales_interaction or not span.salespeople:
        return base

    if check_budget:
        try:
            check_budget()
        except ConversationBudgetExceeded as e:
            base.budget_note = str(e)
            return base

    upsell, produced_by = analyze_upsell(chain, segments, role_map, span, mood, industry, catalog)
    escalated = False
    if escalation_chain and threshold is not None and upsell.confidence < threshold:
        skip_escalation = False
        if check_budget:
            try:
                check_budget()
            except ConversationBudgetExceeded as e:
                base.budget_note = str(e)
                skip_escalation = True
        if not skip_escalation:
            log.info(
                "conversation %s confidence %.2f < %.2f -> escalating",
                span.conversation_id,
                upsell.confidence,
                threshold,
            )
            try:
                upsell, produced_by = analyze_upsell(
                    escalation_chain, segments, role_map, span, mood, industry, catalog
                )
                escalated = True
            except Exception:  # noqa: BLE001 - keep the first answer if escalation fails
                log.warning("escalation failed; keeping primary result", exc_info=True)

    base.upsell = upsell
    base.attempted_upsell = bool(upsell.upsell_attempts)
    base.effort_score = effort_score(upsell)
    base.analyzed_by = produced_by
    base.escalated = escalated
    return base
