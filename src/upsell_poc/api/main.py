"""HTTP API: upload a recording, poll job status, fetch report and transcript."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from upsell_poc import __version__, dashboard, jobs, outcomes
from upsell_poc.config import get_settings
from upsell_poc.logging_setup import setup_logging
from upsell_poc.schemas import JobStatus
from upsell_poc.storage import get_storage

settings = get_settings()
setup_logging(settings.log_level)

app = FastAPI(title="Speaker Upsell POC", version=__version__)
STATIC = Path(__file__).parent / "static"
CHUNK = 1 << 20

# The React app's built JS/CSS (src/upsell_poc/api/static/assets/, from `npm run build`
# in frontend/). The page itself is served by the catch-all route at the bottom of this
# file, which also handles client-side routes like /recordings/<id> and /team.
if (STATIC / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/api/jobs", response_model=list[JobStatus])
def list_jobs(limit: int = 50) -> list[JobStatus]:
    """All saved jobs, newest first - the 'Recent jobs' list is built from this, not the browser."""
    return jobs.list_statuses(get_storage(settings), max(1, min(limit, 200)))


@app.post("/api/jobs", response_model=JobStatus, status_code=202)
async def create_job(
    file: Annotated[UploadFile, File(description="Audio or video recording")],
    industry: Annotated[str | None, Form()] = None,
    product_catalog: Annotated[str | None, Form()] = None,
    salesperson_name: Annotated[str | None, Form()] = None,
) -> JobStatus:
    limit = settings.max_upload_mb * CHUNK
    size = 0
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "").suffix) as tmp:
        tmp_path = Path(tmp.name)
        while block := await file.read(CHUNK):
            size += len(block)
            if size > limit:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(413, f"file larger than {settings.max_upload_mb} MB")
            tmp.write(block)
    if size == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(400, "empty file")
    try:
        # Storage writes (S3 upload of a large file) are blocking: keep them off the event loop.
        storage = get_storage(settings)
        status = await run_in_threadpool(
            jobs.create_job,
            storage,
            tmp_path,
            file.filename or "upload.bin",
            industry,
            product_catalog,
            salesperson_name,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
    await run_in_threadpool(jobs.enqueue, status.job_id, settings)
    return status


@app.get("/api/jobs/{job_id}", response_model=JobStatus)
def job_status(job_id: str) -> JobStatus:
    status = jobs.get_status(get_storage(settings), _check_id(job_id))
    if status is None:
        raise HTTPException(404, "job not found")
    return status


@app.get("/api/jobs/{job_id}/report")
def job_report(job_id: str) -> dict:
    return _artifact(job_id, jobs.report_key)


@app.get("/api/jobs/{job_id}/outcomes", response_model=outcomes.JobOutcomes)
def job_outcomes(job_id: str) -> outcomes.JobOutcomes:
    """How each sales conversation went: what was pitched, whether it landed, and the call's overall feel."""
    report = jobs.parse_report(_artifact(job_id, jobs.report_key))
    if report is None:
        raise HTTPException(422, "this report was written by an older version and can't be read")
    return outcomes.job_outcomes(report)


@app.get("/api/jobs/{job_id}/transcript")
def job_transcript(job_id: str) -> dict:
    return _artifact(job_id, jobs.transcript_key)


@app.get("/api/jobs/{job_id}/audio")
def job_audio(job_id: str) -> Response:
    """The uploaded recording, for playback in the UI (local: streamed with Range support; S3: presigned URL)."""
    storage = get_storage(settings)
    status = jobs.get_status(storage, _check_id(job_id))
    if status is None:
        raise HTTPException(404, "job not found")
    location = storage.media_location(status.input_key)
    if isinstance(location, str):
        return RedirectResponse(location, status_code=307)
    if not location.exists():
        raise HTTPException(404, "recording not found")
    return FileResponse(location, filename=status.filename)


@app.post("/api/jobs/{job_id}/retry", response_model=JobStatus, status_code=202)
def retry_job(job_id: str) -> JobStatus:
    """Re-run a failed, cancelled or completed job; finished stages are reused from checkpoints."""
    storage = get_storage(settings)
    status = jobs.get_status(storage, _check_id(job_id))
    if status is None:
        raise HTTPException(404, "job not found")
    if status.status not in ("failed", "completed", "cancelled"):
        raise HTTPException(409, f"job is {status.status}")
    status = jobs.update_status(
        storage,
        job_id,
        status="queued",
        stage="queued",
        progress=0.0,
        error=None,
        cancel_requested=False,
        spent_usd=0.0,
    )
    jobs.enqueue(job_id, settings)
    return status


@app.post("/api/jobs/{job_id}/cancel", response_model=JobStatus, status_code=202)
def cancel_job(job_id: str) -> JobStatus:
    """Ask a queued or running job to stop at its next checkpoint.

    Cooperative: a provider call already in flight finishes first. Finished stages are
    checkpointed, so a later retry resumes from here rather than starting over.
    """
    storage = get_storage(settings)
    status = jobs.get_status(storage, _check_id(job_id))
    if status is None:
        raise HTTPException(404, "job not found")
    if status.status not in ("queued", "running"):
        raise HTTPException(409, f"job is {status.status}, nothing to cancel")
    return jobs.update_status(storage, job_id, cancel_requested=True)


@app.get("/api/dashboard", response_model=dashboard.Dashboard)
def get_dashboard(period: dashboard.Period = "day") -> dashboard.Dashboard:
    """Per-salesperson performance across every saved job, by day, week or month."""
    return dashboard.build_dashboard(get_storage(settings), period)


@app.get("/api/people/{name}/recordings", response_model=list[dashboard.RecordingSummary])
def person_recordings(name: str) -> list[dashboard.RecordingSummary]:
    """Every completed recording one person appears in - newest first, not period-capped."""
    return dashboard.build_person_recordings(get_storage(settings), name)


class PersonName(BaseModel):
    job_id: str
    speaker: str
    name: str  # empty clears the assignment


@app.post("/api/people/name", status_code=204)
def name_person(body: PersonName) -> Response:
    """Say who a speaker label in one recording really is, so their recordings are grouped."""
    storage = get_storage(settings)
    if jobs.get_status(storage, _check_id(body.job_id)) is None:
        raise HTTPException(404, "job not found")
    dashboard.set_name(storage, body.job_id, body.speaker, body.name[:80])
    return Response(status_code=204)


def _check_id(job_id: str) -> str:
    if not job_id.isalnum() or len(job_id) > 64:
        raise HTTPException(400, "invalid job id")
    return job_id


def _artifact(job_id: str, key_fn) -> dict:  # type: ignore[no-untyped-def]
    data = get_storage(settings).get_json(key_fn(_check_id(job_id)))
    if data is None:
        raise HTTPException(404, "not ready")
    return data


# SPA fallback: anything not matched above (/, /team, /recordings/<id>, ...) gets the React
# app's index.html, which then handles routing client-side. Registered last so it never
# shadows /health or the /api/* routes above.
#
# A real static file at the root (favicon.svg, robots.txt, ...) is served directly rather
# than falling through to index.html - only /assets is mounted via StaticFiles, so without
# this check any such file would silently 200 with the SPA shell instead of its own content.
# resolve() + the parents check guards against `_full_path` escaping STATIC via "..".
#
# no-store on index.html is deliberate: it references the current build's hashed
# /assets/*.js file by name, so a cached shell pointing at a since-deleted bundle is a real
# failure mode (stale JS 404s, or old and new code mixed) every time the frontend is
# rebuilt. The hashed asset files (and other static-root files) are safe to cache normally.
@app.api_route("/{_full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def spa(_full_path: str) -> FileResponse:
    candidate = (STATIC / _full_path).resolve()
    if candidate.is_file() and candidate.is_relative_to(STATIC.resolve()):
        return FileResponse(candidate)
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})
