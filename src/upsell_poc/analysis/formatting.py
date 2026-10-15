"""Render transcript segments as compact text for prompts."""

from __future__ import annotations

from collections.abc import Iterable

from upsell_poc.schemas import Segment


def fmt_time(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def render_segments(segments: Iterable[Segment], roles: dict[str, str] | None = None, offset: float = 0.0) -> str:
    lines = []
    for s in segments:
        label = s.speaker if not roles else f"{s.speaker} ({roles.get(s.speaker, 'unknown')})"
        lines.append(f"[#{s.id} {fmt_time(s.start - offset)}-{fmt_time(s.end - offset)} {label}] {s.text}")
    return "\n".join(lines)
