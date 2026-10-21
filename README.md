# Speaker Upsell POC

Takes a sales recording (audio or video, 5 minutes to several hours) and reports:

- **who spoke when**, and the transcript per speaker (English, Hindi, Hinglish)
- which speakers are **salespeople / customers** (zero, one or many of each)
- the separate **customer conversations** inside a long recording
- **mood and frustration** per speaker, from words + voice tone + voice measurements
- **upsell attempts** per salesperson: technique, exact quote, customer response,
  effort score, and pushy-upsell flags. Fulfilling a customer's own request is not counted.
- **evidence** for every attempt: the real transcript lines around it (what the customer asked,
  the attempt, the reply), checked against the transcript, plus a full searchable transcript tab.

The full plan is in [POC_PLAN.md](POC_PLAN.md).

## How it works

```
upload ─▶ ffmpeg (16 kHz mono WAV)
       ─▶ transcription + diarization   OpenAI gpt-4o-transcribe-diarize (20-min chunks, speaker refs)
                                        └─ fallback: Amazon Transcribe (whole file, en-IN/hi-IN)
       ─▶ role detection + label merge  Claude Sonnet 5.5 on Bedrock (effort low)
       ─▶ conversation splitting        Claude Sonnet 5.5 (effort medium)
       ─▶ per conversation, in parallel:
            voice measurements          numpy: loudness, pitch, speaking rate, interruptions
            voice tone                  OpenAI gpt-audio-1.5 listens to the clip
            mood fusion                 Claude Sonnet 5.5 (effort medium)
            upsell detection            Claude Sonnet 5.5 (effort high) ─▶ Opus 5.5 if confidence < 0.6
       ─▶ scoring + report              deterministic effort score and per-salesperson metrics
```

Every LLM step uses the same fallback chain from [config/models.yaml](config/models.yaml):
OpenAI `gpt-6.1-sol` → Bedrock Sonnet 5.5 (us-east-1) → Bedrock Sonnet 5.5 (us-west-2).

- **Retries:** SDK-level retries handle transient errors (429, 5xx, timeouts).
- **Fallback:** the chain moves to the next provider when a call still fails, is refused or doesn't match the schema. A schema mismatch first gets one repair attempt.
- **Circuit breaker:** a provider that keeps failing is skipped for a few minutes.

Each stage's result is saved under `cache/<audio sha256>/`, so a failed job resumes where it stopped.

## Project layout

```
src/upsell_poc/
  api/main.py            FastAPI app (+ the built React dashboard in static/)
  worker.py              RQ worker entry point
  cli.py                 `upsell-poc analyze <file>`
  pipeline.py            stage orchestration + checkpoints
  jobs.py, storage.py    job status, local/S3 storage, queue
  audio.py               ffmpeg helpers, silence-aware chunk planning
  transcription/         OpenAI diarize, Amazon Transcribe, optional gpt-transcribe pass
  llm/                   Bedrock Claude + OpenAI providers, fallback chain, circuit breaker
  analysis/              prompts, roles/splitting, acoustics, tone, mood, upsell, scoring
config/models.yaml       models, fallbacks, efforts, chunking
scripts/                 synthetic test-data generator, evaluation
infra/                   ECS task definitions, IAM task-role policy
```

## Run locally

Requirements: [uv](https://docs.astral.sh/uv/) and ffmpeg.

```bash
uv sync                          # installs exactly what uv.lock pins
cp .env.example .env             # set OPENAI_API_KEY and AWS credentials with Bedrock access
uv run uvicorn upsell_poc.api.main:app --reload
# open http://localhost:8000
```

The app has no upload flow in the UI. It ships with analysed sample recordings in
`sample_data/` (`audio/` = the recordings, `store/` = the app's storage with reports and
transcripts) and reads them by default. To use other data, point `LOCAL_STORAGE_DIR` at
another storage directory. To rebuild the sample data (needs `OPENAI_API_KEY` and the
provider access above): `uv run python scripts/build_sample_data.py`.

Or analyze a file from the command line:

```bash
uv run upsell-poc analyze recording.mp4 --industry "electronics retail" --out report.json
```

### With Docker (API + worker + Redis, like AWS)

```bash
docker compose up --build        # http://localhost:8000 (mounts sample_data/store)
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/jobs` | multipart: `file`, optional `industry`, `product_catalog` → `202` with job status (not used by the UI; kept for a future ingestion pipeline) |
| GET | `/api/jobs/{id}` | status, stage, progress, error |
| GET | `/api/jobs/{id}/report` | full report (conversations, upsell attempts, mood, metrics) |
| GET | `/api/jobs/{id}/transcript` | speaker-labelled transcript |
| POST | `/api/jobs/{id}/retry` | re-run a failed job (finished stages come from checkpoints) |
| GET | `/health` | health check |

Responses omit internals (spend, per-call logs, provider/model names); those stay in the stored files.

## Tests and quality

```bash
uv run pytest            # offline: providers are faked, no API keys needed
uv run ruff check . && uv run ruff format --check .
uv run mypy src
```

## Test data and evaluation (no real recordings yet)

```bash
# LLM-written scripts with ground-truth labels, voiced by OpenAI TTS
uv run python scripts/generate_test_data.py --count 12 --noise --phone --stitch
# run the pipeline on every file and score it against the labels
uv run python scripts/evaluate.py --data testdata --run
```

## Deploy to AWS (ECS Fargate)

The same image runs both services: the **API** (default command, uvicorn) and the **worker**
(`python -m upsell_poc.worker`).

**One-time setup:**

1. **Container registry:** an ECR repository, e.g. `upsell-poc`.
2. **Storage:** an S3 bucket for uploads, checkpoints, reports and Amazon Transcribe I/O.
3. **Queue:** ElastiCache Redis, reachable from both services.
4. **Model access:** Bedrock access to `anthropic.claude-sonnet-5-5` and `anthropic.claude-opus-5-5` in both chain regions.
5. **Secret:** a Secrets Manager secret `upsell-poc/openai-api-key`.
6. **IAM roles:**
   - `upsell-poc-execution-role`: standard ECS execution role, plus read access to the secret.
   - `upsell-poc-task-role`: [infra/iam/task-role-policy.json](infra/iam/task-role-policy.json), with your bucket name filled in.
7. **ECS:** a cluster with two Fargate services, using [infra/ecs/](infra/ecs/) as the starting task definitions.
   - **API service:** behind an ALB, health check `/health`. Raise the ALB idle timeout for large uploads.
   - **Worker service:** no load balancer. Scale it on queue depth.
8. **CI/CD role:** a GitHub OIDC role that can push to ECR, register task definitions and update the ECS services.

**GitHub repository variables** (Settings → Variables). These are not secrets, because the
workflow uses OIDC:

| Variable | Example |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/github-deploy` |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCOUNT_ID` | `123456789012` |
| `ECR_REPOSITORY` | `upsell-poc` |
| `ECS_CLUSTER` | `upsell-poc` |
| `ECS_API_SERVICE` | `upsell-poc-api` |
| `ECS_WORKER_SERVICE` | `upsell-poc-worker` |
| `S3_BUCKET` | `my-upsell-poc-bucket` |
| `REDIS_URL` | `redis://my-redis.xxxxxx.cache.amazonaws.com:6379/0` |

[.github/workflows/ci.yml](.github/workflows/ci.yml) does the following:

- **Every PR:** lint, type-check and test (`uv sync --frozen`, so the lock file is enforced), then build the image and smoke-test `/health`.
- **On `main`, once `AWS_ROLE_ARN` is set:** push the image to ECR and deploy both ECS services.

## Configuration

**Environment variables** (see [.env.example](.env.example)):

| Variable | Values |
|---|---|
| `STORAGE_BACKEND` | `local` or `s3` |
| `S3_BUCKET` | your bucket name |
| `QUEUE_BACKEND` | `inline` (dev) or `rq` (Redis + worker) |
| `REDIS_URL` | Redis connection URL |
| `OPENAI_API_KEY` | your OpenAI key |
| `AWS_REGION` | e.g. `us-east-1` |
| `MAX_UPLOAD_MB` | upload size limit in MB |

**Models** live in [config/models.yaml](config/models.yaml): change providers, fallback order,
effort levels, the escalation threshold, chunk size, or turn on the `gpt-transcribe` quality pass.
Confirm model IDs before deploying: `GET /v1/models` for OpenAI, and the Bedrock console per region.
