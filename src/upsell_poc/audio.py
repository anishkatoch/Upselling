"""ffmpeg helpers: extraction, encoding, silence detection, chunk planning, clips."""

from __future__ import annotations

import base64
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16_000


class AudioError(RuntimeError):
    pass


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AudioError(f"{cmd[0]} failed: {proc.stderr[-2000:]}")
    return proc


def probe_duration(path: Path) -> float:
    proc = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)])
    return float(json.loads(proc.stdout)["format"]["duration"])


def extract_audio(src: Path, dst_wav: Path) -> Path:
    """Any video/audio file -> 16 kHz mono 16-bit WAV (the analysis master copy)."""
    dst_wav.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            str(dst_wav),
        ]
    )
    return dst_wav


def encode_for_asr(
    src_wav: Path, dst: Path, bitrate: str = "48k", start: float | None = None, end: float | None = None
) -> Path:
    """Compressed, level-normalized mono MP3 for speech APIs (keeps 1 h under 25 MB)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += [
        "-i",
        str(src_wav),
        "-af",
        "highpass=f=80,dynaudnorm=f=250:g=15",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-c:a",
        "libmp3lame",
        "-b:a",
        bitrate,
        str(dst),
    ]
    _run(cmd)
    return dst


def cut_wav(src_wav: Path, dst: Path, start: float, end: float) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(src_wav),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            str(dst),
        ]
    )
    return dst


def to_data_url(path: Path, mime: str = "audio/wav") -> str:
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


_SILENCE_START = re.compile(r"silence_start: (-?[\d.]+)")
_SILENCE_END = re.compile(r"silence_end: ([\d.]+)")


def detect_silences(wav: Path, noise_db: int = -35, min_silence: float = 0.4) -> list[tuple[float, float]]:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "info",
            "-i",
            str(wav),
            "-af",
            f"silencedetect=noise={noise_db}dB:d={min_silence}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    silences: list[tuple[float, float]] = []
    start: float | None = None
    for line in proc.stderr.splitlines():
        if m := _SILENCE_START.search(line):
            start = max(0.0, float(m.group(1)))
        elif (m := _SILENCE_END.search(line)) and start is not None:
            silences.append((start, float(m.group(1))))
            start = None
    return silences


@dataclass(frozen=True)
class Chunk:
    index: int
    start: float  # audio actually sent (includes overlap)
    end: float
    keep_from: float  # segments whose midpoint falls in [keep_from, keep_to) belong to this chunk
    keep_to: float


def plan_chunks(
    duration: float,
    silences: list[tuple[float, float]],
    chunk_seconds: float,
    overlap_seconds: float,
    search_window: float = 90.0,
) -> list[Chunk]:
    """Cut near every `chunk_seconds`, preferring the longest silence within the window."""
    if duration <= chunk_seconds * 1.1:
        return [Chunk(0, 0.0, duration, 0.0, duration)]

    cuts: list[float] = []
    target = chunk_seconds
    while target < duration - chunk_seconds * 0.25:
        window = [s for s in silences if abs((s[0] + s[1]) / 2 - target) <= search_window]
        if window:
            # Longest pause wins (to 0.1 s); among equals, the one closest to the target.
            best = max(window, key=lambda s: (round(s[1] - s[0], 1), -abs((s[0] + s[1]) / 2 - target)))
            cut = (best[0] + best[1]) / 2
        else:
            cut = target
        cuts.append(cut)
        target = cut + chunk_seconds

    bounds = [0.0, *cuts, duration]
    return [
        Chunk(
            index=i,
            start=max(0.0, bounds[i] - overlap_seconds),
            end=min(duration, bounds[i + 1] + overlap_seconds),
            keep_from=bounds[i],
            keep_to=bounds[i + 1] if i + 1 < len(bounds) - 1 else duration + 1,
        )
        for i in range(len(bounds) - 1)
    ]
