"""Evidence for every finding: the real transcript lines around each quoted moment.

Covers upsell attempts, frustration moments, unanswered customer questions, the greeting
and the customer-feedback summary - all located in the same way. The model reports a quote
and a segment id; both can be slightly off (wrong id, trimmed or re-spelled quote), so each
quote is located in the actual transcript first. A finding keeps its model-given id when the
quote cannot be found (`quote_found=False`), so a bad match is visible rather than silently wrong.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from upsell_poc.schemas import (
    ConversationResult,
    Evidence,
    EvidenceKind,
    EvidenceLine,
    Segment,
)

CONTEXT_LINES = 2  # lines shown before and after the finding
FUZZY_THRESHOLD = 0.6
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", _NON_WORD.sub(" ", text.lower())).strip()


def locate_quote(
    quote_text: str, given_segment_id: int, speaker_hint: str | None, segments: list[Segment]
) -> tuple[int, bool]:
    """Return (segment id, found). `segments` are the conversation's lines in order.

    `speaker_hint`, when given, is required for an exact match's tie-break and for the fuzzy
    fallback (a quote can only fuzzy-match a line from the person who is supposed to have said
    it); pass None to allow any speaker, e.g. when the asking side isn't known in advance.
    """
    quote = normalize(quote_text)
    if not quote or not segments:
        return given_segment_id, False
    given = next((i for i, s in enumerate(segments) if s.id == given_segment_id), None)

    # A quote can span two neighbouring lines, so search single lines then adjacent pairs.
    def windows() -> list[tuple[int, str]]:
        out = [(i, normalize(s.text)) for i, s in enumerate(segments)]
        out += [(i, normalize(f"{segments[i].text} {segments[i + 1].text}")) for i in range(len(segments) - 1)]
        return out

    candidates = windows()
    exact = [i for i, text in candidates if quote in text]
    if exact:
        # Prefer the line the model named, then the nearest one, then the expected speaker's own lines.
        def rank(i: int) -> tuple[int, int, int]:
            return (
                0 if i == given else 1,
                abs(i - given) if given is not None else 0,
                0 if speaker_hint is None or segments[i].speaker == speaker_hint else 1,
            )

        return segments[min(exact, key=rank)].id, True

    best_i, best_ratio = None, 0.0
    for i, text in candidates:
        if speaker_hint is not None and segments[i].speaker != speaker_hint:
            continue
        ratio = SequenceMatcher(None, quote, text).ratio()
        # Containment of a trimmed quote also counts as a strong fuzzy match.
        if len(text) > len(quote):
            ratio = max(
                ratio, SequenceMatcher(None, quote, text, autojunk=False).find_longest_match().size / len(quote)
            )
        if ratio > best_ratio:
            best_i, best_ratio = i, ratio
    if best_i is not None and best_ratio >= FUZZY_THRESHOLD:
        return segments[best_i].id, True
    return given_segment_id, False


def _window(
    kind: EvidenceKind,
    conversation_id: int,
    index: int,
    speaker: str,
    seg_id: int,
    found: bool,
    lines: list[Segment],
    index_of: dict[int, int],
    role_map: dict[str, str],
) -> Evidence:
    center = index_of.get(seg_id)
    window = lines[max(0, center - CONTEXT_LINES) : center + CONTEXT_LINES + 1] if center is not None else []
    return Evidence(
        kind=kind,
        conversation_id=conversation_id,
        index=index,
        speaker=speaker,
        segment_id=seg_id,
        quote_found=found,
        lines=[
            EvidenceLine(
                segment_id=s.id,
                speaker=s.speaker,
                role=role_map.get(s.speaker, "other"),  # type: ignore[arg-type]
                start=s.start,
                end=s.end,
                text=s.text,
                is_highlighted=s.id == seg_id,
            )
            for s in window
        ],
    )


def attach_evidence(
    conversations: list[ConversationResult], segments: list[Segment], role_map: dict[str, str]
) -> tuple[list[ConversationResult], list[Evidence]]:
    """Correct every finding's segment id against the transcript and build its evidence excerpt."""
    evidence: list[Evidence] = []
    fixed: list[ConversationResult] = []
    ordered = sorted(segments, key=lambda s: s.start)

    for conv in conversations:
        lines = [s for s in ordered if s.start >= conv.start - 0.01 and s.end <= conv.end + 0.01]
        if not lines:
            fixed.append(conv)
            continue
        index_of = {s.id: i for i, s in enumerate(lines)}
        conv_evidence: list[Evidence] = []
        updates: dict[str, object] = {}

        # Frustration moments: independent of upsell, since mood still runs even when the
        # per-conversation budget cuts upsell detection short.
        if conv.mood and conv.mood.frustration_moments:
            fixed_moments = []
            for n, m in enumerate(conv.mood.frustration_moments):
                seg_id, found = locate_quote(m.quote, m.segment_id, m.speaker, lines)
                fixed_moments.append(m.model_copy(update={"segment_id": seg_id}))
                conv_evidence.append(
                    _window("frustration", conv.conversation_id, n, m.speaker, seg_id, found, lines, index_of, role_map)
                )
            updates["mood"] = conv.mood.model_copy(update={"frustration_moments": fixed_moments})

        if conv.upsell:
            u = conv.upsell
            fixed_attempts = []
            for n, a in enumerate(u.upsell_attempts):
                seg_id, found = locate_quote(a.quote, a.segment_id, a.salesperson, lines)
                fixed_attempts.append(a.model_copy(update={"segment_id": seg_id}))
                conv_evidence.append(
                    _window(
                        "upsell_attempt",
                        conv.conversation_id,
                        n,
                        a.salesperson,
                        seg_id,
                        found,
                        lines,
                        index_of,
                        role_map,
                    )
                )

            fixed_questions = []
            for n, q in enumerate(u.unanswered_questions):
                seg_id, found = locate_quote(q.question, q.segment_id, q.speaker, lines)
                fixed_questions.append(q.model_copy(update={"segment_id": seg_id}))
                conv_evidence.append(
                    _window(
                        "unanswered_question",
                        conv.conversation_id,
                        n,
                        q.speaker,
                        seg_id,
                        found,
                        lines,
                        index_of,
                        role_map,
                    )
                )

            u_updates: dict[str, object] = {"upsell_attempts": fixed_attempts, "unanswered_questions": fixed_questions}

            if u.greeting_given and u.greeting_quote:
                hint = next(iter(conv.salespeople), None)
                given = u.greeting_segment_id if u.greeting_segment_id is not None else lines[0].id
                seg_id, found = locate_quote(u.greeting_quote, given, hint, lines)
                u_updates["greeting_segment_id"] = seg_id
                conv_evidence.append(
                    _window(
                        "greeting",
                        conv.conversation_id,
                        0,
                        hint or "salesperson",
                        seg_id,
                        found,
                        lines,
                        index_of,
                        role_map,
                    )
                )

            if u.customer_feedback and u.customer_feedback_segment_id is not None:
                # A paraphrase, not a verbatim quote - anchor to the given line rather than
                # text-matching it; "found" just means that segment id exists in this conversation.
                seg_id = u.customer_feedback_segment_id
                found = seg_id in index_of
                speaker = lines[index_of[seg_id]].speaker if found else next(iter(conv.customers), "customer")
                conv_evidence.append(
                    _window(
                        "customer_feedback", conv.conversation_id, 0, speaker, seg_id, found, lines, index_of, role_map
                    )
                )

            updates["upsell"] = u.model_copy(update=u_updates)

        fixed.append(conv.model_copy(update=updates) if updates else conv)
        evidence.extend(conv_evidence)

    return fixed, evidence
