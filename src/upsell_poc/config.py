"""Runtime settings (environment) and model routing (YAML)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Provider SDKs (OpenAI, boto3) read their keys from the process environment, not from our
# Settings object, so export .env into it. Real environment variables take precedence.
load_dotenv(PROJECT_ROOT / ".env", override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "local"
    log_level: str = "INFO"

    storage_backend: Literal["local", "s3"] = "local"
    # The committed sample data (see scripts/build_sample_data.py); LOCAL_STORAGE_DIR overrides.
    local_storage_dir: Path = PROJECT_ROOT / "sample_data" / "store"
    s3_bucket: str | None = None
    s3_prefix: str = "upsell-poc"

    queue_backend: Literal["inline", "rq"] = "inline"
    redis_url: str = "redis://localhost:6379/0"
    queue_name: str = "upsell"
    job_timeout_seconds: int = 4 * 3600

    aws_region: str = "us-east-1"
    # Bucket Amazon Transcribe reads from / writes to; defaults to s3_bucket.
    transcribe_s3_bucket: str | None = None

    models_config_path: Path = PROJECT_ROOT / "config" / "models.yaml"
    work_dir: Path = Path("/tmp/upsell-poc")
    max_upload_mb: int = 4096

    # Accounts: kept outside the sample-data store. AUTH_SECRET signs sessions (generated and saved if unset).
    auth_required: bool = True
    auth_allow_signup: bool = True
    auth_dir: Path = PROJECT_ROOT / "data" / "auth"
    auth_secret: str | None = None
    demo_login: bool = True  # the built-in demo account on the login page; DEMO_LOGIN=false turns it off

    # Live transcript preview while recording (short clips, no speaker labels).
    live_transcribe_model: str = "gpt-4o-transcribe"


class CircuitBreakerConfig(BaseModel):
    failures: int = 5
    window_seconds: int = 120
    cooldown_seconds: int = 300


class LLMEndpoint(BaseModel):
    provider: Literal["bedrock", "openai"]
    model: str
    region: str | None = None
    reasoning: bool = False


class LLMStepConfig(BaseModel):
    effort: Literal["low", "medium", "high"] = "medium"
    escalate_below_confidence: float | None = None
    escalation: LLMEndpoint | None = None


class LLMConfig(BaseModel):
    sdk_max_retries: int = 3
    timeout_seconds: int = 600
    max_tokens: int = 16000
    circuit_breaker: CircuitBreakerConfig = CircuitBreakerConfig()
    chain: list[LLMEndpoint]
    steps: dict[str, LLMStepConfig] = Field(default_factory=dict)

    def step(self, name: str) -> LLMStepConfig:
        return self.steps.get(name, LLMStepConfig())


class TranscriberConfig(BaseModel):
    provider: Literal["openai_diarize", "aws_transcribe", "fake"]
    model: str | None = None
    chunk_minutes: float = 20
    overlap_seconds: float = 2
    max_parallel_chunks: int = 3
    mp3_bitrate: str = "48k"
    languages: list[str] = Field(default_factory=lambda: ["en-IN", "hi-IN"])
    max_speakers: int = 10
    poll_seconds: int = 10
    timeout_minutes: int = 90


class QualityPassConfig(BaseModel):
    enabled: bool = False
    model: str = "gpt-transcribe"
    min_segment_seconds: float = 1.0
    max_parallel: int = 4
    extra_params: dict[str, Any] = Field(default_factory=dict)


class TranscriptionConfig(BaseModel):
    chain: list[TranscriberConfig]
    quality_pass: QualityPassConfig = QualityPassConfig()


class ToneModelConfig(BaseModel):
    enabled: bool = True
    model: str = "gpt-audio-1.5"
    max_clip_minutes: float = 10


class AcousticsConfig(BaseModel):
    enabled: bool = True


class MoodConfig(BaseModel):
    tone_model: ToneModelConfig = ToneModelConfig()
    acoustics: AcousticsConfig = AcousticsConfig()


class TTSConfig(BaseModel):
    model: str = "gpt-4o-mini-tts"
    voices: list[str] = Field(default_factory=lambda: ["alloy", "echo", "nova", "onyx"])


class BudgetConfig(BaseModel):
    enabled: bool = True
    max_usd_per_job: float = 4.0
    # A second, independent cap: no single conversation's own analysis (mood + upsell +
    # escalation + voice tone) may cost more than this. Only that conversation's remaining
    # steps are skipped if it's hit - other conversations and the job continue. With the
    # default max_usd_per_job below this, the job-level cap binds first in practice; raise
    # max_usd_per_job (or disable it) if you want this cap to be the one that actually bites.
    max_usd_per_conversation: float = 5.0


class ModelsConfig(BaseModel):
    transcription: TranscriptionConfig
    llm: LLMConfig
    mood: MoodConfig = MoodConfig()
    tts: TTSConfig = TTSConfig()
    budget: BudgetConfig = BudgetConfig()


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_models_config(path: Path | None = None) -> ModelsConfig:
    path = path or get_settings().models_config_path
    with open(path, encoding="utf-8") as f:
        return ModelsConfig.model_validate(yaml.safe_load(f))
