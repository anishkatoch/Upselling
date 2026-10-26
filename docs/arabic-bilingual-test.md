# Bilingual Arabic/English pipeline test (2026-10-26)

Test of the running app with synthetic Gulf-Arabic + English sales audio. Measured, not simulated, but on **clean TTS speech**: real shop audio (noise, overlap, dialect) will be worse. Treat every number as optimistic.

## Setup
- 7 voices from game-of-tones (`openai/gpt-4o-mini-tts`: onyx, echo, coral, ash, shimmer, fable, nova). 3 salespeople, 4 customers.
- 4 recordings in `testdata/arabic/audio/` with ground truth (`*.truth.json`): r1 electronics (3 speakers), r2 car showroom with a pushy upsell (2), r3 perfume boutique (2), r4 busy phone shop with 6 speakers in one recording (2 staff, 4 customers).
- Scripts: `gen_audio.py` (build), `eval.py` (WER, speakers, script mix), `ablate.py`, `ablate_mp3.py` (direct API experiments).
- App run live with an OpenAI key only (AWS login expired; dummy AWS creds, so Bedrock fallbacks were not exercised).
- Arabic text was hand-written by me and needs native review. WER is on normalised text (diacritics, alef/ya/ta-marbuta unified).

## Result 1: Arabic comes back romanised ("Arabizi") with the default config
`gpt-4o-transcribe-diarize` called with no language hint often returns Arabic in Latin letters ("Tammam, bil munaasabah..."). It is the model's own output, not `romanize.py` (Devanagari only).

| Recording | WER default | WER with quality pass | Arabic letters ref / default / quality pass |
|---|---|---|---|
| r1 electronics | 0.36 | **0.21** | 769 / 716 / 700 |
| r2 cars | 0.39 | **0.17** | 601 / 442 / 599 |
| r3 perfume | 0.24 | **0.14** | 427 / 441 / 431 |
| r4 busy shop | 0.75 | **0.23** | 632 / 215 / 653 |

r4 default output was mostly Latin letters (657 Latin vs 215 Arabic).

**Cause and fix.** The diarize model's script is unstable. The same r4 recording sent to the diarize model gave 442-502 Arabic letters in 4 calls on the original wav, 210 on a 16 kHz wav, and 359-519 in 3 calls on the app's 48k mp3 (input format did not explain it). Plain `gpt-4o-transcribe` was stable: 542-564 Arabic letters on 6 calls, with or without `language="ar"` or a prompt. The repo already has an optional per-turn re-transcription (`quality_pass` in `config/models.yaml`, off, model `gpt-transcribe`). **Change made: `enabled: true`, `model: gpt-4o-transcribe`** (uncommitted). I did not test the original id `gpt-transcribe`.

Side effect: English words inside Arabic sentences are sometimes written in Arabic script (Latin letters ref 113 vs 48 in r4; example: "Galaxy A56" became "جالكسي A13"). Product names and prices can be wrong. This is the next thing to look at.

## Result 2: Speaker separation is unstable and merges people
| Recording | True speakers | Detected (default run) | Detected (quality-pass run) |
|---|---|---|---|
| r1 | 3 | 2 | 2 |
| r2 | 2 | 1 | 1 |
| r3 | 2 | 2 | 2 |
| r4 | 6 | 3 | 5 |

- Direct API, same r4 audio: 6, 4, 5, 6 speakers on the original wav; 3 on a 16 kHz wav; 4, 3, 4 on the app's mp3. The model is non-deterministic here.
- `language="ar"` is no fix: r2 went 1 to 2 speakers but r1 went 3 to 4, and WER got worse on r1 and r2.
- UI effect (r2, observed): "1 voices", one "Salesperson", the customer's lines shown as the salesperson's, so "pushy after a no" is attributed to a person who also said the "no".
- Not tried: second pass with `known_speaker_references`, merging by voice embedding, retrying when speakers < expected.

## Result 3: Analysis on Arabic works and uses Arabic quotes
- Conversation splitting: r1 gave 2 conversations (correct), r4 gave 5 (true: 4 customers, one returning; reasonable).
- r2 upsell: default run reported 0 attempts but 1 pushy conversation (inconsistent). After the quality pass: 4 attempts, 1 pushy, 0 acceptance. Truth is about 3 attempts after refusals, all declined.
- r1: upgrade and warranty found, acceptance 0.5 (warranty accepted, Anker declined). r3: cross-sell accepted (correct).
- r4: 1 attempt found for salesperson A, 1 accepted for C. Truth has at least 4 offers (case, warranty, charger, gift box, some customer-requested). Only partly checked, no per-attempt scoring.
- Frustration (Sara, r1) was found with an Arabic quote.
- Language field on conversations shows "other" for these.

## Result 4: UI with these jobs (observed, port 8766)
1. **Dashboard shows "No data"** for freshly uploaded recordings. `/api/dashboard` puts them under `unassigned`, because the salesperson has no name. A demo upload of audio with nobody named looks broken.
2. **Conversations list shows "Not named" for every row**, no filename, only time. Four rows look identical.
3. Arabic renders, but in left-to-right bubbles: the full stop jumps to the left edge, and mixed lines ("Welcome to ... السدادي Motors") show scrambled word order. Needs `dir="auto"` or `bdi` per bubble.
4. Merged speakers show as one "Salesperson" (see Result 2).

## Not verified
- Real audio (phone/shop noise, overlapping speech, Najdi/Hijazi dialect). TTS speakers are all fluent and clean.
- Native-speaker review of the scripts and of the transcripts; WER depends on my reference text.
- Single runs per condition except where stated; no confidence intervals. The model varies run to run, so r1-r4 WER could move by several points.
- Whether `gpt-transcribe` (original config) exists; Amazon Transcribe `ar-SA` fallback; Bedrock models; cost and latency of the quality pass (one extra call per turn).
- Tone analysis (`gpt-audio-1.5`) on Arabic; acoustic measures.
- Data residency, consent, PDPL (see `docs/saudi-poc-review.md` #4).
- Whether the earlier greeting-rate mismatch (`saudi-poc-review.md` #5) is fixed; not examined.

## Suggested next fixes (small first)
1. Keep `quality_pass` on with `gpt-4o-transcribe` (done, uncommitted). Re-check English product names after it.
2. Add Arabic to `_TRANSCRIPT_NOTE` in `analysis/prompts.py` (names only Hindi today) and `ar-SA` to the Transcribe fallback languages.
3. Speaker merge: retry diarization when the speaker count looks low, or split segments by voice embedding.
4. UI: `dir="auto"` on transcript bubbles; show filename or industry when the salesperson is unnamed; let the dashboard include unassigned jobs or ask for a name on upload.
5. Native Arabic review of demo data and scripts before the client demo.

## Round 2 fixes (2026-10-26, same day) — uncommitted
Changes: `diarize_attempts: 3` (best-of-N by distinct speakers, single-chunk audio only; new `TranscriberConfig.diarize_attempts` and `_best_of` in `openai_diarize.py`); quality-pass `extra_params.prompt` telling the model to keep Arabic in Arabic script and English brand names/numbers in Latin; UI: `dir="auto"` + `unicode-bidi: plaintext` on transcript bubbles, filename shown under the name in the Conversations list, dashboard banner when conversations have no salesperson name.

Re-run of the 4 recordings (fresh server, port 8767, store3, one run each):

| Recording | WER before (quality pass) | WER now | Speakers true / before / now | Latin letters ref / before / now |
|---|---|---|---|---|
| r1 | 0.21 | **0.17** | 3 / 2 / 2 | 156 / n/a / 125 |
| r2 | 0.17 | **0.13** | 2 / 1 / 1 | 124 / n/a / 99 |
| r3 | 0.14 | **0.10** | 2 / 2 / 2 | 69 / n/a / 61 |
| r4 | 0.23 | **0.13** | 6 / 5 / 5 | 113 / n/a / 127 |

(Latin letters: ref = truth text, now = transcript; the per-recording "before" was not recorded, hence n/a.)

- **English loanword drift: improved, not proven fixed.** Latin letters now sit close to the reference in all four. I did not diff product names one by one (e.g. "Galaxy A56").
- **Speaker merging: NOT fixed.** Best-of-3 changed nothing on r1 (2 of 3) and r2 (1 of 2); r4 stayed 5 of 6. When the model merges two voices it does so consistently, so retrying does not help. Untried: voice-embedding / pitch split of merged segments, `known_speaker_references` from a first pass.
- **UI verified (DOM/page text, port 8767):** filenames visible in the list; dashboard banner reads "9 conversation(s) have no salesperson name yet…" (the Open Recordings link was not clicked, and naming from there was not tested); transcript bubbles have `dir="auto"` and `unicode-bidi: plaintext`. Not verified: visual look of mixed Arabic/English lines (no screenshot taken), narrow screens.
- **Pitch split of merged speakers: tried, rejected on evidence.** Per-segment pitch (`estimate_pitch`) did not separate the merged voices reliably, so no code was written. A real fix needs word timestamps plus a voice-embedding model, or a manual relabel/split UI. Not built.
- **Voice-embedding split (breaking-silence models): tested, not built.** Turn-level test with exact turn boundaries from the generator (so it excludes diarisation errors), clustering with the true speaker count, NeMo TitaNet-small via sherpa-onnx (from `accelerators/breaking-silence`): r1 65%, r2 53% (about chance), r3 100%, r4 100% of turns. TitaNet-large and WeSpeaker (English) scored the same or worse on r1 and r3/r4 where measured. Cosine, same-speaker mean vs different-speaker mean: r1 0.75 vs 0.46, r2 0.62 vs 0.63, r3 0.69 vs 0.46, r4 0.73 vs 0.40. Cases the diarize model merges (r1 Faisal/Abdullah, r2 Khalid/Mansour; similar male TTS voices) are the ones embeddings also cannot separate, and same-speaker minimums (0.27-0.64) overlap other-speaker maxima, so a threshold split would also split single speakers. Whole-file sherpa diarisation gave r1 3 speakers, r2 1 (1.6 s for the second), r3 2, r4 6 but fragmented. Limits: synthetic voices only; real people differ more, unmeasured; English-trained embeddings on Arabic; wespeaker/titanet-large measured on r1,r3,r4 only partly (r2/r4 turn split had mismatches in earlier runs).
- **Rename to SouqCue (UI only):** two-colour wordmark ("Souq" amber `#f5b84a`, "Cue" `#a5a8ff`) in nav and auth pages, page title, aria-label. Demo login (`demo@salesiq.app`) kept so existing logins and tests still work; the three review docs keep "SalesIQ" as history. README, favicon and sample data have no SalesIQ text (grepped).
- Cost: diarize now runs up to 3x per short file, plus one transcribe call per turn. Not measured.
- `npm run build` and `tsc -b` passed. Python tests not run.

## Automatic speaker repair (built, 2026-10-26) — uncommitted
The manual "Fix speakers" UI and its endpoint were removed (user wants automatic correction). Replacement: new LLM step `speaker_repair` (`analysis/structure.repair_speakers`, prompt `SPEAKER_REPAIR`, `llm.steps.speaker_repair` effort high, `enabled` flag per step). After role detection and merge, a strong model reads the numbered transcript and returns only lines with the wrong speaker, plus new labels with role and title. Fixes feed `pipeline.apply_speaker_edits`; result cached in `cache/<sha>/repair-<fp>.json`; on any error the diarizer labels are kept. A user-edits file, if present, still applies on top.

Re-run of the 4 recordings through the server (port 8767, one run each, model chain = OpenAI first):

| Recording | True speakers | Before | Now |
|---|---|---|---|
| r1 | 3 | 2 | **3** |
| r2 | 2 | 1 | **2** |
| r3 | 2 | 2 | 2 (no moves, correct) |
| r4 | 6 | 5 | 5 (Sara/Lama still one label) |

Not verified / known limits:
- Segment-level only: a diarizer segment that holds two people's words (r2 lines such as customer refusal plus salesperson reply) stays under one label. Fix idea: split segments by sentence before repair, or word timestamps.
- r4 merged pair (Sara and Lama) not separated; the model moved only some lines.
- Upsell numbers after repair were not scored against truth (r2 shows 4 attempts; truth about 3, all declined).
- Content-based only: two same-role people who never interact in contrast (for example two customers in a row with no dialogue clue) can stay merged. Real audio untested.
- Cost: one extra high-effort LLM call per recording; not measured. Prompt sees the whole transcript, so very long recordings may need chunking (not built).
- Offline check on cached transcripts matched the server run for r1, r2, r4.

### Sentence-split before repair (2026-10-26, PROMPT_VERSION .2)
`structure.split_sentences` cuts diarizer segments at `. ! ? ؟`, sharing time by text length. Repair runs on sentences, then `merge_adjacent` (gap 0.8 s) rejoins same-speaker neighbours. Re-run via server, one run each:

| Recording | True speakers | Segment-level | Sentence-split |
|---|---|---|---|
| r1 | 3 | 3 | **3** (2 conversations) |
| r2 | 2 | 2 | **2** (1 conversation) |
| r3 | 2 | 2 | **2** |
| r4 | 6 | 5 | **6** (5 conversations; truth 4 customers, Abdullah returns) |

Tests: full suite has 21 failures, all FileNotFoundError (missing `frontend/src/data/*.json`, pre-existing). One more fails only without dummy AWS env vars (botocore credential provider); passes with them.

Not verified:
- Speaker counts only. Per-line accuracy (which sentence went to which person) not scored against truth.
- Upsell attempt counts not scored against truth; r4 splits Abdullah into two conversations.
- One run each; LLM output varies. Real audio, overlapping speech and long recordings (chunking) untested. Extra LLM call cost not measured.
- No unit test yet for `split_sentences`.
