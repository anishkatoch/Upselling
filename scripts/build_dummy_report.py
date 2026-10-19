"""Build the sample report used by the frontend's "View sample report" button.

Built from the project's real schemas and real scoring/evidence functions (not hand-typed
JSON), so it can never go invalid and the numbers it shows are computed the same way a real
report's are. Run this after changing schemas.py or the scoring/evidence logic.

Writes plain JSON files into frontend/src/data/, which the React app imports directly (bundled
at build time - no extra request). scripts/build_demo_dashboard.py imports `report` from this
module as its own template, so run this one first if both need regenerating.

    uv run python scripts/build_dummy_report.py
"""

from __future__ import annotations

import json
from pathlib import Path

from upsell_poc.analysis.evidence import attach_evidence
from upsell_poc.analysis.scoring import effort_score, salesperson_metrics
from upsell_poc.cost import estimate_cost_usd
from upsell_poc.schemas import (
    CallLog,
    ConversationResult,
    FrustrationMoment,
    MoodAnalysis,
    RoleDetection,
    Segment,
    SpeakerMood,
    SpeakerRole,
    SpeakerSummary,
    Transcript,
    UnansweredQuestion,
    UpsellAnalysis,
    UpsellAttempt,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "src" / "data"

# ---------------------------------------------------------------- transcript

RAW_SEGMENTS = [
    # (speaker, start, end, text)
    # Conversation 1 - a clean, representative example: greeting, two upsells (one rejected,
    # one accepted after the rejection), an unanswered question, a frustration moment.
    ("A", 0.0, 4.5, "Namaste sir, main Arjun, kaise help kar sakta hoon?"),
    ("B", 5.0, 11.0, "Mujhe running shoes chahiye, size nine. Kitna time lagega agar order karna pade?"),
    ("A", 11.5, 19.0, "Ye dekhiye, 2999 ke hain. Sir, socks bhi le lijiye, combo mein 20% off hai."),
    ("B", 19.5, 23.0, "Nahi, sirf shoes chahiye abhi."),
    ("A", 23.5, 29.0, "Waterproof spray bhi aata hai, shoes zyada chalenge."),
    ("B", 29.5, 36.0, "Theek hai, par itni baar push mat kijiye, mujhe thoda irritate ho raha hai."),
    ("B", 36.5, 40.0, "Spray de do, aur billing kar do jaldi."),
    ("A", 40.5, 44.0, "Bill ready hai sir, total 3599."),
    # Conversation 2 - a pushy, escalated example with no greeting.
    ("C", 70.0, 74.0, "Hi, I wanted to just pay my bill."),
    (
        "A",
        74.5,
        83.0,
        "Sure. While I have you, would you like to upgrade to our premium data plan? "
        "Only 200 rupees more for double data.",
    ),
    ("C", 83.5, 86.5, "No thanks, just the bill please."),
    (
        "A",
        87.0,
        96.0,
        "This plan really is a great deal, most customers who switch never go back - should I just add it for you?",
    ),
    ("C", 96.5, 101.0, "I already said no. Can we please just process the payment?"),
    ("A", 101.5, 104.0, "Of course, right away."),
    # Conversation 3 - not a sale.
    ("A", 130.0, 132.5, "Chai peene chalein?"),
    ("D", 133.0, 136.0, "Haan, do minute mein aata hoon."),
    ("A", 136.5, 138.0, "Theek hai, chalo."),
    # Conversation 4 - per-conversation budget cut it short (mood ran, upsell did not).
    ("A", 160.0, 166.0, "Sir ek protection plan bhi hai is product ke saath, bahut accha coverage milta hai."),
    ("E", 166.5, 170.0, "Pehle bataiye ye kya hai, kitna cost hoga?"),
    ("A", 170.5, 174.0, "Ye extra protection hai jo..."),
]
SEGMENTS = [Segment(id=i, speaker=s, start=a, end=b, text=t) for i, (s, a, b, t) in enumerate(RAW_SEGMENTS)]
TRANSCRIPT = Transcript(
    duration=185.0,
    segments=SEGMENTS,
    provider="openai:gpt-4o-transcribe-diarize",
    model="gpt-4o-transcribe-diarize",
    chunks=1,
)

ROLES = RoleDetection(
    has_sales_activity=True,
    speakers=[
        SpeakerRole(
            speaker="A",
            canonical_speaker="A",
            role="salesperson",
            title="Senior Sales Associate",
            reasoning="Quotes prices, offers products across every conversation.",
        ),
        SpeakerRole(
            speaker="B",
            canonical_speaker="B",
            role="customer",
            title="Walk-in customer",
            reasoning="Asks for shoes, decides what to buy.",
        ),
        SpeakerRole(
            speaker="C",
            canonical_speaker="C",
            role="customer",
            title="Returning customer (phone)",
            reasoning="Calls in to pay a bill, declines upsells.",
        ),
        SpeakerRole(
            speaker="D",
            canonical_speaker="D",
            role="other",
            title="Co-worker",
            reasoning="Casual break-time chat, not a customer.",
        ),
        SpeakerRole(
            speaker="E",
            canonical_speaker="E",
            role="customer",
            title="New lead (online enquiry)",
            reasoning="Asks what the product is and its cost.",
        ),
    ],
)
ROLE_MAP = {s.speaker: s.role for s in ROLES.speakers}

# ---------------------------------------------------------------- conversations

CONVERSATIONS = [
    ConversationResult(
        conversation_id=1,
        start=0.0,
        end=44.0,
        topic="Running shoes purchase",
        language="hinglish",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["B"],
        mood=MoodAnalysis(
            speakers=[
                SpeakerMood(
                    speaker="A",
                    overall_mood="calm",
                    frustration_level=0,
                    trend="stable",
                    summary="Polite and attentive throughout.",
                ),
                SpeakerMood(
                    speaker="B",
                    overall_mood="impatient",
                    frustration_level=4,
                    trend="worsening",
                    summary="Patient at first, then pushed back on repeated upselling.",
                ),
            ],
            frustration_moments=[
                FrustrationMoment(
                    segment_id=5,
                    speaker="B",
                    quote="itni baar push mat kijiye, mujhe thoda irritate ho raha hai",
                    evidence_source="words",
                    evidence="Direct complaint about being upsold repeatedly.",
                ),
            ],
        ),
        upsell=UpsellAnalysis(
            customer_requested=["running shoes"],
            upsell_attempts=[
                UpsellAttempt(
                    salesperson="A",
                    segment_id=2,
                    quote="Sir, socks bhi le lijiye, combo mein 20% off hai.",
                    technique="bundle",
                    offered_item="socks",
                    salesperson_initiated=True,
                    after_customer_rejection=False,
                    handled_objection=False,
                    customer_response="rejected",
                    customer_mood="calm",
                ),
                UpsellAttempt(
                    salesperson="A",
                    segment_id=4,
                    quote="Waterproof spray bhi aata hai, shoes zyada chalenge.",
                    technique="cross_sell",
                    offered_item="waterproof spray",
                    salesperson_initiated=True,
                    after_customer_rejection=True,
                    handled_objection=False,
                    customer_response="accepted",
                    customer_mood="impatient",
                ),
            ],
            excluded_candidates=["Ye dekhiye, 2999 ke hain -> customer asked for shoes, this is the main item"],
            pushy_upsell=False,
            pushy_reason="",
            confidence=0.92,
            summary="Two upsell attempts; the second landed after the customer pushed back on the first.",
            greeting_given=True,
            greeting_quote="Namaste sir, main Arjun, kaise help kar sakta hoon?",
            greeting_segment_id=0,
            products_discussed=["running shoes", "socks", "waterproof spray"],
            customer_feedback="Customer felt upsold too many times before their delivery-time question got answered.",
            customer_feedback_segment_id=5,
            unanswered_questions=[
                UnansweredQuestion(
                    segment_id=1,
                    speaker="B",
                    question="Kitna time lagega agar order karna pade?",
                    note="Salesperson moved straight to showing a product and never answered this.",
                ),
            ],
            coaching_feedback="Good warm opening greeting. Answer the customer's own question (delivery "
            "time) before offering add-ons - leading with the bundle before addressing what they asked is "
            "what triggered the pushback.",
        ),
        analyzed_by="bedrock",
    ),
    ConversationResult(
        conversation_id=2,
        start=70.0,
        end=104.0,
        topic="Phone bill payment",
        language="english",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["C"],
        mood=MoodAnalysis(
            speakers=[
                SpeakerMood(
                    speaker="A",
                    overall_mood="calm",
                    frustration_level=0,
                    trend="stable",
                    summary="Stayed polite despite being told no twice.",
                ),
                SpeakerMood(
                    speaker="C",
                    overall_mood="frustrated",
                    frustration_level=7,
                    trend="worsening",
                    summary="Increasingly short replies after being upsold twice in a simple bill-payment call.",
                ),
            ],
            frustration_moments=[
                # Deliberately not a verbatim quote, to show the "not matched exactly" case honestly.
                FrustrationMoment(
                    segment_id=12,
                    speaker="C",
                    quote="just process the payment already",
                    evidence_source="words",
                    evidence="Curt, clipped tone after two declined upsells.",
                ),
            ],
        ),
        upsell=UpsellAnalysis(
            customer_requested=["pay phone bill"],
            upsell_attempts=[
                UpsellAttempt(
                    salesperson="A",
                    segment_id=9,
                    quote="would you like to upgrade to our premium data plan? Only 200 rupees more for double data.",
                    technique="plan_upgrade",
                    offered_item="premium data plan",
                    salesperson_initiated=True,
                    after_customer_rejection=False,
                    handled_objection=False,
                    customer_response="rejected",
                    customer_mood="neutral",
                ),
                UpsellAttempt(
                    salesperson="A",
                    segment_id=11,
                    quote="most customers who switch never go back - should I just add it for you?",
                    technique="social_proof",
                    offered_item="premium data plan",
                    salesperson_initiated=True,
                    after_customer_rejection=True,
                    handled_objection=False,
                    customer_response="rejected",
                    customer_mood="frustrated",
                ),
            ],
            excluded_candidates=[],
            pushy_upsell=True,
            pushy_reason="Offered the same plan a second time, after a clear 'no', while the customer was "
            "getting frustrated.",
            confidence=0.55,
            summary="Two attempts to upgrade the plan during a simple bill payment; both rejected, the "
            "second while the customer was visibly frustrated.",
            greeting_given=False,
            greeting_quote=None,
            greeting_segment_id=None,
            products_discussed=["phone bill payment", "premium data plan"],
            customer_feedback="Customer wanted to pay their bill and found the repeated plan pitch frustrating.",
            customer_feedback_segment_id=12,
            unanswered_questions=[],
            coaching_feedback="Skip the no-greeting, straight-to-business opener and pushing the same declined offer "
            "twice next time - re-pitching right after a clear 'no' is what escalated the customer's frustration here.",
        ),
        analyzed_by="openai",
        escalated=True,  # attempted_upsell and effort_score are filled in below
    ),
    ConversationResult(
        conversation_id=3,
        start=130.0,
        end=138.0,
        topic="Break-time chat",
        language="hinglish",
        is_sales_interaction=False,
        salespeople=[],
        customers=[],
    ),
    ConversationResult(
        conversation_id=4,
        start=160.0,
        end=174.0,
        topic="Protection plan enquiry",
        language="hinglish",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["E"],
        mood=MoodAnalysis(
            speakers=[
                SpeakerMood(
                    speaker="A",
                    overall_mood="calm",
                    frustration_level=0,
                    trend="stable",
                    summary="Just getting started.",
                ),
                SpeakerMood(
                    speaker="E",
                    overall_mood="confused",
                    frustration_level=1,
                    trend="stable",
                    summary="Asking clarifying questions, not frustrated.",
                ),
            ],
            frustration_moments=[],
        ),
        budget_note="Stopped this conversation's analysis: estimated spend reached $5.10, at or above the "
        "$5.00 per-conversation budget. Other conversations in this job are not affected.",
    ),
]

merged, evidence = attach_evidence(CONVERSATIONS, SEGMENTS, ROLE_MAP)  # type: ignore[arg-type]
for conv in merged:
    if conv.upsell:
        conv.effort_score = effort_score(conv.upsell)
        conv.attempted_upsell = bool(conv.upsell.upsell_attempts)

# ---------------------------------------------------------------- calls + cost

RAW_CALLS = [
    ("transcription", "openai:gpt-4o-transcribe-diarize", "gpt-4o-transcribe-diarize", True, 38.4, None, None, 0),
    (
        "role_detection",
        "bedrock:anthropic.claude-sonnet-5-5@us-east-1",
        "anthropic.claude-sonnet-5-5",
        True,
        2.1,
        3800,
        420,
        0,
    ),
    (
        "conversation_splitting",
        "bedrock:anthropic.claude-sonnet-5-5@us-east-1",
        "anthropic.claude-sonnet-5-5",
        True,
        1.8,
        4100,
        510,
        0,
    ),
    ("tone", "openai:gpt-audio-1.5", "gpt-audio-1.5", True, 5.2, 9200, 180, 0),
    (
        "mood_fusion",
        "bedrock:anthropic.claude-sonnet-5-5@us-east-1",
        "anthropic.claude-sonnet-5-5",
        False,
        12.0,
        None,
        None,
        0,
    ),
    (
        "mood_fusion",
        "bedrock:anthropic.claude-sonnet-5-5@us-west-2",
        "anthropic.claude-sonnet-5-5",
        True,
        2.4,
        2900,
        340,
        1,
    ),
    (
        "upsell_detection",
        "bedrock:anthropic.claude-sonnet-5-5@us-east-1",
        "anthropic.claude-sonnet-5-5",
        True,
        3.1,
        3600,
        610,
        0,
    ),
    ("upsell_detection", "openai:gpt-6.1-sol", "gpt-6.1-sol", True, 4.6, 3400, 580, 0),
    (
        "upsell_detection",
        "bedrock:anthropic.claude-opus-5-5@us-east-1",
        "anthropic.claude-opus-5-5",
        True,
        5.3,
        4200,
        720,
        0,
    ),
]
CALLS = [
    CallLog(
        step=step,
        provider=provider,
        model=model,
        ok=ok,
        latency_s=latency,
        input_tokens=it,
        output_tokens=ot,
        cost_usd=estimate_cost_usd(model, it, ot),
        error=None if ok else "RateLimitError: 429 (retried, then failed over)",
        fallback_index=fb,
    )
    for step, provider, model, ok, latency, it, ot, fb in RAW_CALLS
]
spent_usd = round(sum(c.cost_usd for c in CALLS if c.cost_usd is not None), 4)
unpriced_calls = sum(1 for c in CALLS if c.ok and c.cost_usd is None)

# ---------------------------------------------------------------- speakers + report

talk: dict[str, float] = {}
for seg in SEGMENTS:
    talk[seg.speaker] = talk.get(seg.speaker, 0.0) + seg.duration
title_of = {s.speaker: s.title for s in ROLES.speakers}
speakers = [
    SpeakerSummary(speaker=sp, role=ROLE_MAP[sp], title=title_of.get(sp), talk_time_s=round(t, 1))  # type: ignore[arg-type]
    for sp, t in sorted(talk.items(), key=lambda kv: -kv[1])
]

report = {
    "job_id": "dummy",
    "source_filename": "sample_store_visit.wav",
    "duration_s": TRANSCRIPT.duration,
    "transcription_provider": TRANSCRIPT.provider,
    "speakers": [s.model_dump(mode="json") for s in speakers],
    "has_sales_activity": True,
    "conversations": [c.model_dump(mode="json") for c in merged],
    "salespeople": [m.model_dump(mode="json") for m in salesperson_metrics(merged, SEGMENTS)],
    "calls": [c.model_dump(mode="json") for c in CALLS],
    "evidence": [e.model_dump(mode="json") for e in evidence],
    "spent_usd": spent_usd,
    "budget_usd": 4.0,
    "unpriced_calls": unpriced_calls,
}
transcript_doc = {
    "transcript": TRANSCRIPT.model_dump(mode="json"),
    "roles": ROLES.model_dump(mode="json"),
    "acoustics": [],
}


def main() -> None:
    from upsell_poc.outcomes import job_outcomes
    from upsell_poc.schemas import JobReport

    outcomes_doc = job_outcomes(JobReport.model_validate(report)).model_dump(mode="json")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "dummy-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "dummy-transcript.json").write_text(
        json.dumps(transcript_doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA_DIR / "dummy-outcomes.json").write_text(
        json.dumps(outcomes_doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote dummy report/transcript/outcomes ({len(json.dumps(report))} bytes) into {DATA_DIR}")


if __name__ == "__main__":
    main()
