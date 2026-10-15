"""Per-salesperson performance across all saved jobs, bucketed by day, week or month.

A diarized label ("A", "B") only means something inside one recording, so the same person in two
recordings is linked by a name: assigned in the dashboard (stored in people/names.json), or given
as a hint at upload time when the recording has exactly one salesperson. Anyone without a name
is listed as unassigned instead of being guessed at.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel

from upsell_poc import jobs
from upsell_poc.analysis.scoring import effort_score
from upsell_poc.outcomes import Sentiment, UpsellResult, call_outcome
from upsell_poc.schemas import ConversationResult
from upsell_poc.storage import Storage

log = logging.getLogger(__name__)

Period = Literal["day", "week", "month"]
Rating = Literal["strong", "solid", "needs_work"]
EffortLevel = Literal["high", "moderate", "low", "none"]
Trend = Literal["improving", "steady", "declining"]
NAMES_KEY = "people/names.json"


class Bucket(BaseModel):
    period: str  # day: 2026-10-14, week: Monday of the ISO week, month: 2026-10
    recordings: int = 0
    conversations: int = 0
    conversations_with_upsell: int = 0
    upsell_rate: float | None = None
    attempts: int = 0
    accepted: int = 0
    acceptance_rate: float | None = None
    avg_effort: float | None = None
    greeted: int = 0
    greeting_rate: float | None = None
    unanswered_questions: int = 0
    pushy_conversations: int = 0
    avg_customer_frustration: float | None = None
    attempts_per_conversation: float | None = None
    re_offers: int = 0  # offers made again after the customer had already said no
    objections_handled: int = 0
    techniques: list[str] = []
    calls_positive: int = 0
    calls_neutral: int = 0
    calls_negative: int = 0
    conversations_won: int = 0  # conversations where the customer accepted at least one upsell


class Assessment(BaseModel):
    rating: Rating
    headline: str
    low_sample: bool
    effort_level: EffortLevel
    effort_summary: str
    trend: Trend | None
    strengths: list[str]
    improvements: list[str]


class RecentCall(BaseModel):
    when: str  # upload time of the recording
    job_id: str
    filename: str
    conversation_id: int
    topic: str
    sentiment: Sentiment
    upsell_result: UpsellResult
    tried: int
    accepted: int


class PersonSummary(BaseModel):
    name: str
    total: Bucket
    series: list[Bucket]
    assessment: Assessment
    recent_coaching: list[str]
    recent_calls: list[RecentCall]


class Unassigned(BaseModel):
    job_id: str
    speaker: str
    filename: str
    created_at: str
    conversations: int


class Dashboard(BaseModel):
    period: Period
    people: list[PersonSummary]
    unassigned: list[Unassigned]
    jobs_counted: int
    jobs_skipped: int = 0  # completed jobs whose saved report couldn't be read


def period_label(when: datetime, period: Period) -> str:
    d = when.date()
    if period == "week":
        return (d - timedelta(days=d.weekday())).isoformat()
    if period == "month":
        return f"{d.year:04d}-{d.month:02d}"
    return d.isoformat()


def load_names(storage: Storage) -> dict[str, str]:
    return storage.get_json(NAMES_KEY) or {}


def set_name(storage: Storage, job_id: str, speaker: str, name: str) -> None:
    names = load_names(storage)
    key = f"{job_id}:{speaker}"
    if name.strip():
        names[key] = name.strip()
    else:
        names.pop(key, None)
    storage.put_json(NAMES_KEY, names)


class _Acc:
    def __init__(self) -> None:
        self.recordings: set[str] = set()
        self.convs = 0
        self.with_upsell = 0
        self.attempts = 0
        self.accepted = 0
        self.decided = 0
        self.efforts: list[float] = []
        self.greeted = 0
        self.greeting_known = 0
        self.unanswered = 0
        self.pushy = 0
        self.frustration: list[float] = []
        self.re_offers = 0
        self.objections = 0
        self.techniques: set[str] = set()
        self.sentiment = {"positive": 0, "neutral": 0, "negative": 0}
        self.won = 0

    def add(self, job_id: str, conv: ConversationResult, person: str) -> None:
        self.recordings.add(job_id)
        self.convs += 1
        u = conv.upsell
        if u:
            mine = [a for a in u.upsell_attempts if a.salesperson == person]
            self.attempts += len(mine)
            self.with_upsell += bool(mine)
            decided = [a for a in mine if a.customer_response in ("accepted", "rejected")]
            self.decided += len(decided)
            self.accepted += sum(a.customer_response == "accepted" for a in decided)
            self.efforts.append(effort_score(u, person))
            self.greeting_known += 1
            self.greeted += bool(u.greeting_given)
            self.unanswered += len(u.unanswered_questions)
            self.pushy += bool(u.pushy_upsell)
            self.re_offers += sum(a.after_customer_rejection for a in mine)
            self.objections += sum(a.handled_objection for a in mine)
            self.techniques |= {a.technique for a in mine}
        outcome = call_outcome(conv)
        self.sentiment[outcome.sentiment] += 1
        self.won += any(p.response == "accepted" and p.salesperson == person for p in outcome.pitched)
        if conv.mood:
            self.frustration += [m.frustration_level for m in conv.mood.speakers if m.speaker in conv.customers]

    def bucket(self, label: str) -> Bucket:
        def ratio(n: int, d: int) -> float | None:
            return round(n / d, 3) if d else None

        def mean(xs: list[float]) -> float | None:
            return round(sum(xs) / len(xs), 1) if xs else None

        return Bucket(
            period=label,
            recordings=len(self.recordings),
            conversations=self.convs,
            conversations_with_upsell=self.with_upsell,
            upsell_rate=ratio(self.with_upsell, self.convs),
            attempts=self.attempts,
            accepted=self.accepted,
            acceptance_rate=ratio(self.accepted, self.decided),
            avg_effort=mean(self.efforts),
            greeted=self.greeted,
            greeting_rate=ratio(self.greeted, self.greeting_known),
            unanswered_questions=self.unanswered,
            pushy_conversations=self.pushy,
            avg_customer_frustration=mean(self.frustration),
            attempts_per_conversation=round(self.attempts / self.convs, 2) if self.convs else None,
            re_offers=self.re_offers,
            objections_handled=self.objections,
            techniques=sorted(self.techniques),
            calls_positive=self.sentiment["positive"],
            calls_neutral=self.sentiment["neutral"],
            calls_negative=self.sentiment["negative"],
            conversations_won=self.won,
        )


MIN_CONVERSATIONS = 3  # below this, say so rather than judge someone on a couple of calls


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{round(v * 100)}%"


def assess(t: Bucket, series: list[Bucket]) -> Assessment:
    """Plain, explainable rules over the totals - no model call. Every line cites the number behind it."""
    n = t.conversations
    strengths: list[str] = []
    improvements: list[str] = []
    points = 0
    pushy_share = t.pushy_conversations / n if n else 0.0
    unanswered_per = t.unanswered_questions / n if n else 0.0

    # greeting
    if t.greeting_rate is not None:
        if t.greeting_rate >= 0.8:
            points += 2
            strengths.append(f"Greets customers consistently ({_pct(t.greeting_rate)} of conversations).")
        elif t.greeting_rate >= 0.5:
            points += 1
            improvements.append(
                f"Greet every customer - only {_pct(t.greeting_rate)} of conversations started with a greeting."
            )
        else:
            improvements.append(f"Start each conversation with a greeting - only {_pct(t.greeting_rate)} had one.")
    # upsell reach
    if t.upsell_rate is not None:
        if t.upsell_rate >= 0.6:
            points += 2
            strengths.append(f"Looks for add-on sales in most conversations ({_pct(t.upsell_rate)}).")
        elif t.upsell_rate >= 0.3:
            points += 1
            improvements.append(f"Try an upsell in more conversations - currently {_pct(t.upsell_rate)}.")
        else:
            improvements.append(
                f"Rarely attempts an upsell ({_pct(t.upsell_rate)} of conversations); suggest a relevant add-on once the customer's own request is handled."
            )
    # conversion
    if t.acceptance_rate is None:
        points += 1
    elif t.acceptance_rate >= 0.4:
        points += 2
        strengths.append(f"Customers accept {_pct(t.acceptance_rate)} of the offers that get an answer.")
    elif t.acceptance_rate >= 0.2:
        points += 1
    elif t.attempts >= 3:
        improvements.append(
            f"Only {_pct(t.acceptance_rate)} of offers are accepted - tie the add-on to what the customer just asked for and pitch it after answering their questions."
        )
    # pushiness
    if pushy_share <= 0.1:
        points += 2
        if t.attempts:
            strengths.append("Accepts a 'no' without pressuring the customer.")
    elif pushy_share <= 0.3:
        points += 1
        improvements.append(f"Pushy in {t.pushy_conversations} of {n} conversations - drop the offer after a clear no.")
    else:
        improvements.append(
            f"Pushy in {t.pushy_conversations} of {n} conversations - stop re-offering once the customer has declined."
        )
    # listening
    if unanswered_per <= 0.1:
        points += 2
        strengths.append("Answers what customers ask.")
    elif unanswered_per <= 0.3:
        points += 1
        improvements.append(
            f"{t.unanswered_questions} customer question(s) went unanswered - answer first, then pitch."
        )
    else:
        improvements.append(
            f"{t.unanswered_questions} customer questions went unanswered across {n} conversations - answer every question before pitching."
        )
    # customer mood
    if t.avg_customer_frustration is not None:
        if t.avg_customer_frustration <= 3:
            points += 2
            strengths.append(f"Customers stay calm (average frustration {t.avg_customer_frustration}/10).")
        elif t.avg_customer_frustration <= 5:
            points += 1
            improvements.append(
                f"Customers get somewhat frustrated (average {t.avg_customer_frustration}/10) - slow down and acknowledge their concerns."
            )
        else:
            improvements.append(
                f"Customers leave frustrated (average {t.avg_customer_frustration}/10) - review the flagged frustration moments with them."
            )
    # technique variety
    if t.attempts >= 3 and len(t.techniques) <= 1:
        improvements.append("Uses a single sales technique - mix in bundles, upgrades or protection plans.")
    elif len(t.techniques) >= 3:
        strengths.append(f"Varies the approach ({len(t.techniques)} different techniques).")
    if t.objections_handled:
        strengths.append(
            f"Answered customer objections while offering ({t.objections_handled} time{'s' if t.objections_handled != 1 else ''})."
        )

    rating: Rating = "strong" if points >= 9 else "solid" if points >= 6 else "needs_work"
    low_sample = n < MIN_CONVERSATIONS
    headline = {
        "strong": "Strong results across the board",
        "solid": "Solid, with a few things to tighten up",
        "needs_work": "Several areas to work on with them",
    }[rating]

    # effort: how actively and persistently they sell
    efforts = t.avg_effort
    level: EffortLevel
    if t.attempts == 0 or efforts is None:
        level, summary = (
            "none",
            f"No upsell attempts in {n} conversation{'s' if n != 1 else ''} - little selling effort beyond what customers asked for.",
        )
    else:
        level = "high" if efforts >= 4.5 else "moderate" if efforts >= 2.5 else "low"
        bits = [
            f"effort score {efforts}/10",
            f"{t.attempts_per_conversation} offers per conversation",
            f"{len(t.techniques)} technique{'s' if len(t.techniques) != 1 else ''}",
        ]
        if t.re_offers:
            bits.append(f"kept trying after a 'no' {t.re_offers} time{'s' if t.re_offers != 1 else ''}")
        if t.objections_handled:
            bits.append(f"handled {t.objections_handled} objection{'s' if t.objections_handled != 1 else ''}")
        label = {
            "high": "Working hard at selling",
            "moderate": "Putting in a moderate effort",
            "low": "Low effort so far",
        }[level]
        summary = f"{label}: " + ", ".join(bits) + "."
    trend: Trend | None = None
    scored = [b.avg_effort for b in series if b.avg_effort is not None]
    if len(scored) >= 2:
        half = (
            len(scored) // 2
        )  # first half of the periods against the last half, so one odd day or week doesn't flip it
        delta = sum(scored[-half:]) / half - sum(scored[:half]) / half
        trend = "improving" if delta >= 0.5 else "declining" if delta <= -0.5 else "steady"
    if low_sample:
        improvements.append(f"Only {n} conversation{'s' if n != 1 else ''} so far - treat this as a first impression.")
    return Assessment(
        rating=rating,
        headline=headline,
        low_sample=low_sample,
        effort_level=level,
        effort_summary=summary,
        trend=trend,
        strengths=strengths,
        improvements=improvements,
    )


def build_dashboard(storage: Storage, period: Period = "day") -> Dashboard:
    names = load_names(storage)
    per_person: dict[str, dict[str, _Acc]] = defaultdict(lambda: defaultdict(_Acc))
    totals: dict[str, _Acc] = defaultdict(_Acc)
    coaching: dict[str, list[tuple[str, str]]] = defaultdict(list)
    calls: dict[str, list[RecentCall]] = defaultdict(list)
    unassigned: dict[tuple[str, str], Unassigned] = {}
    counted = 0
    skipped = 0

    for status in jobs.list_statuses(storage, limit=10_000):
        if status.status != "completed":
            continue
        raw = storage.get_json(jobs.report_key(status.job_id))
        if not raw:
            continue
        report = jobs.parse_report(raw)
        if report is None:
            log.warning("dashboard: skipping unreadable report for job %s", status.job_id)
            skipped += 1
            continue
        counted += 1
        when = datetime.fromisoformat(status.created_at)
        label = period_label(when, period)
        sales_people = sorted({sp for c in report.conversations if c.is_sales_interaction for sp in c.salespeople})
        for c in report.conversations:
            if not c.is_sales_interaction:
                continue
            for sp in c.salespeople:
                name = names.get(f"{status.job_id}:{sp}")
                if not name and status.salesperson_name and len(sales_people) == 1:
                    name = status.salesperson_name
                if not name:
                    key = (status.job_id, sp)
                    entry = unassigned.setdefault(
                        key,
                        Unassigned(
                            job_id=status.job_id,
                            speaker=sp,
                            filename=status.filename,
                            created_at=status.created_at,
                            conversations=0,
                        ),
                    )
                    entry.conversations += 1
                    continue
                per_person[name][label].add(status.job_id, c, sp)
                totals[name].add(status.job_id, c, sp)
                o = call_outcome(c)
                mine = [p for p in o.pitched if p.salesperson == sp]
                calls[name].append(
                    RecentCall(
                        when=status.created_at,
                        job_id=status.job_id,
                        filename=status.filename,
                        conversation_id=c.conversation_id,
                        topic=c.topic,
                        sentiment=o.sentiment,
                        upsell_result="won" if any(p.response == "accepted" for p in mine) else o.upsell_result,
                        tried=len(mine),
                        accepted=sum(p.response == "accepted" for p in mine),
                    )
                )
                if c.upsell and c.upsell.coaching_feedback:
                    coaching[name].append((status.created_at, c.upsell.coaching_feedback))

    people = []
    for name, buckets in per_person.items():
        series = [buckets[lbl].bucket(lbl) for lbl in sorted(buckets)]
        total = totals[name].bucket("all")
        people.append(
            PersonSummary(
                name=name,
                total=total,
                series=series,
                assessment=assess(total, series),
                recent_coaching=[t for _, t in sorted(coaching[name], reverse=True)[:3]],
                recent_calls=sorted(calls[name], key=lambda x: (x.when, x.conversation_id), reverse=True)[:8],
            )
        )
    people.sort(key=lambda p: (-p.total.conversations, p.name.lower()))
    return Dashboard(
        period=period,
        people=people,
        unassigned=sorted(unassigned.values(), key=lambda u: u.created_at, reverse=True),
        jobs_counted=counted,
        jobs_skipped=skipped,
    )
