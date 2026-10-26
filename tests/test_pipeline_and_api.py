from __future__ import annotations

import time

import pytest
from conftest import requires_ffmpeg
from fakes import FakeLLM, FakeTranscriber, make_wav

from upsell_poc import jobs, pipeline
from upsell_poc.llm.chain import CircuitBreaker, LLMChain
from upsell_poc.storage import get_storage
from upsell_poc.transcription.base import TranscriptionChain

RealPipeline = pipeline.Pipeline


def build_fake_pipeline(storage, models_config, settings, llm=None, escalation_llm=None, progress=None):
    llm = llm or FakeLLM()
    return RealPipeline(
        storage,
        models_config,
        settings,
        transcription=TranscriptionChain([FakeTranscriber(fail=True), FakeTranscriber()]),
        llm=LLMChain([llm], models_config.llm, CircuitBreaker(models_config.llm.circuit_breaker)),
        escalation=LLMChain([escalation_llm], models_config.llm) if escalation_llm else None,
        tone_analyzer=None,
        progress=progress,
    )


@requires_ffmpeg
def test_pipeline_end_to_end_and_checkpoints(tmp_path, settings, models_config):
    storage = get_storage(settings)
    src = make_wav(tmp_path / "in.wav")
    p = build_fake_pipeline(storage, models_config, settings)
    report, transcript_doc = p.run(src, tmp_path / "w1", "job1", "in.wav")

    assert report.has_sales_activity
    assert report.transcription_provider == "fake"
    [conv] = report.conversations
    assert conv.attempted_upsell and conv.effort_score == 5.3 and conv.mood is not None
    [sp] = report.salespeople
    assert sp.speaker == "A" and sp.attempts_total == 2
    assert {s.role for s in report.speakers} == {"salesperson", "customer"}
    assert {s.title for s in report.speakers} == {"Seller", "Walk-in customer"}  # richer role label
    assert transcript_doc["acoustics"], "acoustic features computed"
    # Greeting, products discussed and coaching feedback come from the same upsell-detection call.
    assert conv.upsell.greeting_given and conv.upsell.greeting_quote
    assert conv.upsell.products_discussed == ["running shoes"]
    assert conv.upsell.customer_feedback is None
    assert "budget" in conv.upsell.coaching_feedback.lower()
    # Every finding - upsell attempts and the greeting here - comes with real transcript lines as evidence.
    assert all(e.quote_found for e in report.evidence)
    attempts_ev = [e for e in report.evidence if e.kind == "upsell_attempt"]
    assert len(attempts_ev) == 2
    hit = attempts_ev[0]
    assert [line.is_highlighted for line in hit.lines].count(True) == 1
    assert "socks" in next(line.text for line in hit.lines if line.is_highlighted)
    [greeting_ev] = [e for e in report.evidence if e.kind == "greeting"]
    assert greeting_ev.segment_id == 0

    # Second run on the same audio reuses every checkpoint: no LLM calls.
    llm2 = FakeLLM()
    p2 = build_fake_pipeline(storage, models_config, settings, llm=llm2)
    p2.run(src, tmp_path / "w2", "job2", "in.wav")
    assert llm2.calls == []


@requires_ffmpeg
def test_low_confidence_escalates(tmp_path, settings, models_config):
    storage = get_storage(settings)
    escalation = FakeLLM(confidence=0.95)
    p = build_fake_pipeline(storage, models_config, settings, llm=FakeLLM(confidence=0.3), escalation_llm=escalation)
    report, _ = p.run(make_wav(tmp_path / "in.wav"), tmp_path / "w", "job", "in.wav")
    assert report.conversations[0].escalated
    assert escalation.calls == ["UpsellAnalysis"]


@requires_ffmpeg
def test_api_upload_to_report(tmp_path, settings, models_config, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(pipeline, "load_models_config", lambda: models_config)
    monkeypatch.setattr(
        pipeline,
        "Pipeline",
        lambda storage, models, s, progress=None: build_fake_pipeline(storage, models_config, s, progress=progress),
    )
    from upsell_poc.api import main

    monkeypatch.setattr(main, "settings", settings)
    client = TestClient(main.app)
    assert client.get("/health").json()["status"] == "ok"

    wav = make_wav(tmp_path / "upload.wav")
    with open(wav, "rb") as f:
        res = client.post("/api/jobs", files={"file": ("upload.wav", f, "audio/wav")}, data={"industry": "footwear"})
    assert res.status_code == 202, res.text
    job_id = res.json()["job_id"]

    deadline = time.time() + 30
    while time.time() < deadline:
        status = client.get(f"/api/jobs/{job_id}").json()
        if status["status"] in ("completed", "failed"):
            break
        time.sleep(0.2)
    assert status["status"] == "completed", status
    report = client.get(f"/api/jobs/{job_id}/report").json()
    assert report["salespeople"][0]["attempts_total"] == 2
    assert not {"spent_usd", "budget_usd", "unpriced_calls", "calls", "transcription_provider"} & report.keys()
    assert not {"spent_usd", "budget_usd"} & status.keys()
    transcript = client.get(f"/api/jobs/{job_id}/transcript")
    assert transcript.status_code == 200 and not {"provider", "model"} & transcript.json().keys()
    # ...but the stored report keeps them for internal use.
    stored = get_storage(settings).get_json(jobs.report_key(job_id))
    assert stored is not None and "calls" in stored and "spent_usd" in stored and "transcription_provider" in stored
    audio = client.get(f"/api/jobs/{job_id}/audio")
    assert audio.status_code == 200 and audio.content == wav.read_bytes()
    partial = client.get(f"/api/jobs/{job_id}/audio", headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206 and len(partial.content) == 100  # seeking in the player
    assert client.get("/").status_code == 200
    assert client.get("/api/jobs/bad-id!").status_code in (400, 404)


def test_cancel_endpoint_contract(settings, tmp_path):
    from fastapi.testclient import TestClient

    from upsell_poc.api import main

    monkeypatch_settings = main.settings
    main.settings = settings
    try:
        client = TestClient(main.app)
        f = tmp_path / "x.wav"
        f.write_bytes(b"data")
        status = jobs.create_job(get_storage(settings), f, "x.wav")

        res = client.post(f"/api/jobs/{status.job_id}/cancel")
        assert res.status_code == 202 and res.json()["cancel_requested"] is True

        jobs.update_status(get_storage(settings), status.job_id, status="completed")
        res = client.post(f"/api/jobs/{status.job_id}/cancel")
        assert res.status_code == 409  # nothing to cancel once it's finished

        assert client.post("/api/jobs/doesnotexist/cancel").status_code == 404
    finally:
        main.settings = monkeypatch_settings


def test_status_roundtrip(settings, tmp_path):
    storage = get_storage(settings)
    f = tmp_path / "x.mp3"
    f.write_bytes(b"data")
    status = jobs.create_job(storage, f, "../../x.mp3")
    assert status.filename == "x.mp3"
    updated = jobs.update_status(storage, status.job_id, status="running", progress=0.5)
    assert jobs.get_status(storage, status.job_id) == updated
    with pytest.raises(KeyError):
        jobs.update_status(storage, "missing", status="running")


def test_list_jobs_returns_saved_jobs_newest_first(tmp_path, monkeypatch):
    from upsell_poc import jobs
    from upsell_poc.storage import LocalStorage

    storage = LocalStorage(tmp_path)
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    first = jobs.create_job(storage, audio, "first.wav")
    second = jobs.create_job(storage, audio, "second.wav")
    (tmp_path / "jobs" / "junk").mkdir()  # a folder with no status must be ignored
    listed = jobs.list_statuses(storage)
    assert {s.job_id for s in listed} == {first.job_id, second.job_id}
    assert listed[0].created_at >= listed[1].created_at


def test_interrupted_jobs_can_be_retried_after_a_restart(tmp_path):
    from datetime import UTC, datetime, timedelta

    from upsell_poc import jobs
    from upsell_poc.storage import LocalStorage

    storage = LocalStorage(tmp_path)
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    running = jobs.create_job(storage, audio, "a.mp3")
    jobs.update_status(storage, running.job_id, status="running")
    done = jobs.create_job(storage, audio, "b.mp3")
    jobs.update_status(storage, done.job_id, status="completed")

    assert jobs.recover_interrupted(storage) == 1
    again = jobs.get_status(storage, running.job_id)
    assert again.status == "failed" and "interrupted" in again.error
    assert jobs.get_status(storage, done.job_id).status == "completed"

    old = (datetime.now(UTC) - timedelta(hours=2)).isoformat(timespec="seconds")
    stale = jobs.get_status(storage, done.job_id).model_copy(update={"status": "running", "updated_at": old})
    assert jobs.is_stuck(stale)
    assert not jobs.is_stuck(stale.model_copy(update={"updated_at": datetime.now(UTC).isoformat()}))
