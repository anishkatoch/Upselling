# Arabic / English-Arabic transcription: findings

Date: 2026-10-26. Branch: dev. Status: **BLOCKED for live calls. No WER, diarization or Arabic-script result was measured.** This file is a code audit plus a run plan.

## Why blocked

Checked, with no key values printed:

| Item | Result |
|---|---|
| `OPENAI_API_KEY` in shell env | not set |
| `/Users/sookieai/Documents/code/Upselling/.env` | file does not exist (only `.env.example`) |
| `~/.config/openai` | does not exist |
| AWS env vars (`AWS_ACCESS_KEY_ID` etc.) | not set |
| `aws sts get-caller-identity` (default profile) | `Your session has expired. Please reauthenticate using 'aws login'.` |
| `S3_BUCKET` / `TRANSCRIBE_S3_BUCKET` | not configured (Amazon Transcribe path needs one) |
| Local tools | `ffmpeg`, `say`, `aws` CLI present |

I did not guess results. I also did not make the code change, because it cannot be tested without the keys.

## What blocks Arabic (code audit, from reading the files)

**Transcription stage**

| File:line | Finding | Blocks Arabic? |
|---|---|---|
| `src/upsell_poc/transcription/openai_diarize.py` (`_transcribe_chunk`) | Calls `audio.transcriptions.create` with no `language` and no `prompt`, so the model auto-detects. Nothing Hindi-specific here. | No code block. Whether `gpt-4o-transcribe-diarize` handles Arabic and code-switching is **unverified**. |
| `src/upsell_poc/config.py:95` | `TranscriberConfig.languages` default `["en-IN", "hi-IN"]` | Yes, for the AWS fallback only |
| `config/models.yaml:15` | `languages: [en-IN, hi-IN]` on the `aws_transcribe` chain entry | Yes, for the AWS fallback only |
| `src/upsell_poc/transcription/aws_transcribe.py:48-49` | `IdentifyMultipleLanguages=True` with `LanguageOptions=cfg.languages`. Code-switching inside one call is not what this does; it picks languages per segment. Whether `ar-SA` is allowed in a multi-language set is unverified. | Config change, and possibly a mode change |
| `src/upsell_poc/transcription/aws_transcribe.py:1` | Docstring only says en-IN/hi-IN | No (cosmetic) |
| `src/upsell_poc/transcription/quality_pass.py` | No language setting. Off by default (`models.yaml`). | No |

**Post-processing and analysis**

| File:line | Finding | Blocks Arabic? |
|---|---|---|
| `src/upsell_poc/romanize.py:25` | `DEVANAGARI` regex only matches Devanagari. Arabic script passes through untouched, no LLM call, no corruption. | No. Arabic is not romanized, so the UI shows Arabic script as returned. Whether you want transliteration is a product decision. |
| `src/upsell_poc/pipeline.py:213, 316-320` | Always calls `romanize_*`. A no-op for Arabic. | No |
| `src/upsell_poc/analysis/prompts.py:7` | `_TRANSCRIPT_NOTE` says speech is "English, Hindi (Devanagari or Roman script) or Hinglish". Claude will probably still read Arabic, but the prompt does not say so. | Soft block. Edit to add Arabic. |
| `src/upsell_poc/analysis/prompts.py:56` | `language:` field lists "english, hindi, hinglish or other". | Soft block. Arabic would come back as "other". |
| `src/upsell_poc/schemas.py:48` | `Language = Literal["english", "hindi", "hinglish", "other"]` | Soft block. Add `"arabic"`, `"arabic_english"`. Check frontend uses of this enum first. |
| `src/upsell_poc/analysis/prompts.py:148, 175` | Tone and mood prompts say "English, Hindi or Hinglish". Tone model is disabled in `models.yaml`. | Soft block (mood prompt is live) |
| `src/upsell_poc/live.py:23-24` | Live-mode `PROMPT` tells the transcriber to write Hindi in English letters, never Devanagari. This is passed as a transcription prompt, so it biases output. | Yes for live mode. Needs an Arabic/English prompt. |
| `src/upsell_poc/llm` chain | Claude on Bedrock handles Arabic text in general. Quote-matching against segments (exact-quote, `segment_id`) is **unverified** for Arabic: diacritics, tatweel and RTL punctuation can break exact matches. | Unverified |

**Test-data scripts** (not for this change; other session owns `sample_data/`): `scripts/generate_test_data.py:38,51,93` and `scripts/build_sample_data.py:117` hard-code Hindi/Hinglish and an "Indian accent" TTS instruction.

## Minimum change to enable Arabic (proposed, NOT applied)

1. `config/models.yaml:15`: `languages: [ar-SA, en-US]` (or `en-IN`). Re-test whether `IdentifyMultipleLanguages` accepts the pair; fall back to two single-language runs if not.
2. `src/upsell_poc/config.py:95`: change the default to match.
3. `src/upsell_poc/analysis/prompts.py:7`: add Arabic to the language sentence. `prompts.py:56`: add `arabic`. `prompts.py:148,175`: same.
4. `src/upsell_poc/schemas.py:48`: add `"arabic"`.
5. `src/upsell_poc/live.py:23-24`: replace the Hinglish prompt with an English/Arabic one.
6. Frontend: check RTL rendering of transcripts (other session owns `frontend/`).

Steps 1-2 are needed for the AWS fallback only. If OpenAI handles Arabic, the primary path may work with step 3-5 alone.

## Run plan once keys exist

Needs: `OPENAI_API_KEY`; `aws login` (or SSO) plus an S3 bucket for Transcribe.

1. Make `testdata/arabic/` with three clips and ground-truth text, 60-90 s each, two speakers, retail dialogue with a clear upsell:
   - `ar_only` (Saudi-style Arabic), `en_only`, `mixed` (Arabic/English code-switching).
   - TTS: `gpt-4o-mini-tts` with two different voices, or `say -v Majed|Maged|Tarik` (check `say -v '?' | grep ar_`). Concatenate turns with `ffmpeg`. Record the exact turn timings so diarization can be scored.
2. Transcription stage only, bypassing the pipeline:

```bash
cd /Users/sookieai/Documents/code/Upselling
uv run python -c "
from pathlib import Path
from upsell_poc.config import TranscriberConfig
from upsell_poc.transcription.openai_diarize import OpenAIDiarizeTranscriber
t = OpenAIDiarizeTranscriber(TranscriberConfig(provider='openai_diarize'))
r = t.transcribe(Path('testdata/arabic/mixed.wav'), Path('testdata/arabic/work'))
print(r.model_dump_json(indent=1))
"
```

3. AWS: same with `AWSTranscribeTranscriber` and `languages=['ar-SA','en-US']`; also a plain single-language `ar-SA` job on `ar_only`.
4. WER: normalize both sides (strip diacritics/tatweel, unify alef/ya/ta-marbuta forms, remove punctuation, lowercase Latin), then word-level edit distance (`jiwer`). Report Arabic-token and English-token WER separately for `mixed`.
5. Diarization: compare predicted speaker per segment against the known turn timings; report speaker count and turn-level accuracy.

## Caveats for when numbers exist

TTS audio is clean, single-accent and has no room noise or overlap. WER from it will be optimistic, and the Saudi dialect coverage of TTS voices is limited. One third-party paper reports 66% WER for gpt-4o-transcribe on Saudi TV audio (see `docs/saudi-poc-review.md:25`; not checked against the PDF).

## NOT VERIFIED

- Any WER figure, for any clip, any provider.
- Whether `gpt-4o-transcribe-diarize` accepts Arabic or code-switched audio, and whether it separates two speakers.
- Whether Arabic script returns correct and in order (RTL ordering inside mixed lines).
- Whether Amazon Transcribe `ar-SA` works with `IdentifyMultipleLanguages` alongside English.
- Whether Claude's role/mood/upsell steps and exact-quote matching work on Arabic text.
- Whether TTS voices for Saudi Arabic exist locally (`say -v '?'` not run).
- Real shop-floor audio accuracy, in any form.
- No code was changed; the proposed edits above are untested.
