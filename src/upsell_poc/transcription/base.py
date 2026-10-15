"""Transcriber interface, stitching helpers and the fallback chain."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from upsell_poc.audio import Chunk
from upsell_poc.config import Settings, TranscriberConfig, TranscriptionConfig
from upsell_poc.schemas import CallLog, Segment, Transcript

log = logging.getLogger(__name__)


class Transcriber(Protocol):
    name: str
    model: str

    def transcribe(self, wav: Path, workdir: Path) -> Transcript: ...


def keep_chunk_segments(segments: list[Segment], chunk: Chunk) -> list[Segment]:
    """Drop segments that belong to a neighbouring chunk's overlap (midpoint rule).

    `segments` carry absolute times.
    """
    return [s for s in segments if chunk.keep_from <= (s.start + s.end) / 2 < chunk.keep_to]


def merge_adjacent(segments: list[Segment], max_gap: float = 0.8) -> list[Segment]:
    """Join consecutive segments from the same speaker separated by a short pause."""
    merged: list[Segment] = []
    for seg in sorted(segments, key=lambda s: s.start):
        if merged and merged[-1].speaker == seg.speaker and seg.start - merged[-1].end <= max_gap:
            last = merged[-1]
            merged[-1] = last.model_copy(
                update={"end": max(last.end, seg.end), "text": f"{last.text} {seg.text}".strip()}
            )
        else:
            merged.append(seg)
    return [s.model_copy(update={"id": i}) for i, s in enumerate(merged)]


def build_transcriber(cfg: TranscriberConfig, settings: Settings) -> Transcriber:
    if cfg.provider == "openai_diarize":
        from upsell_poc.transcription.openai_diarize import OpenAIDiarizeTranscriber

        return OpenAIDiarizeTranscriber(cfg)
    if cfg.provider == "aws_transcribe":
        from upsell_poc.transcription.aws_transcribe import AWSTranscribeTranscriber

        return AWSTranscribeTranscriber(cfg, settings)
    raise ValueError(f"unknown transcriber {cfg.provider}")


class TranscriptionChain:
    def __init__(self, transcribers: list[Transcriber], on_call: Callable[[CallLog], None] | None = None) -> None:
        self.transcribers = transcribers
        self.on_call = on_call

    def transcribe(self, wav: Path, workdir: Path) -> Transcript:
        errors: list[str] = []
        for index, t in enumerate(self.transcribers):
            started = time.monotonic()
            try:
                transcript = t.transcribe(wav, workdir)
            except Exception as e:  # noqa: BLE001 - any failure moves to the fallback
                log.exception("transcriber %s failed", t.name)
                errors.append(f"{t.name}: {e}")
                self._log(t, index, started, error=str(e)[:500])
                continue
            self._log(t, index, started)
            return transcript
        raise RuntimeError(f"all transcribers failed: {errors}")

    def _log(self, t: Transcriber, index: int, started: float, error: str | None = None) -> None:
        if self.on_call:
            self.on_call(
                CallLog(
                    step="transcription",
                    provider=t.name,
                    model=t.model or "-",
                    ok=error is None,
                    latency_s=round(time.monotonic() - started, 3),
                    error=error,
                    fallback_index=index,
                )
            )


def build_transcription_chain(
    cfg: TranscriptionConfig, settings: Settings, on_call: Callable[[CallLog], None] | None = None
) -> TranscriptionChain:
    return TranscriptionChain([build_transcriber(c, settings) for c in cfg.chain], on_call)
