"""End-to-end pipeline with per-stage checkpoints.

Each stage result is stored under cache/<audio sha256>/<stage>-<fingerprint>.json,
where the fingerprint covers the upstream stage, the relevant config and the prompt
version. Re-running a job (or the same audio) resumes from the first missing stage
and never pays for transcription twice.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import shutil
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from upsell_poc import audio, jobs
from upsell_poc.analysis import acoustics, prompts
from upsell_poc.analysis.conversation import analyze_conversation
from upsell_poc.analysis.evidence import attach_evidence
from upsell_poc.analysis.scoring import salesperson_metrics
from upsell_poc.analysis.structure import apply_speaker_merge, detect_roles, split_conversations
from upsell_poc.analysis.tone import ToneAnalyzer
from upsell_poc.config import ModelsConfig, Settings, get_settings, load_models_config
from upsell_poc.control import ConversationBudgetExceeded, JobStopped
from upsell_poc.llm.chain import LLMChain, build_chain
from upsell_poc.romanize import romanize_document, romanize_transcript, strings_in
from upsell_poc.schemas import (
    AcousticTurn,
    CallLog,
    ConversationResult,
    ConversationSplit,
    JobReport,
    RoleDetection,
    SpeakerSummary,
    ToneAnalysis,
    Transcript,
)
from upsell_poc.storage import Storage, get_storage
from upsell_poc.transcription import build_transcription_chain
from upsell_poc.transcription.base import TranscriptionChain

log = logging.getLogger(__name__)

M = TypeVar("M", bound=BaseModel)
MAX_PARALLEL_CONVERSATIONS = 5

# JobStopped and ConversationBudgetExceeded live in control.py (not here) so
# analysis/conversation.py can catch the latter without importing this module and
# creating a cycle. Imported above so `from upsell_poc.pipeline import JobStopped` - used
# throughout this file and by existing callers/tests - keeps working unchanged.


def _fp(*parts: Any) -> str:
    blob = json.dumps(parts, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class Pipeline:
    def __init__(
        self,
        storage: Storage,
        models: ModelsConfig,
        settings: Settings,
        transcription: TranscriptionChain | None = None,
        llm: LLMChain | None = None,
        escalation: LLMChain | None = None,
        tone_analyzer: ToneAnalyzer | None = None,
        progress: Callable[[str, float], None] | None = None,
    ) -> None:
        self.storage = storage
        self.models = models
        self.settings = settings
        self.calls: list[CallLog] = []
        self.spent_usd = 0.0
        self.unpriced_calls = 0
        self.budget_usd = models.budget.max_usd_per_job if models.budget.enabled else None
        self.conversation_budget_usd = models.budget.max_usd_per_conversation if models.budget.enabled else None
        self._calls_lock = threading.Lock()
        self._job_id: str | None = None
        # Per-conversation spend: each conversation runs start-to-finish on one worker thread,
        # so a plain thread-local (no lock needed) keeps its running total separate from the
        # other conversations analyzed concurrently alongside it.
        self._local = threading.local()
        self.progress = progress or (lambda stage, p: None)

        # An explicitly-injected chain (tests, or a custom caller) is used as-is except that,
        # if it has no on_call of its own, we wire ours in too - otherwise its calls would
        # never reach self.calls / self.spent_usd / the live budget check.
        self.transcription = transcription or build_transcription_chain(models.transcription, settings, self._record)
        if transcription is not None and self.transcription.on_call is None:
            self.transcription.on_call = self._record

        self.llm = llm or build_chain(models.llm, on_call=self._record)
        if llm is not None and self.llm.on_call is None:
            self.llm.on_call = self._record

        upsell_cfg = models.llm.step("upsell_detection")
        self.escalation_threshold = upsell_cfg.escalate_below_confidence
        if escalation is None and upsell_cfg.escalation:
            escalation = build_chain(models.llm, [upsell_cfg.escalation], on_call=self._record)
        elif escalation is not None and escalation.on_call is None:
            escalation.on_call = self._record
        self.escalation = escalation

        tone_cfg = models.mood.tone_model
        tone: ToneAnalyzer | None
        if tone_analyzer is not None:
            tone = tone_analyzer
            if tone.on_call is None:
                tone.on_call = self._record
        else:
            tone = ToneAnalyzer(tone_cfg, on_call=self._record) if tone_cfg.enabled else None
        self.tone = tone

    def _record(self, entry: CallLog) -> None:
        with self._calls_lock:
            self.calls.append(entry)
            if entry.cost_usd is not None:
                self.spent_usd = round(self.spent_usd + entry.cost_usd, 6)
            elif entry.ok:
                self.unpriced_calls += 1
            spent, job_id = self.spent_usd, self._job_id
        if entry.cost_usd is not None:
            # Thread-local: only counts toward whichever conversation this thread is
            # currently analyzing (reset per conversation in run()'s analyze()/compute()).
            self._local.conv_cost = getattr(self._local, "conv_cost", 0.0) + entry.cost_usd
        if job_id:  # let the UI show live spend while the job runs
            # KeyError = no persisted job record for this run (e.g. a direct Pipeline.run() call) - fine
            with contextlib.suppress(KeyError):
                jobs.update_status(self.storage, job_id, spent_usd=spent)

    def _check_conversation_budget(self) -> None:
        """Passed into analyze_conversation() as its check_budget callback."""
        if self.conversation_budget_usd is None:
            return
        spent = getattr(self._local, "conv_cost", 0.0)
        if spent >= self.conversation_budget_usd:
            raise ConversationBudgetExceeded(
                f"Stopped this conversation's analysis: estimated spend reached ${spent:.2f}, at "
                f"or above the ${self.conversation_budget_usd:.2f} per-conversation budget. Other "
                f"conversations in this job are not affected."
            )

    def _check_stop(self) -> None:
        """Checkpoint gate for both the budget cap and a user-requested cancel.

        Cooperative, not preemptive: a call already in flight finishes, but no new
        provider call starts once this raises. Called between stages and at the start
        of each conversation's analysis.
        """
        if self.budget_usd is not None and self.spent_usd >= self.budget_usd:
            raise JobStopped(
                "budget_exceeded",
                f"Stopped: estimated spend reached ${self.spent_usd:.2f}, at or above the "
                f"${self.budget_usd:.2f} budget for this job. This estimate excludes Amazon "
                f"Transcribe (billed by audio duration) and any unpriced model (see "
                f"unpriced_calls on the report), so real spend may differ. Finished steps are "
                f"saved - retry after raising budget.max_usd_per_job in config/models.yaml to "
                f"continue from here.",
            )
        if self._job_id:
            status = jobs.get_status(self.storage, self._job_id)
            if status and status.cancel_requested:
                raise JobStopped("cancelled", "Cancelled by request. Finished steps are saved; retry to resume.")

    def _cached(self, key: str, model: type[M], compute: Callable[[], M]) -> M:
        data = self.storage.get_json(key)
        if data is not None:
            log.info("checkpoint hit %s", key)
            return model.model_validate(data)
        self._check_stop()
        result = compute()
        self.storage.put_json(key, result.model_dump(mode="json"))
        return result

    def run(
        self,
        source: Path,
        workdir: Path,
        job_id: str,
        filename: str,
        industry: str | None = None,
        catalog: str | None = None,
    ) -> tuple[JobReport, dict]:
        self._job_id = job_id
        workdir.mkdir(parents=True, exist_ok=True)
        self.progress("extracting_audio", 0.02)
        self._check_stop()
        wav = audio.extract_audio(source, workdir / "audio.wav")
        audio_sha = sha256_file(wav)
        cache = f"cache/{audio_sha}"

        # 1. transcription
        self.progress("transcribing", 0.05)
        t_fp = _fp(self.models.transcription.model_dump())
        transcript = self._cached(f"{cache}/transcript-{t_fp}.json", Transcript, lambda: self._transcribe(wav, workdir))
        transcript = romanize_transcript(transcript, self.llm)  # Hindi shown as Hinglish (English letters)

        # 2. roles (+ merge split labels)
        self.progress("detecting_roles", 0.45)
        r_fp = _fp(t_fp, prompts.PROMPT_VERSION, self.models.llm.model_dump())
        roles = self._cached(f"{cache}/roles-{r_fp}.json", RoleDetection, lambda: detect_roles(self.llm, transcript))
        merged, role_map, title_map = apply_speaker_merge(transcript, roles)

        # 3. conversations
        self.progress("splitting_conversations", 0.5)
        s_fp = _fp(r_fp, "split")
        split = self._cached(
            f"{cache}/conversations-{s_fp}.json",
            ConversationSplit,
            lambda: ConversationSplit(conversations=split_conversations(self.llm, merged, role_map)),
        )

        # 4. acoustics over the whole recording (per-speaker baselines)
        acoustic_turns: list[AcousticTurn] = []
        if self.models.mood.acoustics.enabled:
            try:
                acoustic_turns = acoustics.measure(wav, merged.segments)
            except Exception:  # noqa: BLE001 - supporting evidence only
                log.warning("acoustic measurement failed", exc_info=True)

        # 5. per-conversation mood + upsell
        self.progress("analyzing_conversations", 0.55)
        c_fp = _fp(s_fp, self.models.mood.model_dump(), industry, catalog)
        by_id = {s.id: s for s in merged.segments}
        done = 0
        done_lock = threading.Lock()
        total = max(1, len(split.conversations))

        def analyze(span):  # type: ignore[no-untyped-def]
            nonlocal done
            segs = [by_id[i] for i in range(span.start_segment_id, span.end_segment_id + 1) if i in by_id]
            if not segs:
                return None
            seg_ids = {s.id for s in segs}

            def compute() -> ConversationResult:
                self._local.conv_cost = 0.0  # this thread analyzes exactly one conversation at a time
                tone_result: ToneAnalysis | None = None
                if self.tone:
                    tone_result = self.tone.analyze(wav, segs, workdir / f"conv_{span.conversation_id}")
                return analyze_conversation(
                    self.llm,
                    self.escalation,
                    self.escalation_threshold,
                    span,
                    segs,
                    role_map,
                    tone_result,
                    [t for t in acoustic_turns if t.segment_id in seg_ids] or None,
                    industry,
                    catalog,
                    check_budget=self._check_conversation_budget,
                )

            result = self._cached(f"{cache}/conv{span.conversation_id}-{c_fp}.json", ConversationResult, compute)
            with done_lock:
                done += 1
                self.progress("analyzing_conversations", 0.55 + 0.4 * done / total)
            return result

        with ThreadPoolExecutor(max_workers=MAX_PARALLEL_CONVERSATIONS) as pool:
            results = [r for r in pool.map(analyze, split.conversations) if r is not None]
        # Check every quote against the real transcript and attach the surrounding lines as evidence.
        results, evidence = attach_evidence(results, merged.segments, role_map)

        # 6. report
        self.progress("building_report", 0.97)
        talk: dict[str, float] = {}
        for s in merged.segments:
            talk[s.speaker] = talk.get(s.speaker, 0.0) + s.duration
        report = JobReport(
            job_id=job_id,
            source_filename=filename,
            duration_s=round(transcript.duration, 1),
            transcription_provider=transcript.provider,
            speakers=[
                SpeakerSummary(
                    speaker=sp,
                    role=role_map.get(sp, "other"),  # type: ignore[arg-type]
                    title=title_map.get(sp),
                    talk_time_s=round(t, 1),
                )
                for sp, t in sorted(talk.items(), key=lambda kv: -kv[1])
            ],
            has_sales_activity=roles.has_sales_activity,
            conversations=sorted(results, key=lambda r: r.conversation_id),
            salespeople=salesperson_metrics(results, merged.segments),
            calls=self.calls,
            evidence=evidence,
            spent_usd=self.spent_usd,
            budget_usd=self.budget_usd,
            unpriced_calls=self.unpriced_calls,
        )
        transcript_doc = {
            "transcript": merged.model_dump(mode="json"),
            "roles": roles.model_dump(mode="json"),
            "acoustics": [t.model_dump(mode="json") for t in acoustic_turns],
        }
        # Anything the model still wrote in Hindi script is shown as Hinglish too.
        report_doc = report.model_dump(mode="json")
        if strings_in(report_doc):
            report = JobReport.model_validate(romanize_document(report_doc, self.llm))
        return report, romanize_document(transcript_doc, self.llm)

    def _transcribe(self, wav: Path, workdir: Path) -> Transcript:
        transcript = self.transcription.transcribe(wav, workdir / "transcription")
        qp = self.models.transcription.quality_pass
        if qp.enabled and transcript.provider.startswith("openai"):
            from upsell_poc.transcription.quality_pass import improve_text

            transcript = improve_text(transcript, wav, workdir / "quality_pass", qp)
        return transcript


def run_job(job_id: str) -> None:
    """Entry point for the queue worker (and inline thread)."""
    settings = get_settings()
    storage = get_storage(settings)
    status = jobs.get_status(storage, job_id)
    if status is None:
        raise KeyError(f"job {job_id} not found")
    if status.cancel_requested:
        jobs.update_status(storage, job_id, status="cancelled", stage="cancelled", error="Cancelled before it started.")
        return
    workdir = settings.work_dir / job_id
    try:
        models = load_models_config()
        jobs.update_status(
            storage,
            job_id,
            status="running",
            stage="starting",
            progress=0.0,
            error=None,
            budget_usd=models.budget.max_usd_per_job if models.budget.enabled else None,
        )

        def progress(stage: str, value: float) -> None:
            jobs.update_status(storage, job_id, stage=stage, progress=round(value, 3))

        pipeline = Pipeline(storage, models, settings, progress=progress)
        source = storage.get_file(status.input_key, workdir / "input" / status.filename)
        report, transcript_doc = pipeline.run(
            source, workdir, job_id, status.filename, status.industry, status.product_catalog
        )
        storage.put_json(jobs.transcript_key(job_id), transcript_doc)
        storage.put_json(jobs.report_key(job_id), report.model_dump(mode="json"))
        jobs.update_status(storage, job_id, status="completed", stage="done", progress=1.0, spent_usd=report.spent_usd)
    except JobStopped as e:
        log.info("job %s stopped (%s): %s", job_id, e.reason, e.message)
        jobs.update_status(storage, job_id, status="cancelled", stage=e.reason, error=e.message)
    except Exception as e:
        log.exception("job %s failed", job_id)
        jobs.update_status(storage, job_id, status="failed", error=f"{type(e).__name__}: {e}"[:2000])
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
