from __future__ import annotations

import pytest
from conftest import requires_ffmpeg
from fakes import FakeLLM, FakeTranscriber, make_wav

from upsell_poc import jobs
from upsell_poc.llm.base import Usage
from upsell_poc.llm.chain import CircuitBreaker, LLMChain
from upsell_poc.pipeline import JobStopped, Pipeline
from upsell_poc.schemas import RoleDetection
from upsell_poc.storage import get_storage
from upsell_poc.transcription.base import TranscriptionChain


class PricedFakeLLM(FakeLLM):
    """A FakeLLM whose model id is priced, returning enough tokens to cost ~$1.20/call."""

    model = "anthropic.claude-sonnet-5-5"

    def generate(self, **kw):  # type: ignore[no-untyped-def]
        result, _ = super().generate(**kw)
        return result, Usage(100_000, 100_000)


class CancellingLLM(FakeLLM):
    """Flips cancel_requested right after role detection, as if the user clicked Cancel
    while that call was in flight."""

    def __init__(self, storage, job_id) -> None:  # type: ignore[no-untyped-def]
        super().__init__()
        self.storage, self.job_id = storage, job_id

    def generate(self, **kw):  # type: ignore[no-untyped-def]
        result, usage = super().generate(**kw)
        if kw["schema"] is RoleDetection:
            jobs.update_status(self.storage, self.job_id, cancel_requested=True)
        return result, usage


def _pipeline(storage, models_config, settings, llm):
    return Pipeline(
        storage,
        models_config,
        settings,
        transcription=TranscriptionChain([FakeTranscriber()]),
        llm=LLMChain([llm], models_config.llm, CircuitBreaker(models_config.llm.circuit_breaker)),
        tone_analyzer=None,
    )


@requires_ffmpeg
def test_budget_cap_stops_job_and_retry_resumes_from_checkpoints(tmp_path, settings, models_config):
    storage = get_storage(settings)
    wav = make_wav(tmp_path / "in.wav")
    status = jobs.create_job(storage, wav, "in.wav")
    models_config.budget.enabled = True
    models_config.budget.max_usd_per_job = 1.0

    llm = PricedFakeLLM()
    p = _pipeline(storage, models_config, settings, llm)
    with pytest.raises(JobStopped) as exc:
        p.run(wav, tmp_path / "w1", status.job_id, "in.wav")
    assert exc.value.reason == "budget_exceeded"
    assert "budget" in exc.value.message.lower()
    # Stopped right after role detection (~$1.20 > $1.00 budget), before conversation splitting.
    assert llm.calls == ["RoleDetection"]
    assert p.spent_usd >= 1.0
    # The live spend was persisted to the job record while running, not just held in memory.
    reloaded = jobs.get_status(storage, status.job_id)
    assert reloaded is not None and reloaded.spent_usd >= 1.0

    # Retry with a higher budget: role detection is cached, so only the later stages run.
    models_config.budget.max_usd_per_job = 100.0
    llm2 = PricedFakeLLM()
    p2 = _pipeline(storage, models_config, settings, llm2)
    report, _ = p2.run(wav, tmp_path / "w2", status.job_id, "in.wav")
    assert "RoleDetection" not in llm2.calls
    assert report.conversations[0].attempted_upsell
    assert report.spent_usd > 0 and report.budget_usd == 100.0


@requires_ffmpeg
def test_zero_budget_stops_before_any_llm_call(tmp_path, settings, models_config):
    storage = get_storage(settings)
    wav = make_wav(tmp_path / "in.wav")
    models_config.budget.enabled = True
    models_config.budget.max_usd_per_job = 0.0
    llm = FakeLLM()
    p = _pipeline(storage, models_config, settings, llm)
    with pytest.raises(JobStopped) as exc:
        p.run(wav, tmp_path / "w", "job", "in.wav")
    assert exc.value.reason == "budget_exceeded"
    assert llm.calls == []


def test_disabled_budget_never_stops(tmp_path, settings, models_config):
    models_config.budget.enabled = False
    p = Pipeline(get_storage(settings), models_config, settings)
    assert p.budget_usd is None
    p._check_stop()  # no budget, no job id -> nothing to check, must not raise


@requires_ffmpeg
def test_cancel_stops_job_and_retry_resumes_from_checkpoints(tmp_path, settings, models_config):
    storage = get_storage(settings)
    wav = make_wav(tmp_path / "in.wav")
    status = jobs.create_job(storage, wav, "in.wav")

    llm = CancellingLLM(storage, status.job_id)
    p = _pipeline(storage, models_config, settings, llm)
    with pytest.raises(JobStopped) as exc:
        p.run(wav, tmp_path / "w1", status.job_id, "in.wav")
    assert exc.value.reason == "cancelled"
    assert llm.calls == ["RoleDetection"]
    reloaded = jobs.get_status(storage, status.job_id)
    assert reloaded is not None and reloaded.cancel_requested is True

    # Retry (the API clears the flag first, same as POST /retry).
    jobs.update_status(storage, status.job_id, cancel_requested=False)
    llm2 = FakeLLM()
    p2 = _pipeline(storage, models_config, settings, llm2)
    report, _ = p2.run(wav, tmp_path / "w2", status.job_id, "in.wav")
    assert "RoleDetection" not in llm2.calls
    assert report.conversations[0].attempted_upsell


def test_cancel_before_start_short_circuits(tmp_path, settings, models_config):
    """run_job()'s own pre-check: cancelling a job that never started skips straight to 'cancelled'."""
    from upsell_poc.pipeline import run_job

    storage = get_storage(settings)
    f = tmp_path / "x.wav"
    f.write_bytes(b"not-real-audio")
    status = jobs.create_job(storage, f, "x.wav")
    jobs.update_status(storage, status.job_id, cancel_requested=True)
    run_job(status.job_id)
    final = jobs.get_status(storage, status.job_id)
    assert final is not None and final.status == "cancelled"
    assert final.error is not None and "before it started" in final.error


@requires_ffmpeg
def test_conversation_budget_degrades_that_conversation_without_failing_the_job(tmp_path, settings, models_config):
    """The per-conversation cap is independent of the per-job cap: hitting it skips the rest
    of *that* conversation's analysis but the job still completes normally."""
    storage = get_storage(settings)
    wav = make_wav(tmp_path / "in.wav")
    models_config.budget.enabled = True
    models_config.budget.max_usd_per_job = 1000.0  # job-level cap must not be what triggers this
    models_config.budget.max_usd_per_conversation = 1.0  # ~$1.20/call > this

    llm = PricedFakeLLM()
    p = _pipeline(storage, models_config, settings, llm)
    report, _ = p.run(wav, tmp_path / "w", "job", "in.wav")  # must not raise

    [conv] = report.conversations
    assert conv.budget_note is not None and "per-conversation budget" in conv.budget_note
    assert conv.upsell is None and conv.mood is not None
    assert llm.calls == ["RoleDetection", "SpeakerRepair", "ConversationSplit", "MoodAnalysis"]
