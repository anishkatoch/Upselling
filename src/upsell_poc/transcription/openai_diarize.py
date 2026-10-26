"""OpenAI gpt-4o-transcribe-diarize with chunking for long audio.

Long files are cut into ~20 minute chunks at silences (with a small overlap).
Chunk 0 is transcribed first; a clean clip of each of its main speakers (max 4)
is then passed as `known_speaker_references` to the remaining chunks so labels
stay consistent. Voices that still don't match get a chunk-prefixed label and
are merged later by the role-detection step.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import openai

from upsell_poc import audio
from upsell_poc.config import TranscriberConfig
from upsell_poc.schemas import Segment, Transcript
from upsell_poc.transcription.base import keep_chunk_segments, merge_adjacent

log = logging.getLogger(__name__)

MAX_KNOWN_SPEAKERS = 4
REF_MIN_S, REF_MAX_S = 2.0, 8.0
MIN_SPEAKER_TALK_S = 2.0


class OpenAIDiarizeTranscriber:
    def __init__(self, cfg: TranscriberConfig, client: openai.OpenAI | None = None) -> None:
        self.cfg = cfg
        self.model = cfg.model or "gpt-4o-transcribe-diarize"
        self.name = f"openai:{self.model}"
        self._client = client

    @property
    def client(self) -> openai.OpenAI:
        if self._client is None:
            self._client = openai.OpenAI(max_retries=3, timeout=900.0)
        return self._client

    def transcribe(self, wav: Path, workdir: Path) -> Transcript:
        workdir.mkdir(parents=True, exist_ok=True)
        duration = audio.probe_duration(wav)
        silences = audio.detect_silences(wav)
        chunks = audio.plan_chunks(duration, silences, self.cfg.chunk_minutes * 60, self.cfg.overlap_seconds)
        log.info("openai diarize: %.0fs audio in %d chunk(s)", duration, len(chunks))

        first = self._best_of(wav, workdir, chunks[0]) if len(chunks) == 1 else self._transcribe_chunk(wav, workdir, chunks[0], refs=None)
        refs = self._speaker_refs(wav, workdir, first)
        segments = keep_chunk_segments(first, chunks[0])

        if len(chunks) > 1:
            with ThreadPoolExecutor(max_workers=self.cfg.max_parallel_chunks) as pool:
                results = list(pool.map(lambda c: self._transcribe_chunk(wav, workdir, c, refs), chunks[1:]))
            for chunk, chunk_segments in zip(chunks[1:], results, strict=True):
                known = set(refs or {})
                for s in keep_chunk_segments(chunk_segments, chunk):
                    if s.speaker not in known:
                        s = s.model_copy(update={"speaker": f"c{chunk.index}_{s.speaker}"})
                    segments.append(s)

        return Transcript(
            duration=duration,
            segments=merge_adjacent(segments),
            provider=self.name,
            model=self.model,
            chunks=len(chunks),
        )

    def _best_of(self, wav: Path, workdir: Path, chunk: audio.Chunk) -> list[Segment]:
        """The model sometimes merges voices; repeat the call and keep the run with most speakers."""
        best: list[Segment] = []
        best_n = -1
        for _ in range(max(1, self.cfg.diarize_attempts)):
            segs = self._transcribe_chunk(wav, workdir, chunk, refs=None)
            talk: dict[str, float] = {}
            for s in segs:
                talk[s.speaker] = talk.get(s.speaker, 0.0) + s.duration
            n = sum(1 for t in talk.values() if t >= MIN_SPEAKER_TALK_S)
            if n > best_n:
                best, best_n = segs, n
        log.info("openai diarize: best of %d attempts has %d speakers", self.cfg.diarize_attempts, best_n)
        return best

    def _transcribe_chunk(
        self, wav: Path, workdir: Path, chunk: audio.Chunk, refs: dict[str, str] | None
    ) -> list[Segment]:
        mp3 = audio.encode_for_asr(
            wav, workdir / f"chunk_{chunk.index:03d}.mp3", self.cfg.mp3_bitrate, start=chunk.start, end=chunk.end
        )
        speakers: dict = {}
        if refs:
            speakers = {"known_speaker_names": list(refs), "known_speaker_references": list(refs.values())}
        with open(mp3, "rb") as f:
            response = self.client.audio.transcriptions.create(
                model=self.model,
                file=f,
                response_format="diarized_json",
                chunking_strategy="auto",
                **speakers,
            )
        out: list[Segment] = []
        for i, seg in enumerate(getattr(response, "segments", None) or []):
            text = (seg.text or "").strip()
            if not text:
                continue
            out.append(
                Segment(
                    id=i,
                    speaker=str(seg.speaker),
                    start=chunk.start + float(seg.start),
                    end=chunk.start + float(seg.end),
                    text=text,
                )
            )
        return out

    def _speaker_refs(self, wav: Path, workdir: Path, segments: list[Segment]) -> dict[str, str] | None:
        talk: dict[str, float] = {}
        for s in segments:
            talk[s.speaker] = talk.get(s.speaker, 0.0) + s.duration
        refs: dict[str, str] = {}
        for speaker in sorted(talk, key=talk.get, reverse=True)[:MAX_KNOWN_SPEAKERS]:  # type: ignore[arg-type]
            candidates = [s for s in segments if s.speaker == speaker and s.duration >= REF_MIN_S]
            if not candidates:
                continue
            best = max(candidates, key=lambda s: s.duration)
            clip = audio.cut_wav(
                wav, workdir / f"ref_{len(refs)}.wav", best.start, best.start + min(best.duration, REF_MAX_S)
            )
            refs[speaker] = audio.to_data_url(clip)
        return refs or None
