"""HTTP API: upload a recording, poll job status, fetch report and transcript."""

from __future__ import annotations

import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from upsell_poc import __version__, auth, dashboard, jobs, live, outcomes
from upsell_poc.api import public
from upsell_poc.config import get_settings
from upsell_poc.logging_setup import setup_logging
from upsell_poc.storage import get_storage

settings = get_settings()
setup_logging(settings.log_level)

@asynccontextmanager
async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    # Inline jobs run in this process, so after a restart none of them is really running any more.
    if settings.queue_backend == "inline" and os.environ.get("WEB_CONCURRENCY", "1") == "1":
        try:
            n = await run_in_threadpool(jobs.recover_interrupted, get_storage(settings))
            if n:
                logging.getLogger(__name__).warning("marked %d interrupted job(s) as failed so they can be retried", n)
        except Exception:  # noqa: BLE001 - never stop the app from starting
            logging.getLogger(__name__).exception("could not check for interrupted jobs")
    yield


app = FastAPI(title="Speaker Upsell POC", version=__version__, lifespan=lifespan)
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


# ---------------------------------------------------------------- accounts
class SignupBody(BaseModel):
    name: str
    email: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


def _set_session(request: Request, response: Response, user: auth.PublicUser) -> None:
    response.set_cookie(
        auth.COOKIE,
        auth.make_token(get_settings(), user.id),
        max_age=auth.SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


@app.middleware("http")
async def require_login(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Every /api route except the account ones needs a signed-in user (unless AUTH_REQUIRED=false)."""
    path = request.url.path
    s = get_settings()
    protected = s.auth_required and path.startswith("/api/") and not path.startswith("/api/auth/")
    if protected and auth.user_from_token(s, request.cookies.get(auth.COOKIE)) is None:
        return JSONResponse({"detail": "Please log in to continue."}, status_code=401)
    return await call_next(request)


@app.post("/api/auth/signup", status_code=201)
def signup(body: SignupBody, request: Request, response: Response) -> auth.PublicUser:
    try:
        user = auth.signup(get_settings(), body.name, body.email, body.password)
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message) from e
    _set_session(request, response, user)
    return user


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request, response: Response) -> auth.PublicUser:
    client_ip = request.client.host if request.client else ""
    if get_settings().demo_login and auth.is_demo_credentials(body.email, body.password):
        user = auth.demo_login(get_settings())
    else:
        try:
            user = auth.login(get_settings(), body.email, body.password, client_ip)
        except auth.AuthError as e:
            raise HTTPException(e.status, e.message) from e
    _set_session(request, response, user)
    return user


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(auth.COOKIE, path="/")


@app.get("/api/auth/me")
def me(request: Request) -> auth.PublicUser:
    user = auth.user_from_token(get_settings(), request.cookies.get(auth.COOKIE))
    if user is None and get_settings().auth_required:
        raise HTTPException(401, "Please log in to continue.")
    return user or auth.PublicUser(id="local", name="Local user", email="", role="admin")


def _current_user(request: Request) -> auth.PublicUser:
    s = get_settings()
    user = auth.user_from_token(s, request.cookies.get(auth.COOKIE))
    if user is None and not s.auth_required:
        return auth.PublicUser(id="local", name="Local user", email="", role="admin")
    if user is None:
        raise HTTPException(401, "Please log in to continue.")
    return user


def _require_admin(request: Request) -> None:
    if _current_user(request).role != "admin":
        raise HTTPException(403, "Only an administrator can change people.")


def _limit(request: Request, what: str, limit: int, window: float = 60.0) -> None:
    """Each signed-in user (or address, with login off) gets only so many of these a minute: they cost money."""
    who = _current_user(request).id
    if who == "local":
        who = request.client.host if request.client else ""
    if not auth.allow(f"{what}|{who}", limit, window):
        raise HTTPException(429, "Too many requests. Please wait a moment and try again.")


class LiveText(BaseModel):
    text: str


@app.post("/api/live-transcribe")
async def live_transcribe(
    request: Request,
    file: Annotated[UploadFile, File(description="A few seconds of audio from a recording in progress")],
    context: Annotated[str | None, Form()] = None,
) -> LiveText:
    """Preview text for the recorder: words only, no speakers. The saved recording is analysed separately."""
    _limit(request, "live", 20)  # the recorder sends one clip every 6 seconds
    data = await file.read(live.MAX_CLIP_BYTES + 1)
    if not data:
        raise HTTPException(400, "empty clip")
    if len(data) > live.MAX_CLIP_BYTES:
        raise HTTPException(413, "clip too large")
    try:
        text = await run_in_threadpool(
            live.transcribe_clip, get_settings(), data, file.filename or "clip.webm", context
        )
    except live.LiveUnavailable as e:
        raise HTTPException(502, "Live text is unavailable right now.") from e
    return LiveText(text=text)


@app.get("/api/auth/options")
def auth_options() -> dict[str, Any]:
    """What the login page may offer: sign-up is hidden once an admin has closed it, and the demo login is offered
    while it is switched on."""
    s = get_settings()
    return {
        "signup": s.auth_allow_signup or not auth.has_users(s),
        "demo": {"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD} if s.demo_login else None,
    }


# Job status / report / transcript responses go through `public` so spend, per-call logs and
# provider/model names stay in the stored files but never reach a client.
@app.get("/api/jobs")
def list_jobs(limit: int = 50) -> list[dict]:
    """All saved jobs, newest first - the 'Recent jobs' list is built from this, not the browser."""
    return [public.public_status(s) for s in jobs.list_statuses(get_storage(settings), max(1, min(limit, 200)))]


@app.post("/api/jobs", status_code=202)
async def create_job(
    request: Request,
    file: Annotated[UploadFile, File(description="Audio or video recording")],
    industry: Annotated[str | None, Form()] = None,
    product_catalog: Annotated[str | None, Form()] = None,
    salesperson_name: Annotated[str | None, Form()] = None,
) -> dict:
    _limit(request, "upload", 10, 600.0)
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
        # 'rahul' / 'Rahul ' become the one existing 'Rahul' instead of a second person.
        hint = await run_in_threadpool(dashboard.register_name, storage, (salesperson_name or "")[:80])
        status = await run_in_threadpool(
            jobs.create_job,
            storage,
            tmp_path,
            file.filename or "upload.bin",
            industry,
            product_catalog,
            hint,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
    await run_in_threadpool(jobs.enqueue, status.job_id, settings)
    return public.public_status(status)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    status = jobs.get_status(get_storage(settings), _check_id(job_id))
    if status is None:
        raise HTTPException(404, "job not found")
    return public.public_status(status)


@app.get("/api/jobs/{job_id}/report")
def job_report(job_id: str) -> dict:
    return public.public_report(_artifact(job_id, jobs.report_key))


@app.get("/api/jobs/{job_id}/outcomes", response_model=outcomes.JobOutcomes)
def job_outcomes(job_id: str) -> outcomes.JobOutcomes:
    """How each sales conversation went: what was pitched, whether it landed, and the call's overall feel."""
    report = jobs.parse_report(_artifact(job_id, jobs.report_key))
    if report is None:
        raise HTTPException(422, "this report was written by an older version and can't be read")
    return outcomes.job_outcomes(report)


@app.get("/api/jobs/{job_id}/transcript")
def job_transcript(job_id: str) -> dict:
    return public.public_transcript(_artifact(job_id, jobs.transcript_key))


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


@app.post("/api/jobs/{job_id}/retry", status_code=202)
def retry_job(job_id: str) -> dict:
    """Re-run a failed, cancelled or completed job; finished stages are reused from checkpoints."""
    storage = get_storage(settings)
    status = jobs.get_status(storage, _check_id(job_id))
    if status is None:
        raise HTTPException(404, "job not found")
    if status.status not in ("failed", "completed", "cancelled") and not jobs.is_stuck(status):
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
    return public.public_status(status)


@app.post("/api/jobs/{job_id}/cancel", status_code=202)
def cancel_job(job_id: str) -> dict:
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
    if jobs.is_stuck(status):  # nothing is running it, so there is nobody to notice a cancel request
        return public.public_status(
            jobs.update_status(storage, job_id, status="cancelled", stage="cancelled", error=jobs.INTERRUPTED)
        )
    return public.public_status(jobs.update_status(storage, job_id, cancel_requested=True))


@app.get("/api/dashboard", response_model=dashboard.Dashboard)
def get_dashboard(period: dashboard.Period = "day") -> dashboard.Dashboard:
    """Per-salesperson performance across every saved job, by day, week or month."""
    return dashboard.build_dashboard(get_storage(settings), period)


@app.get("/api/people/roster", response_model=list[dashboard.RosterEntry])
def people_roster() -> list[dashboard.RosterEntry]:
    """Known employees (merged duplicates folded together) and how many recordings each appears in."""
    return dashboard.build_roster(get_storage(settings))


@app.get("/api/people/{name}/recordings", response_model=list[dashboard.RecordingSummary])
def person_recordings(name: str) -> list[dashboard.RecordingSummary]:
    """Every completed recording one person appears in - newest first, not period-capped."""
    return dashboard.build_person_recordings(get_storage(settings), name)


class PersonName(BaseModel):
    job_id: str
    speaker: str
    name: str  # empty clears the assignment


@app.post("/api/people/name", status_code=204)
def name_person(body: PersonName, request: Request) -> Response:
    """Say who a speaker label in one recording really is, so their recordings are grouped."""
    _require_admin(request)
    storage = get_storage(settings)
    if jobs.get_status(storage, _check_id(body.job_id)) is None:
        raise HTTPException(404, "job not found")
    dashboard.set_name(storage, body.job_id, body.speaker, body.name[:80])
    return Response(status_code=204)


class PersonMerge(BaseModel):
    from_name: str
    into_name: str


@app.post("/api/people/merge", status_code=204)
def merge_people(body: PersonMerge, request: Request) -> Response:
    """Treat `from_name` as another spelling of `into_name`: everything under it now counts for `into_name`."""
    _require_admin(request)
    try:
        dashboard.merge_people(get_storage(settings), body.from_name[:80], body.into_name[:80])
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except KeyError as e:
        raise HTTPException(404, f"unknown person: {e.args[0]}") from e
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
