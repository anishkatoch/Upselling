"""Per-turn voice measurements (CPU only): loudness, pitch, speaking rate, interruptions.

Values are turned into z-scores against each speaker's own median so a naturally loud
speaker isn't read as angry.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import soundfile as sf

from upsell_poc.schemas import AcousticTurn, Segment

log = logging.getLogger(__name__)

MAX_PITCH_WINDOW_S = 15.0
F0_MIN, F0_MAX = 65.0, 400.0


def estimate_pitch(clip: np.ndarray, sr: int, frame_s: float = 0.04) -> float | None:
    """Median F0 of voiced frames via normalized autocorrelation (numpy only)."""
    frame = int(frame_s * sr)
    lag_min, lag_max = int(sr / F0_MAX), int(sr / F0_MIN)
    if clip.size < frame or frame <= lag_max:
        return None
    frames = clip[: clip.size // frame * frame].reshape(-1, frame)
    energy = np.sqrt((frames**2).mean(axis=1))
    threshold = max(1e-4, float(np.percentile(energy, 60)) * 0.5)
    f0s: list[float] = []
    for f, e in zip(frames, energy, strict=True):
        if e < threshold:
            continue
        f = f - f.mean()
        ac = np.correlate(f, f, mode="full")[frame - 1 :]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        lag = lag_min + int(np.argmax(ac[lag_min:lag_max]))
        if ac[lag] > 0.3:  # voiced enough
            f0s.append(sr / lag)
    return round(float(np.median(f0s)), 1) if f0s else None


def _robust_z(values: list[float | None]) -> list[float | None]:
    arr = np.array([v for v in values if v is not None], dtype=float)
    if arr.size < 3:
        return [None] * len(values)
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median))) * 1.4826 or float(arr.std()) or 1.0
    return [None if v is None else round((v - median) / mad, 2) for v in values]


def measure(wav: Path, segments: list[Segment]) -> list[AcousticTurn]:
    y, sr = sf.read(str(wav), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)

    turns: list[AcousticTurn] = []
    previous: Segment | None = None
    for seg in sorted(segments, key=lambda s: s.start):
        a, b = int(seg.start * sr), int(seg.end * sr)
        clip = y[a:b]
        loudness = pitch = None
        if clip.size > sr * 0.2:
            rms = float(np.sqrt(np.mean(clip**2)))
            loudness = round(20 * np.log10(rms + 1e-9), 2)
            pitch = estimate_pitch(clip[: int(MAX_PITCH_WINDOW_S * sr)], sr)
        words = len(seg.text.split())
        rate = round(words / seg.duration, 2) if seg.duration > 0.5 else None
        interrupted = bool(previous and previous.speaker != seg.speaker and seg.start < previous.end - 0.2)
        turns.append(
            AcousticTurn(
                segment_id=seg.id,
                speaker=seg.speaker,
                loudness_db=loudness,
                pitch_hz=pitch,
                words_per_sec=rate,
                interrupted_other=interrupted,
            )
        )
        if previous is None or seg.end > previous.end:
            previous = seg

    by_speaker: dict[str, list[int]] = {}
    for i, t in enumerate(turns):
        by_speaker.setdefault(t.speaker, []).append(i)
    for idx in by_speaker.values():
        for field, zfield in (("loudness_db", "loudness_z"), ("pitch_hz", "pitch_z"), ("words_per_sec", "rate_z")):
            zs = _robust_z([getattr(turns[i], field) for i in idx])
            for i, z in zip(idx, zs, strict=True):
                setattr(turns[i], zfield, z)
    return turns


def render(turns: list[AcousticTurn]) -> str:
    lines = ["segment_id | speaker | loudness_z | pitch_z | rate_z | interrupted_other"]
    for t in turns:
        lines.append(
            f"{t.segment_id} | {t.speaker} | {t.loudness_z} | {t.pitch_z} | {t.rate_z} | "
            f"{'yes' if t.interrupted_other else 'no'}"
        )
    return "\n".join(lines)
