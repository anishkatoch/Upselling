# Speaker Diarization & Upsell Detection — POC Plan

## 1. Problem Statement

Build a POC that takes a sales recording and tells you, for each salesperson, whether they tried to upsell and how hard they tried.

1. **Input:** a video or audio file of any length, from 5 minutes to over an hour. If it's a video, the audio is extracted first.
2. **Speakers:** work out how many people are talking and who said what, with timestamps.
3. **Transcript:** the text, split by speaker. The language can be **English, Hindi or a mix of both (Hinglish)**, detected automatically, and one recording can hold several separate customer conversations on different topics.
4. **Upsell analysis:** for each conversation, find whether the salesperson actively pushed something extra. Examples: "Sir, take this too, together it's only 80 instead of 100", a combo offer, an upgrade, a warranty, a discount if they add an item.
5. **What doesn't count:** the customer asks for X and the salesperson gives X. That's fulfilling a request, not upselling. If the salesperson just says "buy this" and the customer buys it, that's a normal sale too, not an upsell.
6. **Output per salesperson:** how many upsell attempts, what share of conversations had one, and how much effort they put in (did they try again after a "no", how many techniques they used, how much talk time went to it).

---

## 2. Constraints & Decisions

| Topic | Answer | What it means for the design |
|---|---|---|
| Languages | English, Hindi, Hinglish | Use a transcription service with automatic language detection and code-switching support. |
| Speakers | Any number; there may be several salespeople, one, or none | Each speaker is classified as salesperson / customer / other. Recordings with no sales conversation are marked as such and skipped. |
| Data privacy | No restriction; pick the most accurate option | Use the best cloud APIs for transcription, diarization and analysis. |
| Hardware | No GPU | No self-hosted models. Everything heavy runs on cloud APIs; our server only runs ffmpeg and Python glue code (a normal CPU machine or laptop is enough). |
| Real recordings | None available | Build a synthetic test set with known ground truth (see Section 7). |
| Industry | Any industry | Upsell rules are generic (industry-agnostic). The LLM infers products from context. An optional product catalog can be supplied later to improve accuracy. |

---

## 3. Pipeline

```
Video/Audio (any length)
   │  ffmpeg (CPU) → extract audio, convert to compressed mono (e.g. 16kHz FLAC/MP3)
   ▼
1. Cloud transcription + diarization (one API call)
      → words + timestamps + speaker labels (speaker_A, speaker_B, ...)
      → automatic language detection: English / Hindi / Hinglish
   ▼
2. Role detection (LLM)
      → each speaker = SALESPERSON / CUSTOMER / OTHER
      → handles 0, 1 or many salespeople
   ▼
3. Conversation splitting (LLM + silence gaps)
      → break a long recording into separate customer interactions
      → mark segments with no sales activity
   ▼
4. Upsell detection (LLM, structured JSON)
      → each attempt, its technique, exact quote and timestamp
   ▼
5. Scoring
      → per-conversation and per-salesperson metrics
   ▼
6. Report / dashboard
```

---

## 4. Models, Fallbacks & Retry Setup (OpenAI + AWS Bedrock)

**Providers:**
- **OpenAI:** speech-to-text with speaker diarization, plus a cross-provider fallback for the LLM steps.
- **AWS Bedrock:** Claude Sonnet as the main LLM for all analysis.
- **Amazon Transcribe:** the speech fallback. It runs in the same AWS account, so there is no extra vendor.

> Model IDs were checked on 2026-10-12. Confirm them before coding: list OpenAI models with `GET /v1/models`, and check that each model is enabled in the Bedrock console for your region.

### 4.1 Model per pipeline step

| Step | Primary | Fallback 1 | Fallback 2 | Settings |
|---|---|---|---|---|
| **Transcription + diarization** | OpenAI `gpt-4o-transcribe-diarize` | Amazon Transcribe (speaker labels + language ID for `en-IN` / `hi-IN`) | — | `response_format: diarized_json`, `chunking_strategy: auto` |
| Transcript quality pass *(only if needed)* | OpenAI `gpt-transcribe` | — | — | Use only if the Phase 1 benchmark shows weak Hinglish text from the diarize model. It re-transcribes each speaker turn and keeps the diarize model's speaker labels. |
| **Role detection** | OpenAI `gpt-6.1-sol` | Bedrock `anthropic.claude-sonnet-5-5` | Same model in a second AWS region | effort `low` |
| **Conversation splitting** | OpenAI `gpt-6.1-sol` | Bedrock `anthropic.claude-sonnet-5-5` | Same model in a second AWS region | effort `medium` |
| **Upsell detection** | OpenAI `gpt-6.1-sol` | Bedrock `anthropic.claude-sonnet-5-5` | Same model in a second AWS region | effort `high`. Low-confidence results are escalated to `anthropic.claude-opus-5-5` (see 4.2). |
| Test script generation (Phase 0) | OpenAI `gpt-6.1-sol` | Bedrock `anthropic.claude-sonnet-5-5` | — | effort `medium` |
| Test audio (TTS, Phase 0) | OpenAI TTS | Amazon Polly (has Hindi voices) | — | One voice per speaker |

### 4.2 Why these models

- **`gpt-4o-transcribe-diarize`** is OpenAI's only model that labels speakers. It can also match voices to up to 4 known speakers from short reference clips, which keeps speaker labels consistent across chunks (see 4.3). OpenAI's docs don't confirm Hindi quality for this model, so this is the **first thing tested in Phase 1**. If Hindi or Hinglish is weak, Amazon Transcribe becomes the primary.
- **`gpt-transcribe`** is OpenAI's recommended model for the most accurate transcription, but it gives no speaker labels. That's why it's only an optional second pass on the text.
- **Amazon Transcribe** handles a whole file of up to 4 hours in one job, with no chunking. It supports speaker labels, Hindi and Indian English. It also keeps the pipeline working when OpenAI is down.
- **Claude Sonnet 5.5 on Bedrock** has a 1M-token context, so a 1-hour transcript (about 20–30K tokens) fits easily. It reads Hinglish directly and supports structured JSON output, and it costs about half as much as Opus.
- **Claude Opus 5.5 escalation:** if Sonnet marks an upsell decision as low confidence (below 0.6), only that conversation is re-run on Opus. This adds accuracy on hard cases without paying Opus prices for everything. Phase 5 also runs Opus on the full test set as a comparison.
- **`gpt-6.1-sol`** is the cross-provider fallback: near flagship quality at lower cost. Because it's a different company's model, an outage at AWS doesn't stop the pipeline.

### 4.3 Long audio with OpenAI (25 MB limit)

1. ffmpeg converts the audio to **mono 16 kHz MP3 at 32–48 kbps**. One hour comes to about 15–22 MB.
2. The audio is split into **chunks of about 20 minutes**, cut at silences, with about 2 seconds of overlap. This stays under OpenAI's per-request limits; third parties report a duration cap of about 23 minutes on the diarize model.
3. **Keeping speaker labels consistent across chunks:** after chunk 1, cut a clean 5–8 second clip of each speaker. Pass these clips as `known_speaker_references` (maximum 4) when transcribing later chunks.
4. If there are more than 4 speakers, or a voice isn't matched, an LLM step reconciles the labels from content and timing.
5. Chunks are transcribed in parallel (3–4 at a time) and then stitched together, removing words duplicated in the overlap.
6. **Fallback path:** Amazon Transcribe takes the whole file in one job, so there's no stitching.

### 4.4 Retry policy

Who retries what:
- **The SDKs handle transient retries.** Both the Anthropic SDK and the OpenAI SDK have built-in retry with backoff; set `max_retries=3`.
- **Our wrapper handles model fallback and JSON repair.** It does not add its own retry loop on top of the SDK's, because the two would multiply.

| Error | Action |
|---|---|
| 429 rate limit | Retry, honour the `retry-after` header, otherwise exponential backoff with jitter (about 2s, 4s, 8s, capped at 30s). Then move to the next model in the chain. |
| 5xx / overloaded / timeout / connection error | Same as above. |
| 400 / 401 / 403 / 404 | **No retry.** This is a config or code bug: fail fast and log an alert. |
| 413 file too large | Re-chunk smaller and retry. |
| Invalid JSON or schema mismatch | Make one repair retry on the same model with the validation error included, then move to the next model in the chain. |
| `stop_reason: refusal` | Go straight to the next model in the chain. |
| `stop_reason: max_tokens` | Retry with a higher `max_tokens`, or split the conversation into smaller parts. |
| Whole chain fails | Mark that stage `failed`. The job can be resumed later from that stage. |

**Circuit breaker:** if a provider fails 5 times within 2 minutes, skip it for 5 minutes and go straight to the fallback.

**Timeouts:** 15 minutes per transcription chunk. LLM calls use streaming with a 10-minute timeout.

### 4.5 Reliability setup

- **Stage checkpoints:** each stage's output is saved as JSON, keyed by `file hash + stage + model + prompt version`. A failed or re-run job resumes from the failed stage and never pays for transcription twice.
- **Async jobs:** an upload returns a job ID, a background worker processes it, and the UI polls for status. For the POC this is FastAPI plus a simple worker (RQ + Redis, or a database-backed queue).
- **Parallelism:** up to 3–4 transcription chunks and up to 5 conversations analyzed at the same time.
- **Same output format on every model:** one JSON schema (as Pydantic models) is used for both providers.
  - Claude gets it through `output_config.format`.
  - OpenAI gets it through structured outputs (`json_schema`).
  - A fallback model's answer therefore has exactly the same shape.
  - Every response is validated before it's saved.
- **Prompt caching:** the long, fixed system prompt with the upsell rules is cached on Bedrock, which cuts cost and latency on repeated calls.
- **Traceability:** every result records the provider, model ID, prompt version, and whether a fallback was used.
- **Logging per call:** provider, model, latency, input/output tokens, retries, fallback used, estimated cost.

### 4.6 Claude Sonnet 5.5 on Bedrock: implementation notes

- Use the Bedrock **Mantle** client (`AnthropicBedrockMantle(aws_region=...)` in the `anthropic` Python SDK) with model ID `anthropic.claude-sonnet-5-5`. A plain `claude-sonnet-5-5` ID without the prefix fails on Bedrock.
- Control depth with `output_config.effort`: `low`, `medium` or `high`. Thinking is adaptive by default; leave it on.
- **Do not send** `temperature`, `top_p`, `thinking: {type: "disabled"}`, forced `tool_choice`, or assistant prefill. Sonnet 5.5 rejects all of these with a 400. Use `output_config.format` for JSON.
- Server-side fallbacks are not available on Bedrock, so model fallback lives in our wrapper (section 4.4).
- Use two clients in two regions (for example `us-east-1` and `us-west-2`) for the region fallback. Check which regions have Sonnet 5.5 enabled; `ap-south-1` (Mumbai) is preferred for latency if it's available.

### 4.7 Example config

```yaml
transcription:
  primary:   { provider: openai, model: gpt-4o-transcribe-diarize, chunk_minutes: 20, overlap_seconds: 2 }
  fallback:  { provider: aws_transcribe, languages: [en-IN, hi-IN], max_speakers: 10 }
  quality_pass: { enabled: false, provider: openai, model: gpt-transcribe }

llm:
  sdk_max_retries: 3
  timeout_seconds: 600
  circuit_breaker: { failures: 5, window_seconds: 120, cooldown_seconds: 300 }
  chain:
    - { provider: openai,  model: gpt-6.1-sol }
    - { provider: bedrock, model: anthropic.claude-sonnet-5-5, region: us-east-1 }
    - { provider: bedrock, model: anthropic.claude-sonnet-5-5, region: us-west-2 }
  steps:
    role_detection:         { effort: low }
    conversation_splitting: { effort: medium }
    upsell_detection:       { effort: high, escalate_below_confidence: 0.6,
                              escalation_model: { provider: bedrock, model: anthropic.claude-opus-5-5 } }
```

---

## 5. Key Steps in Detail

### 5.1 Long audio (1 hour or more)
- Audio is compressed and split into chunks of about 20 minutes for OpenAI. Speaker labels are kept consistent with known-speaker reference clips (see 4.3).
- The Amazon Transcribe fallback takes the whole file in one job.
- Expected processing time: a few minutes per hour of audio, all on the providers' side.

### 5.2 English, Hindi and Hinglish
- The transcription API detects language automatically and handles switching mid-sentence.
- The transcript is kept as-is (English, Devanagari or Romanized Hindi). Claude reads all three directly, so no translation step is needed.
- Output reports are in English, with original-language quotes as evidence.

### 5.3 Role detection (0, 1 or many salespeople)
- Diarization only gives anonymous labels; it doesn't know who the salesperson is.
- The LLM classifies every speaker from what they say: explaining products, quoting prices and asking "anything else, sir?" means salesperson.
- **Several salespeople:** each one gets a separate score.
- **No salesperson / no sales talk:** the recording or segment is marked `no_sales_interaction` and excluded from scores.
- **Naming salespeople across recordings (later phase):** enroll each salesperson's voice once (speaker embedding), then match automatically. For the POC, salespeople are reported by speaker label per recording.

### 5.4 Conversation splitting
- A long recording may contain many separate customer interactions, and several salespeople may serve different customers in the same file.
- The LLM uses content changes, new customers appearing and long silences to split the transcript into conversations. Each conversation has start/end time, the salesperson(s) and customer(s) involved, and a topic.

### 5.5 Upsell detection (the core)
An **upsell attempt** is the salesperson **proactively** suggesting something **beyond what the customer asked for**. The rules are generic, so they work in any industry (retail, electronics, telecom, insurance, banking, restaurants, automobiles, pharmacy, etc.):

| Technique | Example |
|---|---|
| Cross-sell / add-on | "Would you also like the cover with this phone?" |
| Upgrade / premium | "The 256GB is just ₹2,000 more and much better" |
| Bundle / combo pricing | "Separately it's 100, together only 80" |
| Discount or offer hook | "Take two and you get 10% off" |
| Warranty / protection / insurance | "Add extended warranty for ₹499?" |
| Plan / subscription upgrade | "For ₹100 more you get double the data" |
| Membership / loyalty | "Join our membership and save on this purchase" |
| Scarcity / urgency | "This offer ends today" |
| Social proof | "Most customers take this together" |
| Persistence after a no | Customer says no, salesperson tries again with a new angle |

**Excluded (not upsell):**
- The customer asks for something and the salesperson provides it.
- Plain answers to questions the customer asked.
- Selling the main item the customer came in for.

For every attempt, the LLM must return the **exact quote, timestamp, technique, whether it was salesperson-initiated, and how the customer responded**. Requiring a quote makes every claim checkable and cuts down on made-up results.

**Optional industry context:** an industry name and/or product catalog can be passed in to help the model tell the main product from add-ons. Without it, the model infers from the conversation.

### 5.6 Mood and frustration
Frustration shows up in **what** people say and in **how** they say it. A transcript only captures the first, so three kinds of evidence are combined:

| Evidence | Source | Notes |
|---|---|---|
| **Words** | Claude Sonnet 5.5 reading the transcript | "kitni baar bolu", "bahut mehenga hai", curt replies. The most reliable for Hinglish. |
| **Voice tone** | OpenAI `gpt-audio-1.5` listens to each conversation clip (max 10 min per call) | Labels each turn's mood, intensity and vocal cues (raised voice, sighs, sharp tone). Optional: if it fails, the pipeline continues without it. |
| **Voice measurements** | Computed locally with numpy (no GPU, no API cost) | Loudness, pitch, speaking speed and interruptions per turn, as z-scores against each speaker's own baseline. Supporting evidence only. |

Claude combines all three into a mood per speaker (overall mood, frustration level 0–10, trend) and a list of frustration moments with quotes and which evidence supports each.

The mood notes are passed to upsell detection, so it can flag **pushy upselling**: continuing to push after a refusal or while the customer is irritated.

> Hume AI's voice-emotion API was considered, but its docs say it shut down in June 2026.

---

## 6. Example Output (one conversation)

```json
{
  "conversation_id": 3,
  "time": "12:40–19:05",
  "language": "hinglish",
  "salespeople": ["speaker_B"],
  "customers": ["speaker_C"],
  "customer_requested": ["running shoes"],
  "upsell_attempts": [
    {
      "salesperson": "speaker_B",
      "time": "14:22",
      "quote": "Sir, socks bhi le lijiye, combo mein 20% off hai",
      "technique": "bundle_discount",
      "salesperson_initiated": true,
      "customer_response": "rejected"
    },
    {
      "salesperson": "speaker_B",
      "time": "15:10",
      "quote": "Yeh waterproof spray bhi aata hai, shoes zyada chalenge",
      "technique": "cross_sell",
      "salesperson_initiated": true,
      "customer_response": "accepted"
    }
  ],
  "attempted_upsell": true,
  "effort_score": 7.5
}
```

---

## 7. Test Data (no real recordings yet)

Since no real recordings exist, we build a synthetic test set. The big advantage: because we write the scripts, we know the correct answer for every recording.

1. **Write scripts with an LLM:** 30–50 sales conversations across industries and languages (English, Hindi, Hinglish). Mix of:
   - clear upsell attempts (different techniques),
   - no upsell (customer asks, salesperson provides),
   - tricky edge cases (customer asks "anything else?", salesperson suggests the main product only),
   - persistence after rejection,
   - multiple salespeople, multiple customers, segments with no sales talk.
2. **Ground-truth labels** for each script: number of speakers, roles, and every upsell attempt.
3. **Generate audio with multi-voice TTS** (OpenAI TTS, or Amazon Polly for Hindi voices), a different voice per speaker.
4. **Make it realistic:** add shop/background noise, some overlapping speech, phone-quality (8kHz) versions, and stitch several conversations into 30–60 minute files.
5. **Supplement with real speech:** team members role-play 5–10 conversations recorded on a phone, plus a few public sales role-play videos, to check that results hold on natural speech and not just TTS.

When real recordings become available, we label a small sample and re-test.

---

## 8. Metrics per Salesperson

| Metric | Meaning |
|---|---|
| **Upsell rate** | Share of conversations with at least one attempt. The main "are they doing it?" number. |
| **Attempts per conversation** | Average number of upsell attempts. |
| **Effort score (0–10)** | Based on number of attempts, variety of techniques, retrying after a rejection, and handling objections. |
| **Upsell talk time** | Share of the salesperson's speaking time spent on upselling. |
| **Acceptance rate** | Tracked for information only. The attempt matters, not the outcome. |

**Accuracy metrics for the POC itself** (measured against the test set):
- Speaker-count accuracy and diarization error rate
- Transcription word error rate (per language)
- Role detection accuracy
- Upsell detection precision and recall (target: both above 85%)

---

## 9. POC Phases

| Phase | Work | Time |
|---|---|---|
| 0 | Build synthetic test set: scripts, labels, TTS audio, noise, long stitched files | 2–3 days |
| 1 | Audio extraction, chunking + transcription/diarization; benchmark OpenAI `gpt-4o-transcribe-diarize` vs Amazon Transcribe on Hindi/Hinglish and pick the primary; build the retry/fallback wrapper | 3–4 days |
| 2 | Role detection (0/1/many salespeople) and conversation splitting | 2 days |
| 3 | Upsell detection prompt, structured output and scoring | 3–4 days |
| 4 | Simple upload UI and report dashboard (FastAPI with a basic web page) | 2–3 days |
| 5 | Accuracy evaluation on the test set + role-play recordings; tune rules | 2–3 days |

**Total:** roughly 3 weeks.

---

## 10. Tech Stack

- **Language:** Python
- **Audio extraction:** ffmpeg (CPU)
- **Transcription + diarization:** OpenAI `gpt-4o-transcribe-diarize` (primary), Amazon Transcribe (fallback), optional `gpt-transcribe` quality pass
- **Analysis:** Claude Sonnet 5.5 on AWS Bedrock (`anthropic.claude-sonnet-5-5`), Opus 5.5 for low-confidence escalation, OpenAI `gpt-6.1-sol` as cross-provider fallback
- **SDKs:** `anthropic` (Bedrock Mantle client), `openai`, `boto3` (Transcribe, Polly, S3)
- **Validation / retries:** Pydantic schemas, SDK built-in retries + custom fallback wrapper with circuit breaker
- **Jobs:** FastAPI + background worker (RQ + Redis or DB queue)
- **Test audio generation:** LLM-written scripts + OpenAI TTS / Amazon Polly
- **API / UI:** FastAPI + simple web page
- **Hardware:** any normal CPU machine; no GPU required

---

## 11. Known Risks

- **Synthetic audio is cleaner than real life.** TTS voices are clearer than real shop-floor speech, so accuracy on real recordings may be lower. Role-play recordings partly cover this; real recordings are needed before production.
- **Noisy shop floors and overlapping speech** make diarization harder. Speakers may sometimes get merged or split.
- **Many speakers in one file** (e.g. a whole store) is the hardest case for diarization; accuracy drops as the speaker count grows.
- **Phone recordings at 8kHz** have lower accuracy than a recorder in the store.
- **The upsell vs. normal sale boundary is sometimes unclear**, and it varies by industry. Phase 5 exists to tune the rules; an optional product catalog helps.
- **API cost** scales with audio hours. Estimate per hour of audio after the Phase 1 benchmark (LLM cost is small: a 1-hour transcript is about 20–30K tokens).
- **OpenAI diarization with Hindi is unconfirmed** in OpenAI's docs; Amazon Transcribe is ready as the primary if the benchmark shows it's better.
- **Speaker label stitching across chunks** can mislabel speakers when there are more than 4 voices (limit of known-speaker references).

---

## 12. Remaining Inputs Needed

1. **OpenAI API key.**
2. **AWS account access:** IAM credentials with Bedrock access to `anthropic.claude-sonnet-5-5` and `anthropic.claude-opus-5-5` enabled in two regions, plus Amazon Transcribe, Polly and an S3 bucket.
3. Any real recordings as soon as they become available, even a few, for validation.

---

## 13. Sources (model checks, 2026-10-12)

- [OpenAI: All models](https://developers.openai.com/api/docs/models/all)
- [OpenAI: Speech to text guide](https://developers.openai.com/api/docs/guides/speech-to-text.md)
- [Hands-on report on gpt-4o-transcribe-diarize limits](https://ndurner.substack.com/p/gpt-4o-diarize?open=false)
