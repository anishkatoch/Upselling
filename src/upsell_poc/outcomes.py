"""How each sales conversation went: what was pitched, whether it landed, and the overall feel of the call.

Everything here is derived from findings the pipeline already produced (upsell attempts and the
customer's reaction to each, mood levels, unanswered questions), so it needs no extra model call and works on
jobs analyzed earlier. It is an estimate of how the call felt, not a record of what was bought.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from upsell_poc.schemas import ConversationResult, CustomerResponse, JobReport

Sentiment = Literal["positive", "neutral", "negative"]
UpsellResult = Literal["won", "lost", "open", "none", "unknown"]

# The same cut-offs as the screens: under 3 calm, 3-4 some tension, 5 and over frustrated.
HIGH_FRUSTRATION = 5
SOME_FRUSTRATION = 3


class PitchedItem(BaseModel):
    salesperson: str
    segment_id: int
    item: str
    technique: str
    response: CustomerResponse
    quote: str
    after_rejection: bool


class CallOutcome(BaseModel):
    conversation_id: int
    topic: str
    start: float
    end: float
    salespeople: list[str]
    sentiment: Sentiment
    sentiment_reasons: list[str]
    upsell_result: UpsellResult
    pitched: list[PitchedItem]
    accepted: int
    rejected: int
    open: int  # undecided or never answered
    products_discussed: list[str]
    customer_max_frustration: int | None


class ItemStat(BaseModel):
    item: str
    tried: int
    accepted: int


class SalespersonOutcome(BaseModel):
    speaker: str
    tried: int
    accepted: int
    rejected: int
    open: int
    success_rate: float | None  # accepted / (accepted + rejected); None when nothing was decided
    items: list[ItemStat]


class JobOutcomes(BaseModel):
    job_id: str
    calls: list[CallOutcome]
    positive: int
    neutral: int
    negative: int
    won: int
    lost: int
    by_salesperson: list[SalespersonOutcome]


def _sentiment(conv: ConversationResult, accepted: int, max_frustration: int | None) -> tuple[Sentiment, list[str]]:
    """Score the call from the customer's side: how upset they got, whether they said yes to
    anything, and whether the salesperson pushed or left questions hanging."""
    score = 0
    reasons: list[str] = []
    if max_frustration is None:
        reasons.append("No mood reading for the customer")
    elif max_frustration >= HIGH_FRUSTRATION:
        score -= 3
        reasons.append(f"Customer got frustrated ({max_frustration}/10)")
    elif max_frustration >= SOME_FRUSTRATION:
        score -= 1
        reasons.append(f"Customer showed some frustration ({max_frustration}/10)")
    else:
        score += 1
        reasons.append("Customer stayed calm")
    u = conv.upsell
    if accepted:
        score += 1
        reasons.append(f"Customer accepted {accepted} offer{'s' if accepted != 1 else ''}")
    if u and u.pushy_upsell:
        score -= 1
        reasons.append("Salesperson kept pushing after a clear no")
    if u and len(u.unanswered_questions) >= 2:
        score -= 1
        reasons.append(f"{len(u.unanswered_questions)} customer questions went unanswered")
    sentiment: Sentiment = "positive" if score >= 2 else "negative" if score <= -2 else "neutral"
    return sentiment, reasons


def call_outcome(conv: ConversationResult) -> CallOutcome:
    u = conv.upsell
    attempts = u.upsell_attempts if u else []
    pitched = [
        PitchedItem(
            salesperson=a.salesperson,
            segment_id=a.segment_id,
            item=a.offered_item,
            technique=a.technique,
            response=a.customer_response,
            quote=a.quote,
            after_rejection=a.after_customer_rejection,
        )
        for a in attempts
    ]
    accepted = sum(p.response == "accepted" for p in pitched)
    rejected = sum(p.response == "rejected" for p in pitched)
    open_ = len(pitched) - accepted - rejected
    frustrations = [
        m.frustration_level for m in (conv.mood.speakers if conv.mood else []) if m.speaker in conv.customers
    ]
    max_frustration = max(frustrations) if frustrations else None
    result: UpsellResult
    if u is None:
        result = "unknown"  # analysis stopped before upsell detection
    elif not pitched:
        result = "none"
    elif accepted:
        result = "won"
    elif open_:
        result = "open"
    else:
        result = "lost"
    sentiment, reasons = _sentiment(conv, accepted, max_frustration)
    return CallOutcome(
        conversation_id=conv.conversation_id,
        topic=conv.topic,
        start=conv.start,
        end=conv.end,
        salespeople=conv.salespeople,
        sentiment=sentiment,
        sentiment_reasons=reasons,
        upsell_result=result,
        pitched=pitched,
        accepted=accepted,
        rejected=rejected,
        open=open_,
        products_discussed=u.products_discussed if u else [],
        customer_max_frustration=max_frustration,
    )


def job_outcomes(report: JobReport) -> JobOutcomes:
    calls = [call_outcome(c) for c in report.conversations if c.is_sales_interaction]
    per: dict[str, list[PitchedItem]] = {}
    for call in calls:
        for p in call.pitched:
            per.setdefault(p.salesperson, []).append(p)
    people: list[SalespersonOutcome] = []
    for sp, items in sorted(per.items()):
        accepted = sum(p.response == "accepted" for p in items)
        rejected = sum(p.response == "rejected" for p in items)
        by_item: dict[str, ItemStat] = {}
        for p in items:
            key = p.item.strip().lower() or "(unnamed)"
            stat = by_item.setdefault(key, ItemStat(item=p.item.strip() or "(unnamed)", tried=0, accepted=0))
            stat.tried += 1
            stat.accepted += p.response == "accepted"
        people.append(
            SalespersonOutcome(
                speaker=sp,
                tried=len(items),
                accepted=accepted,
                rejected=rejected,
                open=len(items) - accepted - rejected,
                success_rate=round(accepted / (accepted + rejected), 3) if accepted + rejected else None,
                items=sorted(by_item.values(), key=lambda s: (-s.tried, s.item)),
            )
        )
    return JobOutcomes(
        job_id=report.job_id,
        calls=calls,
        positive=sum(c.sentiment == "positive" for c in calls),
        neutral=sum(c.sentiment == "neutral" for c in calls),
        negative=sum(c.sentiment == "negative" for c in calls),
        won=sum(c.upsell_result == "won" for c in calls),
        lost=sum(c.upsell_result == "lost" for c in calls),
        by_salesperson=people,
    )
