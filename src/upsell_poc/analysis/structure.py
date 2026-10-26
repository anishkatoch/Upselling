"""Role detection (incl. merging split speaker labels) and conversation splitting."""

from __future__ import annotations

import re

from upsell_poc.analysis import prompts
from upsell_poc.analysis.formatting import render_segments
from upsell_poc.llm.chain import LLMChain
from upsell_poc.schemas import (
    ConversationSpan,
    ConversationSplit,
    RoleDetection,
    Segment,
    SpeakerRepair,
    SpeakerRole,
    Transcript,
)


def detect_roles(chain: LLMChain, transcript: Transcript) -> RoleDetection:
    user = f"Speaker labels: {', '.join(transcript.speakers)}\n\nTranscript:\n{render_segments(transcript.segments)}"
    result, _ = chain.generate(step="role_detection", system=prompts.ROLE_DETECTION, user=user, schema=RoleDetection)
    known = {s.speaker for s in result.speakers}
    labels = set(transcript.speakers)
    # Guard against invented / missing labels.
    speakers = [s for s in result.speakers if s.speaker in labels]
    for s in speakers:
        if s.canonical_speaker not in labels:
            s.canonical_speaker = s.speaker
    for missing in sorted(labels - known):
        speakers.append(
            SpeakerRole(
                speaker=missing,
                canonical_speaker=missing,
                role="other",
                title="Unclear",
                reasoning="not classified by model",
            )
        )
    return RoleDetection(has_sales_activity=result.has_sales_activity, speakers=speakers)


def apply_speaker_merge(
    transcript: Transcript, roles: RoleDetection
) -> tuple[Transcript, dict[str, str], dict[str, str]]:
    """Relabel merged speakers; returns the new transcript, canonical label -> role, and
    canonical label -> title (the free-text, more specific role description)."""
    canonical = {s.speaker: s.canonical_speaker for s in roles.speakers}
    # Resolve chains (a -> b -> c) and make sure the target exists.
    for label in list(canonical):
        seen = {label}
        target = canonical[label]
        while canonical.get(target, target) != target and target not in seen:
            seen.add(target)
            target = canonical[target]
        canonical[label] = target
    segments = [s.model_copy(update={"speaker": canonical.get(s.speaker, s.speaker)}) for s in transcript.segments]
    role_of = {s.speaker: s.role for s in roles.speakers}
    title_of = {s.speaker: s.title for s in roles.speakers}
    role_map: dict[str, str] = {canonical[lbl]: role_of.get(canonical[lbl], role) for lbl, role in role_of.items()}
    title_map: dict[str, str] = {canonical[lbl]: title_of.get(canonical[lbl], title) for lbl, title in title_of.items()}
    return transcript.model_copy(update={"segments": segments}), role_map, title_map


def split_conversations(chain: LLMChain, transcript: Transcript, role_map: dict[str, str]) -> list[ConversationSpan]:
    if not transcript.segments:
        return []
    user = f"Transcript:\n{render_segments(transcript.segments, role_map)}"
    result, _ = chain.generate(
        step="conversation_splitting", system=prompts.CONVERSATION_SPLITTING, user=user, schema=ConversationSplit
    )
    return normalize_spans(result.conversations, transcript, role_map)


def normalize_spans(
    spans: list[ConversationSpan], transcript: Transcript, role_map: dict[str, str]
) -> list[ConversationSpan]:
    """Make spans ordered, non-overlapping and covering every segment."""
    first_id, last_id = transcript.segments[0].id, transcript.segments[-1].id
    spans = sorted((s for s in spans if s.end_segment_id >= s.start_segment_id), key=lambda s: s.start_segment_id)
    fixed: list[ConversationSpan] = []
    cursor = first_id
    for span in spans:
        start = max(span.start_segment_id, cursor)
        end = min(span.end_segment_id, last_id)
        if end < start:
            continue
        if start > cursor and fixed:  # gap -> extend previous conversation
            fixed[-1] = fixed[-1].model_copy(update={"end_segment_id": start - 1})
        elif start > cursor:
            start = cursor
        fixed.append(span.model_copy(update={"start_segment_id": start, "end_segment_id": end}))
        cursor = end + 1
    if not fixed:
        speakers = transcript.speakers
        fixed.append(
            ConversationSpan(
                conversation_id=1,
                start_segment_id=first_id,
                end_segment_id=last_id,
                topic="whole recording",
                language="other",
                is_sales_interaction=any(role_map.get(s) == "salesperson" for s in speakers),
                salespeople=[s for s in speakers if role_map.get(s) == "salesperson"],
                customers=[s for s in speakers if role_map.get(s) == "customer"],
            )
        )
    elif cursor <= last_id:
        fixed[-1] = fixed[-1].model_copy(update={"end_segment_id": last_id})
    return [s.model_copy(update={"conversation_id": i + 1}) for i, s in enumerate(fixed)]


_SENTENCE_END = re.compile(r"(?<=[.!?؟])\s+")


def split_sentences(transcript: Transcript) -> Transcript:
    """One segment per sentence (time shared by text length) so a fix can move part of a diarizer segment."""
    out: list[Segment] = []
    for seg in transcript.segments:
        parts = [p for p in _SENTENCE_END.split(seg.text.strip()) if p]
        total = sum(len(p) for p in parts) or 1
        t = seg.start
        for p in parts or [seg.text]:
            end = t + seg.duration * len(p) / total
            out.append(Segment(id=len(out), speaker=seg.speaker, start=t, end=end, text=p))
            t = end
    return transcript.model_copy(update={"segments": out})


def repair_speakers(chain: LLMChain, transcript: Transcript, role_map: dict[str, str]) -> dict:
    """Ask a strong model which lines the diarizer attributed to the wrong person.

    Returns edits in the `apply_speaker_edits` shape: {"moves": {id: label}, "roles": {label: role}, "titles": {...}}.
    """
    if len(transcript.segments) < 4:
        return {}
    user = f"Speaker labels: {', '.join(transcript.speakers)}\n\nTranscript:\n{render_segments(transcript.segments, role_map)}"
    result, _ = chain.generate(step="speaker_repair", system=prompts.SPEAKER_REPAIR, user=user, schema=SpeakerRepair)
    ids = {s.id: s.speaker for s in transcript.segments}
    moves: dict[int, str] = {}
    roles: dict[str, str] = {}
    titles: dict[str, str] = {}
    for f in result.fixes:
        if f.segment_id not in ids or ids[f.segment_id] == f.speaker:
            continue
        moves[f.segment_id] = f.speaker
        if f.speaker not in role_map:
            roles[f.speaker] = f.role
            titles[f.speaker] = f.title or "Added automatically"
    return {"moves": moves, "roles": roles, "titles": titles}
