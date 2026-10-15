"""Cooperative stop signals shared by pipeline.py and analysis/conversation.py.

Kept in their own module (not pipeline.py) so analysis/conversation.py can catch
ConversationBudgetExceeded without importing pipeline.py and creating a cycle.
"""

from __future__ import annotations


class JobStopped(Exception):
    """Raised when a running job should stop entirely at the next checkpoint: user cancel
    or the per-job budget cap. Not a failure - run_job() records it as status "cancelled",
    not "failed". Finished stages are already checkpointed, so retrying resumes instead of
    starting over.
    """

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason  # "cancelled" | "budget_exceeded"
        self.message = message


class ConversationBudgetExceeded(Exception):
    """Raised when one conversation's own analysis cost crosses its per-conversation cap.

    Caught inside analyze_conversation(): only that conversation's remaining steps (upsell
    detection and/or escalation) are skipped. Other conversations and the rest of the job
    are not affected.
    """
