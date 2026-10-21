"""Client-facing views of stored data.

Stored files (status, report, transcript) keep the full internal detail - spend, per-call
logs, provider/model names - for debugging and billing. Nothing in this module changes
them: these helpers build the *copies* that leave over HTTP, with internals removed.
"""

from __future__ import annotations

from typing import Any

from upsell_poc.schemas import JobStatus

INCOMPLETE_NOTE = "analysis incomplete"
INCOMPLETE_ERROR = "analysis stopped before it could finish"

STATUS_HIDDEN = {"spent_usd", "budget_usd"}
REPORT_HIDDEN = {"spent_usd", "budget_usd", "unpriced_calls", "calls", "transcription_provider"}
CONVERSATION_HIDDEN = {"analyzed_by", "escalated"}
TRANSCRIPT_HIDDEN = {"provider", "model", "acoustics", "roles"}


def public_status(status: JobStatus) -> dict[str, Any]:
    out = status.model_dump(exclude=STATUS_HIDDEN)
    # A budget stop's message quotes dollar amounts.
    if out.get("error") and "$" in out["error"]:
        out["error"] = INCOMPLETE_ERROR
    return out


def public_conversation(conv: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in conv.items() if k not in CONVERSATION_HIDDEN}
    if out.get("budget_note"):
        out["budget_note"] = INCOMPLETE_NOTE
    return out


def public_report(report: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in report.items() if k not in REPORT_HIDDEN}
    if isinstance(out.get("conversations"), list):
        out["conversations"] = [public_conversation(c) for c in out["conversations"]]
    return out


def public_transcript(transcript: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in transcript.items() if k not in TRANSCRIPT_HIDDEN}
