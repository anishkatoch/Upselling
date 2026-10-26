"""Job records and queueing (inline thread for local dev, RQ + Redis for AWS)."""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pydantic import ValidationError

from upsell_poc.config import Settings, get_settings
from upsell_poc.schemas import JobReport, JobStatus
from upsell_poc.storage import Storage

log = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def status_key(job_id: str) -> str:
    return f"jobs/{job_id}/status.json"


def report_key(job_id: str) -> str:
    return f"jobs/{job_id}/report.json"


def transcript_key(job_id: str) -> str:
    return f"jobs/{job_id}/transcript.json"


def create_job(
    storage: Storage,
    local_file: Path,
    filename: str,
    industry: str | None = None,
    product_catalog: str | None = None,
    salesperson_name: str | None = None,
) -> JobStatus:
    job_id = uuid.uuid4().hex
    safe_name = Path(filename).name or "upload.bin"
    input_key = f"jobs/{job_id}/input/{safe_name}"
    storage.put_file(local_file, input_key)
    status = JobStatus(
        job_id=job_id,
        status="queued",
        filename=safe_name,
        input_key=input_key,
        industry=industry or None,
        product_catalog=product_catalog or None,
        salesperson_name=(salesperson_name or "").strip() or None,
        created_at=_now(),
        updated_at=_now(),
    )
    storage.put_json(status_key(job_id), status.model_dump())
    return status


def get_status(storage: Storage, job_id: str) -> JobStatus | None:
    data = storage.get_json(status_key(job_id))
    return JobStatus.model_validate(data) if data else None


_UPSELL_DEFAULTS: dict[str, object] = {
    "greeting_given": False,
    "greeting_quote": None,
    "greeting_segment_id": None,
    "products_discussed": [],
    "customer_feedback": None,
    "customer_feedback_segment_id": None,
    "unanswered_questions": [],
    "coaching_feedback": "",
}


def parse_report(raw: dict) -> JobReport | None:
    """Read a saved report, including ones written by older versions: fields added since then
    get empty defaults, and the old evidence format (unused by the dashboard and outcomes) is
    dropped. None if it still can't be read."""
    try:
        return JobReport.model_validate(raw)
    except ValidationError:
        pass
    upgraded = {**raw, "evidence": []}
    upgraded["conversations"] = [
        {**c, "upsell": {**_UPSELL_DEFAULTS, **c["upsell"]}} if isinstance(c.get("upsell"), dict) else c
        for c in raw.get("conversations", [])
    ]
    try:
        return JobReport.model_validate(upgraded)
    except ValidationError:
        return None


def list_statuses(storage: Storage, limit: int = 50) -> list[JobStatus]:
    """Every saved job, newest first (so the UI can list them from any browser)."""
    found: list[JobStatus] = []
    for job_id in storage.list_children("jobs"):
        try:
            status = get_status(storage, job_id)
        except Exception:  # a half-written or foreign folder must not break the list
            log.warning("skipping unreadable job %s", job_id)
            continue
        if status:
            found.append(status)
    found.sort(key=lambda s: s.created_at, reverse=True)
    return found[:limit]


def update_status(storage: Storage, job_id: str, **changes: object) -> JobStatus:
    status = get_status(storage, job_id)
    if status is None:
        raise KeyError(job_id)
    status = status.model_copy(update={**changes, "updated_at": _now()})
    storage.put_json(status_key(job_id), status.model_dump())
    return status


INTERRUPTED = "This was interrupted when the app restarted. Press Try again - nothing already done is repeated."
STUCK_AFTER = timedelta(minutes=30)  # a running job that has not moved for this long is treated as dead


def is_stuck(status: JobStatus, now: datetime | None = None) -> bool:
    """Queued or running, but no sign of life for STUCK_AFTER: its thread or worker is gone."""
    if status.status not in ("queued", "running"):
        return False
    try:
        last = datetime.fromisoformat(status.updated_at)
    except ValueError:
        return True
    return (now or datetime.now(UTC)) - last > STUCK_AFTER


def recover_interrupted(storage: Storage) -> int:
    """After a restart no inline job is still running: mark the ones that were so the person can retry them.

    Only for the in-process queue with a single web process; with Redis the worker owns its jobs.
    """
    n = 0
    for status in list_statuses(storage, limit=10_000):
        if status.status in ("queued", "running"):
            update_status(storage, status.job_id, status="failed", stage="interrupted", error=INTERRUPTED)
            n += 1
    return n


def enqueue(job_id: str, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if settings.queue_backend == "rq":
        from redis import Redis
        from rq import Queue

        queue = Queue(settings.queue_name, connection=Redis.from_url(settings.redis_url))
        queue.enqueue("upsell_poc.pipeline.run_job", job_id, job_timeout=settings.job_timeout_seconds, job_id=job_id)
        return

    from upsell_poc.pipeline import run_job

    threading.Thread(target=run_job, args=(job_id,), name=f"job-{job_id[:8]}", daemon=True).start()
