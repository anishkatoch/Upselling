"""Offline fakes for providers so the pipeline can be tested without API keys."""

from __future__ import annotations

from pathlib import Path

from upsell_poc import audio
from upsell_poc.llm.base import Usage
from upsell_poc.schemas import (
    SpeakerRepair,
    ConversationSpan,
    ConversationSplit,
    MoodAnalysis,
    RoleDetection,
    Segment,
    SpeakerMood,
    SpeakerRole,
    Transcript,
    UpsellAnalysis,
    UpsellAttempt,
)

SCRIPT = [
    ("A", "Namaste sir, kya chahiye aapko?"),
    ("B", "Mujhe running shoes chahiye, size nine."),
    ("A", "Ye dekhiye, 2999 ke hain. Sir, socks bhi le lijiye, combo mein 20% off hai."),
    ("B", "Nahi, sirf shoes."),
    ("A", "Waterproof spray bhi aata hai, shoes zyada chalenge."),
    ("B", "Theek hai, spray de do."),
]


def fake_transcript(duration: float = 12.0) -> Transcript:
    step = duration / len(SCRIPT)
    segs = [
        Segment(id=i, speaker=spk, start=i * step, end=(i + 1) * step - 0.2, text=text)
        for i, (spk, text) in enumerate(SCRIPT)
    ]
    return Transcript(duration=duration, segments=segs, provider="fake", model="fake")


class FakeTranscriber:
    name = "fake:transcriber"
    model = "fake"

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def transcribe(self, wav: Path, workdir: Path) -> Transcript:
        if self.fail:
            raise RuntimeError("boom")
        return fake_transcript(audio.probe_duration(wav))


class FakeLLM:
    name = "fake:llm"
    model = "fake-llm"

    def __init__(self, confidence: float = 0.9) -> None:
        self.calls: list[str] = []
        self.confidence = confidence

    def generate(self, *, system, user, schema, effort, max_tokens):  # type: ignore[no-untyped-def]
        self.calls.append(schema.__name__)
        if schema is RoleDetection:
            return RoleDetection(
                has_sales_activity=True,
                speakers=[
                    SpeakerRole(
                        speaker="A",
                        canonical_speaker="A",
                        role="salesperson",
                        title="Seller",
                        reasoning="quotes prices",
                    ),
                    SpeakerRole(
                        speaker="B",
                        canonical_speaker="B",
                        role="customer",
                        title="Walk-in customer",
                        reasoning="asks for shoes",
                    ),
                ],
            ), Usage(100, 20)
        if schema is ConversationSplit:
            return ConversationSplit(
                conversations=[
                    ConversationSpan(
                        conversation_id=1,
                        start_segment_id=0,
                        end_segment_id=5,
                        topic="running shoes",
                        language="hinglish",
                        is_sales_interaction=True,
                        salespeople=["A"],
                        customers=["B"],
                    )
                ]
            ), Usage()
        if schema is MoodAnalysis:
            return MoodAnalysis(
                speakers=[
                    SpeakerMood(
                        speaker="A", overall_mood="calm", frustration_level=0, trend="stable", summary="polite"
                    ),
                    SpeakerMood(speaker="B", overall_mood="neutral", frustration_level=2, trend="stable", summary="ok"),
                ],
                frustration_moments=[],
            ), Usage()
        if schema is UpsellAnalysis:
            return UpsellAnalysis(
                customer_requested=["running shoes"],
                upsell_attempts=[
                    UpsellAttempt(
                        salesperson="A",
                        segment_id=2,
                        quote="socks bhi le lijiye",
                        technique="bundle",
                        offered_item="socks",
                        salesperson_initiated=True,
                        after_customer_rejection=False,
                        handled_objection=False,
                        customer_response="rejected",
                        customer_mood="neutral",
                    ),
                    UpsellAttempt(
                        salesperson="A",
                        segment_id=4,
                        quote="Waterproof spray bhi aata hai",
                        technique="cross_sell",
                        offered_item="spray",
                        salesperson_initiated=True,
                        after_customer_rejection=True,
                        handled_objection=False,
                        customer_response="accepted",
                        customer_mood="neutral",
                    ),
                ],
                excluded_candidates=["Ye dekhiye -> customer asked for shoes"],
                pushy_upsell=False,
                pushy_reason="",
                confidence=self.confidence,
                summary="Two attempts.",
                greeting_given=True,
                greeting_quote="Namaste sir, kya chahiye aapko?",
                greeting_segment_id=0,
                products_discussed=["running shoes"],
                customer_feedback=None,
                customer_feedback_segment_id=None,
                unanswered_questions=[],
                coaching_feedback="Good opening greeting; next time confirm the customer's budget before offering "
                "a discount.",
            ), Usage()
        if schema is SpeakerRepair:
            return SpeakerRepair(fixes=[]), Usage()
        raise AssertionError(f"unexpected schema {schema}")


def make_wav(path: Path, seconds: float = 12.0) -> Path:
    """Tone bursts separated by silence, so silence detection has something to find."""
    import subprocess

    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=180:duration={seconds}",
            "-af",
            "volume='if(lt(mod(t,2),1.4),1,0)':eval=frame",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(path),
        ],
        check=True,
    )
    return path
