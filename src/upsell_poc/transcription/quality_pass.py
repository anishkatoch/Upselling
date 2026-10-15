"""Optional: re-transcribe each speaker turn with gpt-transcribe for cleaner text.

Speaker labels and timings come from the diarized transcript; only `text` changes.
A failed turn keeps its original text.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import openai

from upsell_poc import audio
from upsell_poc.config import QualityPassConfig
from upsell_poc.schemas import Segment, Transcript

log = logging.getLogger(__name__)


def improve_text(
    transcript: Transcript, wav: Path, workdir: Path, cfg: QualityPassConfig, client: openai.OpenAI | None = None
) -> Transcript:
    client = client or openai.OpenAI(max_retries=3, timeout=300.0)
    workdir.mkdir(parents=True, exist_ok=True)

    def redo(seg: Segment) -> Segment:
        if seg.duration < cfg.min_segment_seconds:
            return seg
        try:
            clip = audio.encode_for_asr(
                wav, workdir / f"turn_{seg.id:05d}.mp3", "48k", start=max(0.0, seg.start - 0.15), end=seg.end + 0.15
            )
            with open(clip, "rb") as f:
                result = client.audio.transcriptions.create(
                    model=cfg.model, file=f, extra_body=cfg.extra_params or None
                )
            text = (getattr(result, "text", "") or "").strip()
            return seg.model_copy(update={"text": text}) if text else seg
        except Exception:  # noqa: BLE001
            log.warning("quality pass failed for segment %s; keeping original", seg.id, exc_info=True)
            return seg

    with ThreadPoolExecutor(max_workers=cfg.max_parallel) as pool:
        segments = list(pool.map(redo, transcript.segments))
    return transcript.model_copy(update={"segments": segments, "model": f"{transcript.model}+{cfg.model}"})
