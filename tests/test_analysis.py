from __future__ import annotations

import numpy as np
from fakes import FakeLLM, fake_transcript

from upsell_poc.analysis.acoustics import estimate_pitch
from upsell_poc.analysis.scoring import effort_score, salesperson_metrics
from upsell_poc.analysis.structure import apply_speaker_merge, normalize_spans
from upsell_poc.schemas import (
    ConversationResult,
    ConversationSpan,
    RoleDetection,
    SpeakerRole,
    UpsellAnalysis,
)


def _upsell() -> UpsellAnalysis:
    result, _ = FakeLLM().generate(system="", user="", schema=UpsellAnalysis, effort="high", max_tokens=1)
    return result


def test_effort_score():
    # 2 attempts (3.0) + 2 techniques (1.33) + persistence (1.0)
    assert effort_score(_upsell()) == 5.3
    assert effort_score(_upsell().model_copy(update={"upsell_attempts": []})) == 0.0


def test_salesperson_metrics():
    t = fake_transcript()
    conv = ConversationResult(
        conversation_id=1,
        start=0,
        end=12,
        topic="shoes",
        language="hinglish",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["B"],
        upsell=_upsell(),
        attempted_upsell=True,
        effort_score=5.3,
    )
    no_upsell = conv.model_copy(
        update={
            "conversation_id": 2,
            "upsell": _upsell().model_copy(update={"upsell_attempts": []}),
            "attempted_upsell": False,
        }
    )
    [m] = salesperson_metrics([conv, no_upsell], t.segments)
    assert m.speaker == "A"
    assert m.conversations == 2 and m.conversations_with_upsell == 1 and m.upsell_rate == 0.5
    assert m.attempts_total == 2 and m.acceptance_rate == 0.5
    assert 0 < m.upsell_talk_time_share <= 1
    assert m.techniques_used == ["bundle", "cross_sell"]


def test_speaker_merge_relabels_chunk_labels():
    t = fake_transcript()
    t.segments[4] = t.segments[4].model_copy(update={"speaker": "c1_X"})
    roles = RoleDetection(
        has_sales_activity=True,
        speakers=[
            SpeakerRole(speaker="A", canonical_speaker="A", role="salesperson", title="Seller", reasoning=""),
            SpeakerRole(speaker="B", canonical_speaker="B", role="customer", title="Walk-in customer", reasoning=""),
            SpeakerRole(speaker="c1_X", canonical_speaker="A", role="salesperson", title="Seller", reasoning=""),
        ],
    )
    merged, role_map, title_map = apply_speaker_merge(t, roles)
    assert merged.segments[4].speaker == "A"
    assert role_map == {"A": "salesperson", "B": "customer"}
    assert title_map == {"A": "Seller", "B": "Walk-in customer"}


def _span(cid, a, b):
    return ConversationSpan(
        conversation_id=cid,
        start_segment_id=a,
        end_segment_id=b,
        topic="t",
        language="english",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["B"],
    )


def test_normalize_spans_fills_gaps_and_overlaps():
    t = fake_transcript()  # segment ids 0..5
    spans = normalize_spans([_span(9, 3, 5), _span(7, 0, 1), _span(8, 1, 2)], t, {})
    assert [(s.start_segment_id, s.end_segment_id) for s in spans] == [(0, 1), (2, 2), (3, 5)]
    assert [s.conversation_id for s in spans] == [1, 2, 3]


def test_normalize_spans_empty_falls_back_to_whole_recording():
    spans = normalize_spans([], fake_transcript(), {"A": "salesperson", "B": "customer"})
    assert len(spans) == 1 and spans[0].salespeople == ["A"]


def test_pitch_estimate_close_to_true_frequency():
    sr = 16000
    tt = np.arange(sr * 2) / sr
    pitch = estimate_pitch((0.3 * np.sin(2 * np.pi * 150 * tt)).astype(np.float32), sr)
    assert pitch is not None and abs(pitch - 150) < 5


def test_dotenv_is_exported_to_process_environment(tmp_path):
    """Provider SDKs read OPENAI_API_KEY / AWS_* from os.environ; Settings alone does not export them."""
    import subprocess
    import sys

    (tmp_path / ".env").write_text("SMOKE_TEST_KEY=from-dotenv\n")
    code = (
        "import os; from pathlib import Path; from dotenv import load_dotenv; "
        f"load_dotenv(Path({str(tmp_path / '.env')!r}), override=False); print(os.environ['SMOKE_TEST_KEY'])"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout
    assert out.strip() == "from-dotenv"


class _ToneClient:
    """Minimal OpenAI chat client returning a tone JSON for whatever turns it is given."""

    def __init__(self, content: str) -> None:
        from types import SimpleNamespace

        message = SimpleNamespace(content=content)
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(
                create=lambda **kw: SimpleNamespace(
                    choices=[SimpleNamespace(message=message)],
                    usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
                )
            )
        )


def test_tone_analysis_works_in_a_fresh_workdir_and_failures_are_optional(tmp_path):
    from conftest import requires_ffmpeg  # noqa: F401
    from fakes import make_wav

    from upsell_poc.analysis.tone import ToneAnalyzer
    from upsell_poc.config import ToneModelConfig

    wav = make_wav(tmp_path / "a.wav", seconds=12)
    segs = fake_transcript(12).segments
    good = '{"turns": [{"segment_id": 0, "speaker": "A", "mood": "calm", "intensity": 2, "vocal_cues": "steady"}]}'
    # workdir does not exist yet (this is what crashed a real job)
    tone = ToneAnalyzer(ToneModelConfig(), client=_ToneClient(good))  # type: ignore[arg-type]
    result = tone.analyze(wav, segs, tmp_path / "does" / "not" / "exist")
    assert result is not None and result.turns[0].mood == "calm"

    # An ffmpeg failure (bad input file) must disable tone for the conversation, not fail the job.
    broken = ToneAnalyzer(ToneModelConfig(), client=_ToneClient(good))  # type: ignore[arg-type]
    assert broken.analyze(tmp_path / "missing.wav", segs, tmp_path / "w") is None


def _conv_with(attempts):
    return ConversationResult(
        conversation_id=1,
        start=0,
        end=12,
        topic="shoes",
        language="hinglish",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["B"],
        # Greeting disabled here: these tests are about quote-correction, not the greeting kind
        # (that has its own test below).
        upsell=_upsell().model_copy(
            update={"upsell_attempts": attempts, "greeting_given": False, "greeting_quote": None}
        ),
    )


def test_evidence_corrects_wrong_segment_id_and_returns_surrounding_lines():
    from upsell_poc.analysis.evidence import attach_evidence

    t = fake_transcript()  # id 2: "...Sir, socks bhi le lijiye, combo mein 20% off hai."
    wrong = (
        _upsell()
        .upsell_attempts[0]
        .model_copy(update={"segment_id": 5, "quote": "Socks bhi le lijiye, combo mein 20% off"})
    )
    [conv], [ev] = attach_evidence([_conv_with([wrong])], t.segments, {"A": "salesperson", "B": "customer"})
    assert ev.segment_id == 2 and ev.quote_found
    assert conv.upsell.upsell_attempts[0].segment_id == 2  # corrected in the report too
    assert [line.segment_id for line in ev.lines] == [0, 1, 2, 3, 4]  # 2 lines either side
    assert [line.is_highlighted for line in ev.lines] == [False, False, True, False, False]
    assert ev.lines[1].role == "customer"


def test_evidence_fuzzy_match_and_unfindable_quote():
    from upsell_poc.analysis.evidence import attach_evidence

    t = fake_transcript()
    base = _upsell().upsell_attempts[0]
    fuzzy = base.model_copy(update={"segment_id": 0, "quote": "waterproof spray bhi aata hai shoes zyaada chalenge"})
    lost = base.model_copy(update={"segment_id": 3, "quote": "completely different invented sentence about laptops"})
    [conv], [ev1, ev2] = attach_evidence([_conv_with([fuzzy, lost])], t.segments, {"A": "salesperson"})
    assert ev1.segment_id == 4 and ev1.quote_found
    assert ev2.segment_id == 3 and not ev2.quote_found  # kept, but flagged
    assert conv.upsell.upsell_attempts[1].segment_id == 3


def test_evidence_covers_greeting_unanswered_question_and_customer_feedback():
    from upsell_poc.analysis.evidence import attach_evidence
    from upsell_poc.schemas import UnansweredQuestion

    t = fake_transcript()
    # id 1: "Mujhe running shoes chahiye, size nine." (B) - repurposed as an unanswered question.
    u = _upsell().model_copy(
        update={
            "upsell_attempts": [],
            "greeting_given": True,
            "greeting_quote": "Namaste sir, kya chahiye aapko?",
            "greeting_segment_id": 99,  # wrong on purpose - must be corrected like a quote
            "unanswered_questions": [
                UnansweredQuestion(
                    segment_id=4,  # wrong on purpose - the real line is id 1
                    speaker="B",
                    question="Mujhe running shoes chahiye, size nine.",
                    note="never confirmed",
                )
            ],
            "customer_feedback": "Customer felt rushed into the combo offer.",
            "customer_feedback_segment_id": 3,
        }
    )
    [conv], evs = attach_evidence(
        [_conv_with([]).model_copy(update={"upsell": u})], t.segments, {"A": "salesperson", "B": "customer"}
    )
    by_kind = {e.kind: e for e in evs}

    assert by_kind["greeting"].segment_id == 0 and by_kind["greeting"].quote_found  # corrected from 99
    assert conv.upsell.greeting_segment_id == 0

    assert by_kind["unanswered_question"].segment_id == 1 and by_kind["unanswered_question"].speaker == "B"
    assert conv.upsell.unanswered_questions[0].segment_id == 1

    fb = by_kind["customer_feedback"]
    assert fb.segment_id == 3 and fb.quote_found  # anchored, not text-matched (it's a paraphrase)
    assert next(line for line in fb.lines if line.is_highlighted).text == t.segments[3].text


def test_evidence_covers_frustration_even_when_upsell_is_none():
    """Mood still runs when the per-conversation budget cuts upsell short; its frustration
    moments should still get evidence."""
    from upsell_poc.analysis.evidence import attach_evidence
    from upsell_poc.schemas import FrustrationMoment, MoodAnalysis, SpeakerMood

    t = fake_transcript()
    conv = _conv_with([]).model_copy(
        update={
            "upsell": None,
            "budget_note": "stopped early",
            "mood": MoodAnalysis(
                speakers=[
                    SpeakerMood(
                        speaker="B", overall_mood="irritated", frustration_level=6, trend="worsening", summary="fed up"
                    )
                ],
                frustration_moments=[
                    FrustrationMoment(
                        segment_id=5, speaker="B", quote="sirf shoes", evidence_source="words", evidence="curt reply"
                    )
                ],
            ),
        }
    )
    [fixed], [ev] = attach_evidence([conv], t.segments, {"A": "salesperson", "B": "customer"})
    assert ev.kind == "frustration" and ev.segment_id == 3  # located the real "Nahi, sirf shoes." line
    assert fixed.mood.frustration_moments[0].segment_id == 3
    assert fixed.upsell is None  # untouched


def _full_span(cid=1):
    return ConversationSpan(
        conversation_id=cid,
        start_segment_id=0,
        end_segment_id=5,
        topic="running shoes",
        language="hinglish",
        is_sales_interaction=True,
        salespeople=["A"],
        customers=["B"],
    )


def test_analyze_conversation_degrades_gracefully_when_budget_exceeded_before_upsell(models_config):
    from upsell_poc.analysis.conversation import analyze_conversation
    from upsell_poc.control import ConversationBudgetExceeded
    from upsell_poc.llm.chain import LLMChain

    def over_budget():
        raise ConversationBudgetExceeded("over this conversation's budget")

    llm = FakeLLM()
    t = fake_transcript()
    result = analyze_conversation(
        LLMChain([llm], models_config.llm),
        None,
        None,
        _full_span(),
        t.segments,
        {"A": "salesperson", "B": "customer"},
        None,
        None,
        None,
        None,
        check_budget=over_budget,
    )
    assert result.mood is not None  # mood_fusion already ran before the check
    assert result.upsell is None  # upsell_detection never attempted
    assert result.budget_note == "over this conversation's budget"
    assert llm.calls == ["MoodAnalysis"]


def test_analyze_conversation_skips_only_escalation_when_budget_hits_at_that_point(models_config):
    from upsell_poc.analysis.conversation import analyze_conversation
    from upsell_poc.control import ConversationBudgetExceeded
    from upsell_poc.llm.chain import LLMChain

    calls = {"n": 0}

    def check_budget():
        calls["n"] += 1
        if calls["n"] == 2:  # 1st check (pre-upsell) passes; 2nd (pre-escalation) is over budget
            raise ConversationBudgetExceeded("over budget right before escalation")

    llm, escalation = FakeLLM(confidence=0.3), FakeLLM(confidence=0.95)
    t = fake_transcript()
    result = analyze_conversation(
        LLMChain([llm], models_config.llm),
        LLMChain([escalation], models_config.llm),
        0.5,
        _full_span(),
        t.segments,
        {"A": "salesperson", "B": "customer"},
        None,
        None,
        None,
        None,
        check_budget=check_budget,
    )
    assert result.upsell is not None and result.upsell.confidence == 0.3  # kept the primary result
    assert result.escalated is False
    assert result.budget_note == "over budget right before escalation"
    assert escalation.calls == []  # never called


def test_tone_parse_accepts_the_invented_mood_words_seen_in_real_runs():
    from upsell_poc.analysis.tone import parse_turns

    content = (
        'Sure! {"turns": ['
        '{"segment_id": 0, "speaker": "A", "mood": "friendly", "intensity": 2, "vocal_cues": "warm"},'
        '{"segment_id": 1, "speaker": "B", "mood": "curious", "intensity": 9, "vocal_cues": "rising pitch"},'
        '{"segment_id": 2, "speaker": "A", "mood": "satisfied", "intensity": 3, "vocal_cues": "relaxed"},'
        '{"segment_id": 3, "speaker": "B", "mood": "Annoyed", "intensity": 4, "vocal_cues": "sharp"},'
        '{"segment_id": 4, "speaker": "A", "mood": "zzz-unknown", "intensity": 3, "vocal_cues": "?"},'
        '{"segment_id": 99, "speaker": "A", "mood": "happy", "intensity": 3, "vocal_cues": "not in this clip"},'
        '{"speaker": "A", "mood": "happy"}'
        "]} trailing text"
    )
    turns = parse_turns(content, valid_ids={0, 1, 2, 3, 4, 5})
    assert [(t.segment_id, t.mood) for t in turns] == [
        (0, "happy"),  # friendly
        (1, "neutral"),  # curious
        (2, "happy"),  # satisfied
        (3, "irritated"),  # Annoyed (case-insensitive)
        (4, "neutral"),  # unknown word -> neutral, not a failure
    ]  # id 99 (not in clip) and the turn missing segment_id are skipped, not fatal
    assert turns[1].intensity == 5  # 9 clamped into 1-5


def test_tone_parse_returns_nothing_for_garbage():
    from upsell_poc.analysis.tone import parse_turns

    assert parse_turns("I could not hear anything.", {0, 1}) == []
    assert parse_turns('{"turns": "nope"}', {0, 1}) == []


def test_tone_analysis_survives_unknown_mood_words_and_records_usage(tmp_path):
    from fakes import make_wav

    from upsell_poc.analysis.tone import ToneAnalyzer
    from upsell_poc.config import ToneModelConfig

    wav = make_wav(tmp_path / "a.wav", seconds=12)
    segs = fake_transcript(12).segments
    content = (
        '{"turns": [{"segment_id": 0, "speaker": "A", "mood": "friendly", "intensity": 2, "vocal_cues": "warm"},'
        '{"segment_id": 1, "speaker": "B", "mood": "playful", "intensity": 3, "vocal_cues": "light"}]}'
    )
    calls = []
    tone = ToneAnalyzer(ToneModelConfig(), client=_ToneClient(content), on_call=calls.append)  # type: ignore[arg-type]
    result = tone.analyze(wav, segs, tmp_path / "w")
    assert result is not None and [t.mood for t in result.turns] == ["happy", "happy"]  # used to fail entirely
    assert calls[0].ok and calls[0].input_tokens == 1 and calls[0].cost_usd is not None


def test_failed_tone_answer_still_records_tokens_and_cost(tmp_path):
    """A billed call whose answer is unusable must still count toward the budget."""
    from fakes import make_wav

    from upsell_poc.analysis.tone import ToneAnalyzer
    from upsell_poc.config import ToneModelConfig

    wav = make_wav(tmp_path / "a.wav", seconds=12)
    calls = []
    tone = ToneAnalyzer(ToneModelConfig(), client=_ToneClient("sorry, no JSON"), on_call=calls.append)  # type: ignore[arg-type]
    assert tone.analyze(wav, fake_transcript(12).segments, tmp_path / "w") is None
    [entry] = calls
    assert not entry.ok and entry.error and entry.input_tokens == 1 and entry.cost_usd is not None
