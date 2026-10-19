import json
from pathlib import Path

from upsell_poc import dashboard, outcomes
from upsell_poc.schemas import JobReport

DUMMY_REPORT = Path(__file__).parents[1] / "frontend/src/data/dummy-report.json"


def _report() -> JobReport:
    return JobReport.model_validate(json.loads(DUMMY_REPORT.read_text(encoding="utf-8")))


def test_outcomes_count_what_was_pitched_and_how_it_went():
    report = _report()
    result = outcomes.job_outcomes(report)
    sales = [c for c in report.conversations if c.is_sales_interaction]
    assert len(result.calls) == len(sales)
    assert result.positive + result.neutral + result.negative == len(sales)
    total = sum(len(c.upsell.upsell_attempts) for c in sales if c.upsell)
    assert sum(p.tried for p in result.by_salesperson) == total
    for call in result.calls:
        assert call.accepted + call.rejected + call.open == len(call.pitched)
        assert call.sentiment_reasons


def test_sentiment_rules():
    report = _report()
    conv = next(c for c in report.conversations if c.is_sales_interaction and c.upsell and c.mood)

    def with_(frustration: int, accepted: bool, pushy: bool):
        mood = conv.mood.model_copy(
            update={
                "speakers": [
                    m.model_copy(update={"frustration_level": frustration}) if m.speaker in conv.customers else m
                    for m in conv.mood.speakers
                ]
            }
        )
        attempts = [
            a.model_copy(update={"customer_response": "accepted" if accepted else "rejected"})
            for a in conv.upsell.upsell_attempts
        ]
        upsell = conv.upsell.model_copy(
            update={"upsell_attempts": attempts, "pushy_upsell": pushy, "unanswered_questions": []}
        )
        return outcomes.call_outcome(conv.model_copy(update={"mood": mood, "upsell": upsell}))

    assert with_(1, True, False).sentiment == "positive"
    assert with_(1, False, False).sentiment == "neutral"
    assert with_(7, True, False).sentiment == "negative"
    assert with_(4, False, True).sentiment == "negative"
    assert with_(1, True, False).upsell_result == "won"
    assert with_(1, False, False).upsell_result == "lost"


def test_upsell_unknown_when_analysis_was_cut_short():
    conv = next(c for c in _report().conversations if c.is_sales_interaction).model_copy(update={"upsell": None})
    call = outcomes.call_outcome(conv)
    assert call.upsell_result == "unknown" and call.pitched == []


def _bucket(**kw) -> dashboard.Bucket:
    base = {
        "period": "all", "conversations": 10, "upsell_rate": 0.7, "attempts": 12, "acceptance_rate": 0.5,
        "avg_effort": 7.0, "greeting_rate": 0.9, "unanswered_questions": 0, "pushy_conversations": 0,
        "avg_customer_frustration": 2.0, "attempts_per_conversation": 1.2, "techniques": ["bundle", "upgrade", "cross_sell"],
    }  # fmt: skip
    return dashboard.Bucket(**{**base, **kw})


def test_assessment_strong_and_weak():
    strong = dashboard.assess(_bucket(), [_bucket()])
    assert strong.rating == "strong" and strong.effort_level == "high" and not strong.improvements
    weak = dashboard.assess(
        _bucket(
            upsell_rate=0.1, acceptance_rate=0.0, avg_effort=1.5, greeting_rate=0.2, unanswered_questions=6,
            pushy_conversations=5, avg_customer_frustration=7.0, techniques=["bundle"],
        ),
        [],
    )  # fmt: skip
    assert weak.rating == "needs_work" and weak.effort_level == "low"
    assert len(weak.improvements) >= 5


def test_assessment_no_attempts_and_small_sample_and_trend():
    idle = dashboard.assess(_bucket(attempts=0, avg_effort=0.0, upsell_rate=0.0, acceptance_rate=None), [])
    assert idle.effort_level == "none"
    small = dashboard.assess(_bucket(conversations=2), [])
    assert small.low_sample and any("first impression" in x for x in small.improvements)
    up = dashboard.assess(_bucket(), [_bucket(period="a", avg_effort=3.0), _bucket(period="b", avg_effort=5.0)])
    down = dashboard.assess(_bucket(), [_bucket(period="a", avg_effort=5.0), _bucket(period="b", avg_effort=2.0)])
    assert up.trend == "improving" and down.trend == "declining"


def test_reports_from_older_versions_still_load():
    from upsell_poc import jobs

    raw = _report().model_dump(mode="json")
    for c in raw["conversations"]:
        if c["upsell"]:
            for k in (
                "greeting_given",
                "greeting_quote",
                "greeting_segment_id",
                "products_discussed",
                "customer_feedback",
                "customer_feedback_segment_id",
                "unanswered_questions",
                "coaching_feedback",
            ):
                del c["upsell"][k]  # fmt: skip
    raw["evidence"] = [{"conversation_id": 1, "segment_id": 1, "is_attempt": False}]
    assert jobs.parse_report(raw) is not None
    assert jobs.parse_report({"nonsense": True}) is None
