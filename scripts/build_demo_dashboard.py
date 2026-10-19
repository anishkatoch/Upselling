"""Build the made-up team data behind the dashboard's "View demo" button.

Generates ten weeks of recordings for six invented salespeople with different trajectories
(improving, slipping, steady, pushy, low effort, new joiner), saves them into a throwaway
storage folder, and runs the real dashboard code over them - so the demo is computed exactly
like live numbers. Nothing here touches your real data or any model API.

Writes frontend/src/data/demo-dashboard.json, which the React app imports directly. Uses the
sample conversation from build_dummy_report.py as its template, so run that one first if both
need regenerating.

    uv run python scripts/build_demo_dashboard.py
"""

from __future__ import annotations

import copy
import json
import random
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from upsell_poc import dashboard, jobs
from upsell_poc.analysis.scoring import effort_score, salesperson_metrics
from upsell_poc.schemas import ConversationResult, JobReport, UpsellAnalysis
from upsell_poc.storage import LocalStorage

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "src" / "data"
sys.path.insert(0, str(Path(__file__).parent))

FIRST_MONDAY = date(2026, 8, 10)
WEEKS = 10

TOPICS = ["Running shoes purchase", "Phone bill payment", "Laptop enquiry", "Mobile plan renewal", "Insurance renewal",
          "Television purchase", "Wireless headphones", "Credit card offer"]  # fmt: skip
ITEMS = {"bundle": ["socks", "carry case", "screen guard"], "cross_sell": ["waterproof spray", "charger", "earphones"],
         "upgrade": ["256GB model", "premium plan", "pro version"], "warranty_protection": ["extended warranty", "protection plan"],
         "plan_upgrade": ["premium data plan", "annual plan"], "social_proof": ["premium data plan", "extended warranty"]}  # fmt: skip
GOOD_COACHING = [
    "Strong opening and a relevant add-on after answering the customer's question. Keep doing that - and try offering a second, different option when the first is declined politely.",
    "Good warm greeting and well-timed bundle offer. Next time, mention the saving up front: customers responded best when the benefit was concrete.",
]
PUSHY_COACHING = [
    "You re-offered the same item right after a clear 'no', and the customer's frustration rose. Accept the first refusal, answer their question, then move on.",
    "Two offers in a row while the customer was getting impatient. Pause after a 'no' and only come back to it if they raise it.",
]
FLAT_COACHING = [
    "You handled the customer's request well but didn't suggest anything extra. After the main sale, offer one relevant add-on - a case, a warranty, a plan upgrade.",
    "No greeting and no add-on offered. Open with a greeting and, once their need is clear, suggest one related item.",
]
UNANSWERED_COACHING = [
    "The customer's question about delivery time went unanswered before you pitched. Answer first, then offer the add-on.",
]


@dataclass
class Profile:
    name: str
    first_week: int
    upsell_p: tuple[float, float]  # chance a conversation includes an upsell: start -> end of the ten weeks
    accept_p: tuple[float, float]
    greet_p: tuple[float, float]
    pushy_p: tuple[float, float]
    unanswered_p: tuple[float, float]
    frustration: tuple[float, float]
    max_attempts: int
    techniques: list[str]
    days_per_week: int = 3
    convs_per_day: int = 3


PROFILES = [
    Profile(
        "Priya Sharma",
        0,
        (0.35, 0.85),
        (0.15, 0.5),
        (0.5, 0.97),
        (0.3, 0.03),
        (0.4, 0.05),
        (4.5, 1.5),
        3,
        ["bundle", "cross_sell", "upgrade", "warranty_protection"],
    ),
    Profile(
        "Rahul Verma",
        0,
        (0.9, 0.2),
        (0.5, 0.2),
        (0.95, 0.7),
        (0.05, 0.4),
        (0.05, 0.35),
        (2.0, 5.5),
        2,
        ["bundle", "cross_sell"],
    ),
    Profile(
        "Ankit Mehta",
        0,
        (0.8, 0.85),
        (0.5, 0.55),
        (0.92, 0.95),
        (0.05, 0.04),
        (0.06, 0.05),
        (2.0, 1.8),
        3,
        ["bundle", "upgrade", "warranty_protection", "plan_upgrade", "cross_sell"],
    ),
    Profile(
        "Neha Kapoor",
        0,
        (0.9, 0.9),
        (0.2, 0.2),
        (0.7, 0.65),
        (0.55, 0.6),
        (0.3, 0.3),
        (5.5, 6.2),
        4,
        ["social_proof", "bundle", "upgrade"],
    ),
    Profile(
        "Vikram Singh",
        0,
        (0.12, 0.08),
        (0.3, 0.3),
        (0.35, 0.3),
        (0.02, 0.02),
        (0.3, 0.35),
        (3.0, 3.2),
        1,
        ["cross_sell"],
    ),
    Profile(
        "Sneha Iyer",
        8,
        (0.5, 0.6),
        (0.4, 0.45),
        (0.8, 0.85),
        (0.1, 0.1),
        (0.15, 0.1),
        (2.5, 2.2),
        2,
        ["bundle", "upgrade"],
        2,
        2,
    ),
]


def lerp(pair: tuple[float, float], t: float) -> float:
    return pair[0] + (pair[1] - pair[0]) * t


def make_conversation(template: dict, p: Profile, t: float, rng: random.Random, cid: int) -> dict:
    conv = copy.deepcopy(template)
    conv.update(conversation_id=cid, topic=rng.choice(TOPICS), start=(cid - 1) * 100.0, end=(cid - 1) * 100.0 + 80.0,
                salespeople=["A"], customers=["B"], analyzed_by="openai", escalated=False, budget_note=None)  # fmt: skip
    up = conv["upsell"]
    tmpl_attempt = up["upsell_attempts"][0]
    attempts = []
    if rng.random() < lerp(p.upsell_p, t):
        rejected_before = False
        for _ in range(rng.randint(1, p.max_attempts)):
            technique = rng.choice(p.techniques)
            item = rng.choice(ITEMS[technique])
            accepted = rng.random() < lerp(p.accept_p, t) * (0.5 if rejected_before else 1.0)
            attempts.append({**tmpl_attempt, "technique": technique, "offered_item": item,
                             "quote": f"Sir, {item} bhi dekh lijiye, abhi ke saath sasta padega.",
                             "after_customer_rejection": rejected_before, "handled_objection": rng.random() < 0.3,
                             "customer_response": "accepted" if accepted else rng.choice(["rejected"] * 4 + ["undecided"]),
                             "customer_mood": "calm" if accepted else rng.choice(["neutral", "impatient"])})  # fmt: skip
            if accepted:
                break
            rejected_before = True
    pushy = len(attempts) >= 2 and rng.random() < lerp(p.pushy_p, t) * 1.6
    greeted = rng.random() < lerp(p.greet_p, t)
    unanswered = 1 + (rng.random() < 0.3) if rng.random() < lerp(p.unanswered_p, t) else 0
    frustration = max(0, min(10, round(rng.gauss(lerp(p.frustration, t) + (2 if pushy else 0), 1.1))))
    unanswered_template = up["unanswered_questions"][0]
    up.update(upsell_attempts=attempts, pushy_upsell=pushy, pushy_reason="Re-offered after a clear no." if pushy else "",
              greeting_given=greeted, greeting_quote="Namaste, kaise help kar sakta hoon?" if greeted else None,
              greeting_segment_id=0 if greeted else None, unanswered_questions=[copy.deepcopy(unanswered_template) for _ in range(unanswered)],
              customer_feedback=None if frustration < 3 else "Customer felt pushed to buy more than they wanted.",
              customer_feedback_segment_id=None, summary=f"{len(attempts)} upsell attempt(s) in a {conv['topic'].lower()} conversation.",
              coaching_feedback=rng.choice(PUSHY_COACHING if pushy else UNANSWERED_COACHING if unanswered else FLAT_COACHING if not attempts else GOOD_COACHING))  # fmt: skip
    conv["mood"]["speakers"] = [
        {"speaker": "A", "overall_mood": "calm", "frustration_level": 0, "trend": "stable", "summary": "Polite."},
        {"speaker": "B", "overall_mood": "irritated" if frustration >= 5 else "calm", "frustration_level": frustration,
         "trend": "worsening" if frustration >= 5 else "stable", "summary": "Customer mood over the conversation."},
    ]  # fmt: skip
    conv["mood"]["frustration_moments"] = (
        [] if frustration < 3 else [{**conv["mood"]["frustration_moments"][0], "speaker": "B"}]
    )
    conv["attempted_upsell"] = bool(attempts)
    conv["effort_score"] = effort_score(UpsellAnalysis.model_validate(up), "A") if attempts else 0.0
    return conv


def build() -> dict:
    from build_dummy_report import report as template_report

    template = template_report["conversations"][0]
    rng = random.Random(7)
    with tempfile.TemporaryDirectory() as tmp:
        storage = LocalStorage(Path(tmp) / "store")
        audio = Path(tmp) / "a.wav"
        audio.write_bytes(b"x")
        for p in PROFILES:
            for week in range(p.first_week, WEEKS):
                t = week / (WEEKS - 1)
                days = [0, 1, 2] if week == WEEKS - 1 else [0, 1, 2, 3, 4]  # the last week stops on Wednesday 14 Oct
                for day in rng.sample(days, min(p.days_per_week, len(days))):
                    when = FIRST_MONDAY + timedelta(weeks=week, days=day)
                    convs = [make_conversation(template, p, t, rng, i + 1) for i in range(p.convs_per_day)]
                    status = jobs.create_job(storage, audio, f"{p.name.split()[0].lower()}_{when:%b%d}.wav")
                    jobs.update_status(storage, status.job_id, status="completed", stage="done", progress=1.0,
                                       created_at=f"{when.isoformat()}T{rng.randint(9, 17):02d}:15:00+00:00")  # fmt: skip
                    results = [ConversationResult.model_validate(c) for c in convs]
                    report = {**template_report, "job_id": status.job_id, "source_filename": status.filename, "evidence": [],
                              "conversations": [c.model_dump(mode="json") for c in results],
                              "salespeople": [m.model_dump(mode="json") for m in salesperson_metrics(results, [])],
                              "speakers": [s for s in template_report["speakers"] if s["speaker"] in ("A", "B")]}  # fmt: skip
                    JobReport.model_validate(report)
                    storage.put_json(jobs.report_key(status.job_id), report)
                    dashboard.set_name(storage, status.job_id, "A", p.name)
        return {
            period: dashboard.build_dashboard(storage, period).model_dump(mode="json")
            for period in ("day", "week", "month")
        }


def main() -> None:
    demo = build()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / "demo-dashboard.json"
    out.write_text(json.dumps(demo, ensure_ascii=False, indent=2), encoding="utf-8")
    people = demo["week"]["people"]
    print(f"wrote demo dashboard into {out}")
    print(f"wrote demo dashboard: {len(people)} people, {demo['week']['jobs_counted']} recordings")
    for person in people:
        a = person["assessment"]
        print(
            f"  {person['name']:14} {a['rating']:10} effort={a['effort_level']:9} trend={a['trend']}  convs={person['total']['conversations']}"
        )


if __name__ == "__main__":
    main()
