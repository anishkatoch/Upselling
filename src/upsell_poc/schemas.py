"""Data models.

Models in the "LLM output" section are sent to Claude (output_format) and OpenAI
(structured outputs) as JSON schemas, so they avoid defaults, dicts and numeric
constraints that strict schema modes reject. Ranges are stated in descriptions
and clamped in code.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- transcript


class Segment(BaseModel):
    id: int
    speaker: str
    start: float
    end: float
    text: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


class Transcript(BaseModel):
    duration: float
    segments: list[Segment]
    provider: str
    model: str | None = None
    chunks: int = 1

    @property
    def speakers(self) -> list[str]:
        seen: dict[str, None] = {}
        for s in self.segments:
            seen.setdefault(s.speaker, None)
        return list(seen)


# ---------------------------------------------------------------- LLM output

Role = Literal["salesperson", "customer", "other"]
Language = Literal["english", "hindi", "hinglish", "other"]
Mood = Literal["happy", "calm", "neutral", "confused", "impatient", "irritated", "frustrated", "angry"]
Technique = Literal[
    "cross_sell",
    "upgrade",
    "bundle",
    "discount_offer",
    "warranty_protection",
    "plan_upgrade",
    "membership_loyalty",
    "scarcity_urgency",
    "social_proof",
    "other",
]
CustomerResponse = Literal["accepted", "rejected", "undecided", "no_response"]


class SpeakerRole(BaseModel):
    speaker: str = Field(description="Speaker label exactly as it appears in the transcript.")
    canonical_speaker: str = Field(
        description="Label to merge this speaker into if it is the same person as another "
        "label (e.g. split across audio chunks); otherwise the same as `speaker`."
    )
    role: Role
    title: str = Field(
        description="A short, specific real-world label for who this person actually is, beyond the "
        "three-way role bucket - e.g. 'Seller', 'Insurance agent', 'Prospective buyer / CFO', 'Support "
        "call recipient', 'Decision maker not yet convinced'. Infer it from how they talk and what they "
        "say; use 'Unclear' only if there is truly nothing to go on."
    )
    reasoning: str = Field(description="One short sentence citing what they say.")


class SpeakerFix(BaseModel):
    segment_id: int
    speaker: str = Field(description="Existing label, or a new label such as 'Speaker 3' for a person not yet labelled.")
    role: Literal["salesperson", "customer", "other"]
    title: str = Field(description="Short real-world description of this person; used only for new labels.")


class SpeakerRepair(BaseModel):
    fixes: list[SpeakerFix] = Field(description="Only segments whose speaker label is wrong. Empty if the labels are right.")


class RoleDetection(BaseModel):
    has_sales_activity: bool
    speakers: list[SpeakerRole]


class ConversationSpan(BaseModel):
    conversation_id: int
    start_segment_id: int
    end_segment_id: int
    topic: str
    language: Language
    is_sales_interaction: bool
    salespeople: list[str]
    customers: list[str]


class ConversationSplit(BaseModel):
    conversations: list[ConversationSpan]


class TurnTone(BaseModel):
    segment_id: int
    speaker: str
    mood: Mood
    intensity: int = Field(description="1 (barely) to 5 (very strong).")
    vocal_cues: str = Field(description="What in the voice shows it: pitch, volume, pace, sighs.")


class ToneAnalysis(BaseModel):
    turns: list[TurnTone]


class SpeakerMood(BaseModel):
    speaker: str
    overall_mood: Mood
    frustration_level: int = Field(description="0 (none) to 10 (extreme): the worst it got during the conversation.")
    trend: Literal["improving", "stable", "worsening"]
    summary: str


class FrustrationMoment(BaseModel):
    segment_id: int
    speaker: str
    quote: str
    evidence_source: Literal["words", "voice", "both"]
    evidence: str


class MoodAnalysis(BaseModel):
    speakers: list[SpeakerMood]
    frustration_moments: list[FrustrationMoment]


class UpsellAttempt(BaseModel):
    salesperson: str
    segment_id: int
    quote: str = Field(description="Exact words from the transcript, original language.")
    technique: Technique
    offered_item: str
    salesperson_initiated: bool
    after_customer_rejection: bool = Field(
        description="True if the customer had already declined an upsell in this conversation."
    )
    handled_objection: bool = Field(
        description="True if the salesperson answered a customer objection to make this offer."
    )
    customer_response: CustomerResponse
    customer_mood: Mood


class UnansweredQuestion(BaseModel):
    segment_id: int
    speaker: str = Field(description="Who asked the question or made the request.")
    question: str = Field(description="The exact question or request, quoted.")
    note: str = Field(description="What happened instead of a real answer - ignored, talked over, changed subject.")


class UpsellAnalysis(BaseModel):
    customer_requested: list[str]
    upsell_attempts: list[UpsellAttempt]
    excluded_candidates: list[str] = Field(description="Offers considered but NOT counted, each as 'quote -> reason'.")
    pushy_upsell: bool = Field(description="True if the salesperson kept pushing after clear rejection or frustration.")
    pushy_reason: str
    confidence: float = Field(description="0.0 to 1.0 confidence in this analysis.")
    summary: str
    greeting_given: bool = Field(description="True if the salesperson greeted the other person near the start.")
    greeting_quote: str | None = Field(description="The exact greeting, if greeting_given is true; else null.")
    greeting_segment_id: int | None = Field(description="segment_id of the greeting line; else null.")
    products_discussed: list[str] = Field(
        description="The main products or services actually discussed or sold in this conversation "
        "(not just upsell add-ons) - e.g. ['running shoes', 'extended warranty']."
    )
    customer_feedback: str | None = Field(
        description="One sentence summarizing what the customer complained about or pushed back on, in "
        "their own terms, if they expressed any frustration or dissatisfaction; else null."
    )
    customer_feedback_segment_id: int | None = Field(
        description="segment_id where the customer expressed that feedback; else null."
    )
    unanswered_questions: list[UnansweredQuestion] = Field(
        description="Every question or request from the other person that the salesperson never actually "
        "answered - ignored, talked over, or changed the subject. Do not include rhetorical questions or "
        "ones a later reply clearly addresses."
    )
    coaching_feedback: str = Field(
        description="2-3 sentences of specific, actionable feedback for the salesperson on this "
        "conversation: what they did well and the single most useful thing to improve next time. "
        "Reference concrete moments from this conversation, not generic advice."
    )


# ---------------------------------------------------------------- report


class CallLog(BaseModel):
    step: str
    provider: str
    model: str
    ok: bool
    latency_s: float
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None  # None = no pricing entry for this model; not counted toward the budget
    error: str | None = None
    fallback_index: int = 0


class AcousticTurn(BaseModel):
    segment_id: int
    speaker: str
    loudness_db: float | None = None
    pitch_hz: float | None = None
    words_per_sec: float | None = None
    loudness_z: float | None = None
    pitch_z: float | None = None
    rate_z: float | None = None
    interrupted_other: bool = False


class ConversationResult(BaseModel):
    conversation_id: int
    start: float
    end: float
    topic: str
    language: Language
    is_sales_interaction: bool
    salespeople: list[str]
    customers: list[str]
    mood: MoodAnalysis | None = None
    upsell: UpsellAnalysis | None = None
    attempted_upsell: bool = False
    effort_score: float = 0.0
    analyzed_by: str | None = None
    escalated: bool = False
    budget_note: str | None = None  # set if this conversation's own analysis hit its per-conversation cap


class SalespersonMetrics(BaseModel):
    speaker: str
    conversations: int
    conversations_with_upsell: int
    upsell_rate: float
    attempts_total: int
    attempts_per_conversation: float
    avg_effort_score: float
    upsell_talk_time_share: float
    acceptance_rate: float | None
    pushy_conversations: int
    techniques_used: list[str]


class SpeakerSummary(BaseModel):
    speaker: str
    role: Role
    title: str | None = None
    talk_time_s: float


class EvidenceLine(BaseModel):
    segment_id: int
    speaker: str
    role: Role
    start: float
    end: float
    text: str
    is_highlighted: bool = False  # this is the line the finding is about, not just surrounding context


EvidenceKind = Literal["upsell_attempt", "frustration", "unanswered_question", "greeting", "customer_feedback"]


class Evidence(BaseModel):
    """The real transcript lines around one finding (an upsell attempt, a frustration
    moment, an unanswered question, a greeting, or a piece of customer feedback)."""

    kind: EvidenceKind
    conversation_id: int
    index: int  # position of this finding within its kind, in that conversation
    speaker: str
    segment_id: int  # line holding the finding (corrected against the transcript where applicable)
    quote_found: bool  # False if the model's quote could not be located verbatim in the transcript
    lines: list[EvidenceLine]


class JobReport(BaseModel):
    job_id: str
    source_filename: str
    duration_s: float
    transcription_provider: str
    speakers: list[SpeakerSummary]
    has_sales_activity: bool
    conversations: list[ConversationResult]
    salespeople: list[SalespersonMetrics]
    calls: list[CallLog]
    evidence: list[Evidence] = Field(default_factory=list)
    spent_usd: float = 0.0
    budget_usd: float | None = None
    unpriced_calls: int = 0  # calls whose cost could not be estimated (no pricing entry); not in spent_usd


JobState = Literal["queued", "running", "completed", "failed", "cancelled"]


class JobStatus(BaseModel):
    job_id: str
    status: JobState
    stage: str = "queued"
    progress: float = 0.0
    error: str | None = None
    filename: str
    input_key: str
    industry: str | None = None
    product_catalog: str | None = None
    salesperson_name: str | None = None  # optional hint so the dashboard can group this person's recordings
    created_at: str
    updated_at: str
    spent_usd: float = 0.0
    budget_usd: float | None = None
    cancel_requested: bool = False
