"""Live transcript preview: a few seconds of audio in, plain text out.

Only a preview while someone is recording. The saved recording is analysed afterwards by the normal pipeline,
which also works out who is speaking. Hindi is returned in English letters (Hinglish), like everywhere else.
"""

from __future__ import annotations

import logging
from typing import Any

import openai

from upsell_poc.config import Settings
from upsell_poc.romanize import known_words, romanize_text

log = logging.getLogger(__name__)

MAX_CLIP_BYTES = 3 * 1024 * 1024
CONTEXT_CHARS = 200

PROMPT = (
    "A sales conversation in a shop, in English, Hindi or Hinglish. Write Hindi words in English letters "
    "(Hinglish), never in Devanagari script. Write only the words spoken."
)


class LiveUnavailable(Exception):
    """The transcription service could not be reached or refused the clip."""


def transcribe_clip(settings: Settings, data: bytes, filename: str, context: str | None, client: Any = None) -> str:
    prompt = PROMPT
    if context and context.strip():
        prompt += f" The speech so far ended with: {context.strip()[-CONTEXT_CHARS:]}"
    try:
        client = client or openai.OpenAI(max_retries=1, timeout=30.0)
        result = client.audio.transcriptions.create(
            model=settings.live_transcribe_model,
            file=(filename, data),
            prompt=prompt,
            response_format="json",
        )
    except openai.OpenAIError as e:
        log.warning("live transcription failed: %s", e)
        raise LiveUnavailable(str(e)) from e
    return romanize_text((getattr(result, "text", "") or "").strip(), known_words())
