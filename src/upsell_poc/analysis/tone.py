"""Voice-tone labels from an audio-understanding model (OpenAI gpt-audio-1.5).

Optional evidence for mood: if it fails, mood is judged from words + acoustics.
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from collections.abc import Callable
from pathlib import Path

import openai
import pydantic

from upsell_poc import audio
from upsell_poc.analysis import prompts
from upsell_poc.analysis.formatting import render_segments
from upsell_poc.config import ToneModelConfig
from upsell_poc.cost import estimate_cost_usd
from upsell_poc.schemas import CallLog, Segment, ToneAnalysis, TurnTone

log = logging.getLogger(__name__)

_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)

ALLOWED_MOODS = ("happy", "calm", "neutral", "confused", "impatient", "irritated", "frustrated", "angry")

# The audio model is told to use exactly ALLOWED_MOODS but sometimes invents close words
# ("friendly", "curious", "satisfied", "playful" in real runs). Map those to the nearest allowed
# mood instead of discarding the whole answer; anything unknown becomes "neutral".
MOOD_SYNONYMS = {
    "happy": "friendly satisfied pleased cheerful excited enthusiastic positive warm amused playful joyful "
    "delighted appreciative grateful relieved optimistic upbeat laughing",
    "calm": "polite composed relaxed professional patient steady reassuring soft gentle courteous",
    "neutral": "curious interested inquisitive thoughtful attentive engaged indifferent flat formal businesslike "
    "skeptical serious reflective",
    "confused": "uncertain unsure hesitant puzzled doubtful perplexed",
    "impatient": "rushed hurried anxious nervous stressed tense restless eager",
    "irritated": "annoyed displeased dissatisfied disappointed bothered sarcastic defensive curt dismissive",
    "frustrated": "upset exasperated discouraged",
    "angry": "mad furious hostile aggressive rude outraged",
}
_MOOD_LOOKUP = {word: mood for mood, words in MOOD_SYNONYMS.items() for word in words.split()}


def normalize_mood(raw: object) -> str:
    word = str(raw or "").strip().lower()
    return word if word in ALLOWED_MOODS else _MOOD_LOOKUP.get(word, "neutral")


def parse_turns(content: str, valid_ids: set[int]) -> list[TurnTone]:
    """Tolerant parse of the model's JSON: one bad turn or mood word must not discard the rest."""
    match = _JSON_BLOCK.search(content)
    try:
        raw = json.loads(match.group(0) if match else content)
        items = raw["turns"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return []
    turns: list[TurnTone] = []
    for item in items if isinstance(items, list) else []:
        try:
            seg_id = int(item["segment_id"])
            if seg_id not in valid_ids:
                continue
            turns.append(
                TurnTone(
                    segment_id=seg_id,
                    speaker=str(item.get("speaker", "")),
                    mood=normalize_mood(item.get("mood")),  # type: ignore[arg-type]
                    intensity=max(1, min(5, int(item.get("intensity", 3)))),
                    vocal_cues=str(item.get("vocal_cues", "")),
                )
            )
        except (KeyError, TypeError, ValueError, AttributeError, pydantic.ValidationError):
            continue
    return turns


class ToneAnalyzer:
    def __init__(
        self,
        cfg: ToneModelConfig,
        client: openai.OpenAI | None = None,
        on_call: Callable[[CallLog], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self._client = client
        self.on_call = on_call

    def analyze(self, wav: Path, segments: list[Segment], workdir: Path) -> ToneAnalysis | None:
        if not segments:
            return None
        turns: list[TurnTone] = []
        for part in self._parts(segments):
            result = self._analyze_part(wav, part, workdir)
            if result is None:
                return None
            turns.extend(result.turns)
        return ToneAnalysis(turns=turns)

    def _parts(self, segments: list[Segment]) -> list[list[Segment]]:
        limit = self.cfg.max_clip_minutes * 60
        parts: list[list[Segment]] = [[]]
        for seg in segments:
            if parts[-1] and seg.end - parts[-1][0].start > limit:
                parts.append([])
            parts[-1].append(seg)
        return parts

    def _analyze_part(self, wav: Path, part: list[Segment], workdir: Path) -> ToneAnalysis | None:
        start, end = part[0].start, part[-1].end
        turns_text = render_segments(part, offset=start)
        started = time.monotonic()
        try:
            clip = audio.encode_for_asr(wav, workdir / f"tone_{part[0].id:05d}.mp3", "48k", start=start, end=end)
            if self._client is None:
                self._client = openai.OpenAI(max_retries=3, timeout=600.0)
            response = self._client.chat.completions.create(
                model=self.cfg.model,
                modalities=["text"],
                messages=[
                    {"role": "system", "content": prompts.TONE_LISTENING},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"Turns in this clip:\n{turns_text}"},
                            {
                                "type": "input_audio",
                                "input_audio": {"data": base64.b64encode(clip.read_bytes()).decode(), "format": "mp3"},
                            },
                        ],
                    },
                ],
            )
        except (audio.AudioError, openai.OpenAIError) as e:
            log.warning("tone analysis failed: %s", e)
            self._log(started, error=str(e)[:500])
            return None
        # The call happened and was billed whether or not the answer is usable: always record usage.
        usage = getattr(response, "usage", None)
        turns = parse_turns(response.choices[0].message.content or "", {s.id for s in part})
        if not turns:
            log.warning("tone analysis returned no usable turns")
            self._log(started, usage=usage, error="model answer contained no usable tone turns")
            return None
        self._log(started, usage=usage)
        return ToneAnalysis(turns=turns)

    def _log(self, started: float, usage: object | None = None, error: str | None = None) -> None:
        if self.on_call:
            input_tokens = getattr(usage, "prompt_tokens", None)
            output_tokens = getattr(usage, "completion_tokens", None)
            self.on_call(
                CallLog(
                    step="tone",
                    provider=f"openai:{self.cfg.model}",
                    model=self.cfg.model,
                    ok=error is None,
                    latency_s=round(time.monotonic() - started, 3),
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost_usd=estimate_cost_usd(self.cfg.model, input_tokens, output_tokens),
                    error=error,
                )
            )


def render(tone: ToneAnalysis | None) -> str:
    if not tone or not tone.turns:
        return "(not available)"
    return "\n".join(
        f"#{t.segment_id} {t.speaker}: {t.mood} (intensity {t.intensity}) - {t.vocal_cues}" for t in tone.turns
    )
