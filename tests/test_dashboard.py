import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from upsell_poc import dashboard, jobs
from upsell_poc.storage import LocalStorage

DATA_DIR = Path(__file__).parents[1] / "frontend/src/data"


def _sample_report() -> dict:
    return json.loads((DATA_DIR / "dummy-report.json").read_text(encoding="utf-8"))


def _add_job(storage, tmp_path, created: str, name: str | None = None) -> str:
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    st = jobs.create_job(storage, audio, "visit.wav", salesperson_name=name)
    jobs.update_status(storage, st.job_id, status="completed", created_at=created)
    report = _sample_report()
    report["job_id"] = st.job_id
    storage.put_json(jobs.report_key(st.job_id), report)
    return st.job_id


def test_period_labels():
    d = datetime(2026, 10, 14, 9, tzinfo=UTC)  # a Wednesday
    assert dashboard.period_label(d, "day") == "2026-10-14"
    assert dashboard.period_label(d, "week") == "2026-10-12"  # that week's Monday
    assert dashboard.period_label(d, "month") == "2026-10"


def test_unnamed_speakers_are_listed_not_guessed(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00")
    result = dashboard.build_dashboard(storage, "day")
    assert result.people == []
    assert result.unassigned and result.unassigned[0].speaker == "A"


def test_naming_groups_recordings_across_days_and_weeks(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    first = _add_job(storage, tmp_path, "2026-10-12T10:00:00+00:00")
    second = _add_job(storage, tmp_path, "2026-10-21T10:00:00+00:00")
    for job_id in (first, second):
        dashboard.set_name(storage, job_id, "A", "Rahul")

    daily = dashboard.build_dashboard(storage, "day")
    assert [p.name for p in daily.people] == ["Rahul"] and not daily.unassigned
    person = daily.people[0]
    assert [b.period for b in person.series] == ["2026-10-12", "2026-10-21"]
    # total is the most recent day, not summed across both - that's what makes "Daily" differ
    # from "Weekly"/"Monthly" instead of showing the same all-time numbers under every tab.
    assert person.total is person.series[-1]
    assert person.total.recordings == 1
    assert person.total.conversations == person.series[-1].conversations
    assert person.total.attempts == person.series[-1].attempts > 0

    assert [b.period for b in dashboard.build_dashboard(storage, "week").people[0].series] == [
        "2026-10-12",
        "2026-10-19",
    ]
    assert len(dashboard.build_dashboard(storage, "month").people[0].series) == 1


def test_upload_name_hint_and_clearing(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    job_id = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00", name="Priya")
    # the sample has a single salesperson, so the hint applies
    assert [p.name for p in dashboard.build_dashboard(storage, "week").people] == ["Priya"]
    dashboard.set_name(storage, job_id, "A", "Priya S")  # an explicit assignment wins
    assert [p.name for p in dashboard.build_dashboard(storage, "week").people] == ["Priya S"]
    dashboard.set_name(storage, job_id, "A", "")  # clearing falls back to the upload hint
    assert [p.name for p in dashboard.build_dashboard(storage, "week").people] == ["Priya"]


@pytest.mark.parametrize("period", ["day", "week", "month"])
def test_ignores_jobs_that_are_not_completed(tmp_path, period):
    storage = LocalStorage(tmp_path / "s")
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    jobs.create_job(storage, audio, "queued.wav")
    assert dashboard.build_dashboard(storage, period).jobs_counted == 0


def test_build_person_recordings_lists_every_job_newest_first(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    older = _add_job(storage, tmp_path, "2026-10-12T10:00:00+00:00")
    newer = _add_job(storage, tmp_path, "2026-10-21T10:00:00+00:00")
    for job_id in (older, newer):
        dashboard.set_name(storage, job_id, "A", "Rahul")
    other = _add_job(storage, tmp_path, "2026-10-15T10:00:00+00:00")
    dashboard.set_name(storage, other, "A", "Someone Else")

    recordings = dashboard.build_person_recordings(storage, "Rahul")
    assert [r.job_id for r in recordings] == [newer, older]  # newest first

    by_job = {r.job_id: r for r in recordings}
    assert by_job[older].filename == "visit.wav"
    assert by_job[older].created_at == "2026-10-12T10:00:00+00:00"
    assert by_job[newer].created_at == "2026-10-21T10:00:00+00:00"

    # same per-job numbers `build_dashboard` would compute for that one job's day bucket
    daily = dashboard.build_dashboard(storage, "day")
    rahul_today = next(p for p in daily.people if p.name == "Rahul")
    assert by_job[newer].stats.conversations == rahul_today.total.conversations
    assert by_job[newer].stats.attempts == rahul_today.total.attempts > 0

    assert dashboard.build_person_recordings(storage, "Nobody") == []


def test_build_dashboard_unchanged_by_resolve_name_refactor(tmp_path):
    # `_resolve_name` factors out the name-resolution rule build_dashboard already used;
    # this just re-confirms both call paths (explicit assignment and the upload-time hint)
    # still behave identically after the refactor.
    storage = LocalStorage(tmp_path / "s")
    job_id = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00", name="Priya")
    assert [p.name for p in dashboard.build_dashboard(storage, "week").people] == ["Priya"]
    dashboard.set_name(storage, job_id, "A", "Priya S")
    assert [p.name for p in dashboard.build_dashboard(storage, "week").people] == ["Priya S"]


def test_demo_dashboard_is_valid_and_varied():
    demo = json.loads((DATA_DIR / "demo-dashboard.json").read_text(encoding="utf-8"))
    for period in ("day", "week", "month"):
        parsed = dashboard.Dashboard.model_validate(demo[period])
        assert len(parsed.people) >= 5 and not parsed.unassigned
    people = {p.name: p for p in dashboard.Dashboard.model_validate(demo["week"]).people}
    assert len({p.assessment.rating for p in people.values()}) >= 2  # not everyone looks the same
    assert all(p.recent_calls for p in people.values())


# ---------------------------------------------------------------- identity, periods, missing data

NOW = datetime(2026, 10, 21, 12, tzinfo=UTC)  # a Wednesday; its week starts 2026-10-19


def _sales_convs(report: dict) -> list[dict]:
    return [c for c in report["conversations"] if c["is_sales_interaction"]]


def _add_custom_job(storage, tmp_path, created: str, report: dict, name: str | None = None) -> str:
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    st = jobs.create_job(storage, audio, "visit.wav", salesperson_name=name)
    jobs.update_status(storage, st.job_id, status="completed", created_at=created)
    report = {**report, "job_id": st.job_id}
    storage.put_json(jobs.report_key(st.job_id), report)
    return st.job_id


def test_names_differing_in_case_or_whitespace_are_one_person(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    ids = [_add_job(storage, tmp_path, f"2026-10-1{i}T10:00:00+00:00") for i in (4, 5, 6, 7)]
    for job_id, typed in zip(ids, ["Rahul", "rahul", "Rahul ", "  RAHUL   "], strict=True):
        dashboard.set_name(storage, job_id, "A", typed)
    people = dashboard.build_dashboard(storage, "month", NOW).people
    assert [p.name for p in people] == ["Rahul"]  # first spelling wins
    assert people[0].total.recordings == 4
    assert [r.job_id for r in dashboard.build_person_recordings(storage, "rahul")] == ids[::-1]


def test_old_mixed_case_data_is_merged_without_migration(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    a = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00")
    _add_job(storage, tmp_path, "2026-10-15T10:00:00+00:00", name="priya  s")
    c = _add_job(storage, tmp_path, "2026-10-16T10:00:00+00:00")
    storage.put_json(dashboard.NAMES_KEY, {f"{a}:A": "Priya S", f"{c}:A": "PRIYA S "})
    people = dashboard.build_dashboard(storage, "month", NOW).people
    assert [p.name for p in people] == ["Priya S"]
    assert people[0].total.recordings == 3


def test_upload_hint_resolves_to_existing_spelling_and_empty_name_clears(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    job_id = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00")
    dashboard.set_name(storage, job_id, "A", "Rahul")
    assert dashboard.register_name(storage, "  rahul ") == "Rahul"
    assert dashboard.register_name(storage, "   ") is None
    dashboard.set_name(storage, job_id, "A", "  ")
    assert dashboard.build_dashboard(storage, "month", NOW).people == []


def test_merge_people_follows_chains_and_rejects_bad_input(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    ids = [_add_job(storage, tmp_path, f"2026-10-1{i}T10:00:00+00:00") for i in (4, 5, 6)]
    for job_id, typed in zip(ids, ["Rahul", "Rahul K", "Rahul Kumar"], strict=True):
        dashboard.set_name(storage, job_id, "A", typed)
    assert [r.name for r in dashboard.build_roster(storage)] == ["Rahul", "Rahul K", "Rahul Kumar"]

    dashboard.merge_people(storage, "Rahul K", "Rahul Kumar")
    dashboard.merge_people(storage, "rahul kumar", "Rahul")  # chain: K -> Kumar -> Rahul
    dashboard.merge_people(storage, "Rahul", "RAHUL")  # self-merge is a no-op
    people = dashboard.build_dashboard(storage, "month", NOW).people
    assert [p.name for p in people] == ["Rahul"] and people[0].total.recordings == 3
    assert [(r.name, r.recordings) for r in dashboard.build_roster(storage)] == [("Rahul", 3)]
    assert len(dashboard.build_person_recordings(storage, "Rahul K")) == 3  # an alias finds the same person
    dashboard.set_name(storage, ids[0], "A", "rahul k")  # typing a merged-away name lands on the survivor
    assert [p.name for p in dashboard.build_dashboard(storage, "month", NOW).people] == ["Rahul"]

    with pytest.raises(KeyError):
        dashboard.merge_people(storage, "Nobody", "Rahul")
    with pytest.raises(ValueError):
        dashboard.merge_people(storage, "", "Rahul")


def test_roster_counts_distinct_recordings_and_includes_hint_only_names(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    a = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00")
    dashboard.set_name(storage, a, "A", "zoe")
    _add_job(storage, tmp_path, "2026-10-15T10:00:00+00:00", name="Amit")
    audio = tmp_path / "q.wav"
    audio.write_bytes(b"x")
    jobs.create_job(storage, audio, "queued.wav", salesperson_name="Bela")  # not completed yet
    assert [(r.name, r.recordings) for r in dashboard.build_roster(storage)] == [
        ("Amit", 1),
        ("Bela", 0),
        ("zoe", 1),
    ]


def test_roster_and_merge_endpoints(settings, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from upsell_poc.api import main

    # `main.settings` is bound at import time, so without this the test would write into the real default store.
    monkeypatch.setattr(main, "settings", settings)
    storage = main.get_storage(main.settings)
    ids = []
    for typed in ("Rahul", "Rahul K"):
        ids.append(_add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00"))
        dashboard.set_name(storage, ids[-1], "A", typed)
    client = TestClient(main.app)
    assert client.get("/api/people/roster").json() == [
        {"name": "Rahul", "recordings": 1},
        {"name": "Rahul K", "recordings": 1},
    ]
    assert client.post("/api/people/merge", json={"from_name": "Nobody", "into_name": "Rahul"}).status_code == 404
    assert client.post("/api/people/merge", json={"from_name": "", "into_name": "Rahul"}).status_code == 422
    assert client.post("/api/people/merge", json={"from_name": "rahul k", "into_name": "Rahul"}).status_code == 204
    assert client.get("/api/people/roster").json() == [{"name": "Rahul", "recordings": 2}]
    assert client.post("/api/people/name", json={"job_id": ids[0], "speaker": "A", "name": ""}).status_code == 204


def test_unassigned_items_carry_title_talk_time_and_sample_lines(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    job_id = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00")
    segs = [{"id": i, "speaker": "A", "start": 5.0 + i, "end": 6.0 + i, "text": f" line {i} "} for i in range(5)]
    storage.put_json(jobs.transcript_key(job_id), {"transcript": {"segments": segs}})
    result = dashboard.build_dashboard(storage, "day", NOW)
    item = result.unassigned[0]
    assert item.title == "Senior Sales Associate" and item.talk_time_s == 54.5
    assert item.first_start_s == 5.0
    assert [(s.start, s.text) for s in item.sample_lines] == [(5.0, "line 0"), (6.0, "line 1"), (7.0, "line 2")]
    assert result.unassigned_conversations == item.conversations > 0

    storage.put_json(jobs.transcript_key(job_id), {"segments": "garbage"})  # unreadable: must not break the dashboard
    broken = dashboard.build_dashboard(storage, "day", NOW).unassigned[0]
    assert broken.sample_lines == [] and broken.first_start_s is None


def test_stale_latest_period_is_flagged_not_current(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    old = _add_job(storage, tmp_path, "2026-09-01T10:00:00+00:00")
    dashboard.set_name(storage, old, "A", "Asha")
    stale = dashboard.build_dashboard(storage, "week", NOW)
    assert stale.current_period == "2026-10-19"
    assert stale.people[0].total.period == "2026-08-31" and stale.people[0].is_current is False

    recent = _add_job(storage, tmp_path, "2026-10-20T10:00:00+00:00")
    dashboard.set_name(storage, recent, "A", "Asha")
    fresh = dashboard.build_dashboard(storage, "week", NOW)
    assert fresh.people[0].total.period == "2026-10-19" and fresh.people[0].is_current is True
    assert dashboard.build_dashboard(storage, "month", NOW).current_period == "2026-10"


def test_shared_conversation_findings_are_not_charged_to_anyone(tmp_path):
    report = _sample_report()
    conv = _sales_convs(report)[0]
    first = conv["salespeople"][0]
    conv["salespeople"] = [first, "Z"]
    conv["upsell"].update(
        pushy_upsell=True,
        greeting_given=True,
        unanswered_questions=[{"segment_id": 1, "speaker": "x", "question": "q?", "note": "ignored"}],
    )
    other = _sales_convs(report)[1]["upsell"]  # the one solo conversation: nothing wrong in it
    other.update(pushy_upsell=False, unanswered_questions=[])
    storage = LocalStorage(tmp_path / "s")
    job_id = _add_custom_job(storage, tmp_path, "2026-10-14T10:00:00+00:00", report)
    dashboard.set_name(storage, job_id, first, "Asha")
    dashboard.set_name(storage, job_id, "Z", "Ravi")
    by = {p.name: p.total for p in dashboard.build_dashboard(storage, "month", NOW).people}
    ravi, asha = by["Ravi"], by["Asha"]
    assert (ravi.pushy_conversations, ravi.unanswered_questions, ravi.greeted) == (0, 0, 0)
    assert ravi.shared_conversations == 1 and ravi.solo_analysed_conversations == 0
    assert ravi.greeting_rate is None  # nothing left to judge a greeting on
    assert asha.pushy_conversations == 0 and asha.unanswered_questions == 0
    assert asha.shared_conversations == 1
    assert asha.solo_analysed_conversations == asha.analysed_conversations - 1
    # per-attempt numbers still belong to whoever made the attempts
    assert asha.attempts > 0 and ravi.attempts == 0


def test_unanalysed_conversations_do_not_dilute_rates_or_earn_points(tmp_path):
    totals = {}
    partial = _sample_report()
    _sales_convs(partial)[1]["upsell"] = None
    for label, rep in (("full", _sample_report()), ("partial", partial)):
        storage = LocalStorage(tmp_path / label)
        job_id = _add_custom_job(storage, tmp_path, "2026-10-14T10:00:00+00:00", rep)
        dashboard.set_name(storage, job_id, "A", "Meena")
        totals[label] = dashboard.build_dashboard(storage, "month", NOW).people[0].total
    p = totals["partial"]
    assert p.conversations == 3 and p.analysed_conversations == 1  # the sample already has one unanalysed call
    assert totals["full"].analysed_conversations == 2
    assert p.upsell_rate == totals["full"].upsell_rate == 1.0  # an unanalysed call is not a "no upsell"
    assert p.attempts_per_conversation == round(p.attempts / 1, 2)

    nothing = _sample_report()
    for c in nothing["conversations"]:
        c["upsell"] = None
    storage = LocalStorage(tmp_path / "none")
    job_id = _add_custom_job(storage, tmp_path, "2026-10-14T10:00:00+00:00", nothing)
    dashboard.set_name(storage, job_id, "A", "Meena")
    a = dashboard.build_dashboard(storage, "month", NOW).people[0].assessment
    assert a.insufficient_data and a.low_sample
    assert a.strengths == []  # absent data is not a strength, e.g. "Answers what customers ask."
    assert "Not enough analysed" in a.headline


def test_assess_scores_only_categories_with_data():
    base = {"period": "p", "conversations": 10, "analysed_conversations": 10}
    # no solo conversations = nothing about how they treat customers to judge, so no rating (never upselling alone)
    sparse = dashboard.assess(dashboard.Bucket(**base, upsell_rate=0.0), [])
    assert sparse.insufficient_data and sparse.low_sample
    assert not any("Answers what customers ask" in s for s in sparse.strengths)

    full = dashboard.Bucket(
        **base, solo_analysed_conversations=10, greeting_rate=1.0, upsell_rate=0.8, acceptance_rate=0.5,
        answered_offers=6, attempts=8,
    )
    assert dashboard.assess(full, []).rating == "strong"  # every available point, not a share of a fixed total

    few = dashboard.Bucket(period="p", conversations=2, analysed_conversations=2, solo_analysed_conversations=2)
    assert dashboard.assess(few, []).insufficient_data


def test_upselling_is_one_part_of_the_rating_not_all_of_it():
    base = {
        "period": "p",
        "conversations": 5,
        "analysed_conversations": 5,
        "solo_analysed_conversations": 5,
        "greeting_rate": 1.0,
        "avg_customer_frustration": 1.0,
    }
    # Greets, answers every question, customers stay calm - but never upsells. Selling is a minority of the points,
    # so this is a solid person, but with no offers there is no evidence of selling: "on track", not "excelling".
    assert dashboard.assess(dashboard.Bucket(**base, upsell_rate=0.0), []).rating == "solid"
    # The same person with unhappy customers drops further: customer handling outweighs the upsell figures.
    tense = {**base, "avg_customer_frustration": 6.0}
    assert dashboard.assess(dashboard.Bucket(**tense, upsell_rate=0.0), []).rating == "needs_work"


def test_a_strong_upseller_who_treats_customers_badly_is_not_rated_well():
    bad = dashboard.Bucket(
        period="p",
        conversations=5,
        analysed_conversations=5,
        solo_analysed_conversations=5,
        greeting_rate=0.2,
        upsell_rate=0.9,
        acceptance_rate=0.8,
        pushy_conversations=5,
        unanswered_questions=5,
        avg_customer_frustration=7.0,
    )
    a = dashboard.assess(bad, [])
    assert a.rating == "needs_work"
    assert any("Kept pitching after a clear 'no'" in line for line in a.improvements)


def _set_first_conversation_attempts(storage, job_id: str, attempts: list[tuple[str, str]]) -> None:
    key = jobs.report_key(job_id)
    report = storage.get_json(key)
    template = report["conversations"][0]["upsell"]["upsell_attempts"][0]
    report["conversations"][0]["upsell"]["upsell_attempts"] = [
        {**template, "technique": technique, "customer_response": response} for technique, response in attempts
    ]
    storage.put_json(key, report)


def test_technique_stats_empty_storage(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    assert dashboard.build_dashboard(storage, "month").technique_stats == []


def test_technique_stats_counts_rates_people_and_excludes_unassigned(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    # Rahul: the sample as-is: bundle rejected, cross_sell accepted, plan_upgrade rejected, social_proof rejected
    rahul = _add_job(storage, tmp_path, "2026-10-12T10:00:00+00:00")
    dashboard.set_name(storage, rahul, "A", "Rahul")
    priya = _add_job(storage, tmp_path, "2026-10-14T10:00:00+00:00")
    dashboard.set_name(storage, priya, "A", "Priya")
    _set_first_conversation_attempts(
        storage,
        priya,
        [
            ("bundle", "accepted"),
            ("bundle", "undecided"),
            ("cross_sell", "no_response"),
            ("discount_offer", "undecided"),
        ],
    )
    # an unassigned recording must not count towards any technique
    other = _add_job(storage, tmp_path, "2026-10-15T10:00:00+00:00")
    _set_first_conversation_attempts(storage, other, [("bundle", "accepted")] * 5)

    stats = dashboard.build_dashboard(storage, "month").technique_stats
    got = {s.technique: (s.attempts, s.accepted, s.rejected, s.acceptance_rate, s.people) for s in stats}
    assert got == {
        "bundle": (3, 1, 1, 0.5, 2),
        "cross_sell": (2, 1, 0, 1.0, 2),
        "plan_upgrade": (2, 0, 2, 0.0, 2),
        "social_proof": (2, 0, 2, 0.0, 2),
        "discount_offer": (1, 0, 0, None, 1),
    }
    # attempts desc, then technique name
    assert [s.technique for s in stats] == ["bundle", "cross_sell", "plan_upgrade", "social_proof", "discount_offer"]
    assert all(s.attempts >= s.accepted + s.rejected for s in stats)


def test_technique_stats_agree_with_people_totals_and_ignore_period(tmp_path):
    storage = LocalStorage(tmp_path / "s")
    for created, name in [("2026-10-02T10:00:00+00:00", "Rahul"), ("2026-10-20T10:00:00+00:00", "Priya")]:
        job_id = _add_job(storage, tmp_path, created)
        dashboard.set_name(storage, job_id, "A", name)
    month = dashboard.build_dashboard(storage, "month")
    assert sum(s.attempts for s in month.technique_stats) == sum(p.total.attempts for p in month.people) > 0
    # same all-recordings numbers whichever period is requested
    day = dashboard.build_dashboard(storage, "day")
    assert day.technique_stats == month.technique_stats


def _mood_bucket(avg: float) -> dashboard.Bucket:
    return dashboard.Bucket(
        period="p",
        conversations=4,
        analysed_conversations=4,
        solo_analysed_conversations=4,
        avg_customer_frustration=avg,
    )


@pytest.mark.parametrize(
    ("avg", "expected"),
    [
        (2.9, "Most customers stay calm"),  # under 3 is calm, as in the prompt's bands
        (3.0, "somewhat tense"),  # 3 to 4 is some tension (was still "calm" at exactly 3 before)
        (4.9, "somewhat tense"),
        (5.0, "leave frustrated"),  # 5 and over is frustrated
    ],
)
def test_mood_wording_follows_the_same_cut_offs_as_the_scoring_bands(avg, expected):
    a = dashboard.assess(_mood_bucket(avg), [])
    assert any(expected in line for line in a.strengths + a.improvements)


def test_a_period_reports_its_worst_conversation_as_well_as_the_average():
    acc = dashboard._Acc()
    acc.frustration = [1.0, 7.0, 2.0]
    b = acc.bucket("p")
    assert b.avg_customer_frustration == 3.3 and b.max_customer_frustration == 7.0
    assert dashboard._Acc().bucket("p").max_customer_frustration is None


def test_advice_puts_customer_handling_first_and_upselling_last_as_optional_tips():
    t = dashboard.Bucket(
        period="p",
        conversations=6,
        analysed_conversations=6,
        solo_analysed_conversations=6,
        greeting_rate=1.0,
        upsell_rate=0.5,
        acceptance_rate=0.1,
        answered_offers=8,
        attempts=8,
        techniques=["bundle"],
        pushy_conversations=3,
        unanswered_questions=9,
        avg_customer_frustration=2.6,
        max_customer_frustration=8.0,
    )
    a = dashboard.assess(t, [])
    # the first things to fix are about customers, in this order: questions, pressure, the worst conversation
    assert "went unanswered" in a.improvements[0]
    assert "Kept pitching after a clear 'no'" in a.improvements[1]
    assert "very frustrated" in a.improvements[2] and "8/10" in a.improvements[2]
    assert not any("upsell" in line.lower() or "offer" in line.lower() for line in a.improvements)
    # upselling is its own optional list
    assert any("Tries an upsell" in tip for tip in a.upsell_tips) and any("accepted" in tip for tip in a.upsell_tips)
    # a sales technique is no longer praised as a strength
    assert not any("different techniques" in line for line in a.strengths)
    assert a.strengths[0].startswith("Greets customers")


def test_someone_with_nothing_to_fix_about_customers_has_only_optional_upsell_tips():
    t = dashboard.Bucket(
        period="p",
        conversations=5,
        analysed_conversations=5,
        solo_analysed_conversations=5,
        greeting_rate=1.0,
        upsell_rate=0.0,
        avg_customer_frustration=0.0,
        max_customer_frustration=0.0,
    )
    a = dashboard.assess(t, [])
    assert a.rating == "solid" and a.improvements == []  # no offers at all: no evidence of selling
    assert len(a.upsell_tips) == 1 and "Rarely offers an add-on" in a.upsell_tips[0]


def test_unanswered_question_advice_uses_the_right_singular_and_plural():
    def advice(unanswered: int, convs: int) -> str:
        b = dashboard.Bucket(
            period="p",
            conversations=convs,
            analysed_conversations=convs,
            solo_analysed_conversations=convs,
            unanswered_questions=unanswered,
        )
        return next(x for x in dashboard.assess(b, []).improvements if "unanswered" in x)

    assert advice(1, 2).startswith("1 customer question went unanswered across 2 conversations")
    assert advice(3, 4).startswith("3 customer questions went unanswered")


def _solo(**kw) -> dashboard.Bucket:
    base = {
        "period": "p", "conversations": 10, "analysed_conversations": 10, "solo_analysed_conversations": 10,
        "greeting_rate": 1.0, "unanswered_questions": 0, "pushy_conversations": 0,
        "avg_customer_frustration": 0.0, "max_customer_frustration": 0.0, "customer_requests": 3,
    }  # fmt: skip
    if kw.get("upsell_rate"):
        base["attempts"] = 3  # a rate with no offers behind it would be a contradiction
        base["acceptance_rate"], base["answered_offers"] = 0.5, 4  # customers said yes to some of them
    return dashboard.Bucket(**{**base, **kw})


def test_a_rating_needs_three_conversations_with_a_single_salesperson():
    # 3 analysed conversations, but only one of them is the person's alone: not enough to judge how they treat customers
    one_alone = dashboard.assess(_solo(solo_analysed_conversations=1), [])
    assert one_alone.insufficient_data and "1 of 3" in one_alone.headline
    assert any("single salesperson" in line for line in one_alone.improvements)
    # all shared with a colleague: never rated, and never from upselling alone
    shared = dashboard.assess(
        _solo(solo_analysed_conversations=0, greeting_rate=None, avg_customer_frustration=None, max_customer_frustration=None,
              upsell_rate=1.0, attempts=3, acceptance_rate=0.5, answered_offers=3),
        [],
    )  # fmt: skip
    assert shared.insufficient_data and any("shared with a colleague" in line for line in shared.improvements)
    assert not dashboard.assess(_solo(), []).insufficient_data


def test_one_very_upset_customer_keeps_a_good_average_from_being_excelling():
    calm = dashboard.assess(_solo(upsell_rate=0.8), [])
    assert calm.rating == "strong"
    # same average-looking numbers, but one customer left very frustrated
    upset = dashboard.assess(_solo(upsell_rate=0.8, avg_customer_frustration=2.7, max_customer_frustration=8.0), [])
    assert upset.rating == "solid" and any("very frustrated" in line for line in upset.improvements)
    # a mildly irritated customer does not trigger the cap
    assert dashboard.assess(_solo(upsell_rate=0.8, max_customer_frustration=6.0), []).rating == "strong"


def test_a_declined_offer_does_not_lower_the_rating_until_there_are_enough_answers():
    none = dashboard.assess(_solo(upsell_rate=0.0), [])
    one_no = dashboard.assess(_solo(upsell_rate=0.7, attempts=1, acceptance_rate=0.0, answered_offers=1), [])
    assert none.rating == one_no.rating == "solid"  # one "no" is no evidence of selling, and does not count against
    assert not any("accepted" in tip for tip in one_no.upsell_tips)
    # with enough answers the yes-rate does count
    many_no = dashboard.assess(_solo(upsell_rate=0.7, attempts=5, acceptance_rate=0.0, answered_offers=5), [])
    assert any("accepted" in tip for tip in many_no.upsell_tips)


def test_doing_only_one_thing_is_not_rated_well():
    # Greets every customer, but nobody asked for anything, no offers were made, nothing was sold.
    ten = {"conversations": 10, "analysed_conversations": 10, "solo_analysed_conversations": 10}
    quiet = _solo(**ten, customer_requests=0, upsell_rate=0.0)
    assert dashboard.assess(quiet, []).rating == "needs_work"


def test_a_problem_that_keeps_happening_keeps_a_good_score_from_being_excelling():
    base = {"upsell_rate": 0.8, "attempts": 8, "acceptance_rate": 0.5, "answered_offers": 8}
    assert dashboard.assess(_solo(**base), []).rating == "strong"
    pushy = dashboard.assess(_solo(**base, pushy_conversations=4), [])
    assert pushy.rating == "solid"
    ignored = dashboard.assess(_solo(**base, unanswered_questions=4, conversations_with_unanswered=4), [])
    assert ignored.rating == "solid"
    # one slip in a few conversations is not a pattern
    ten = {"conversations": 10, "analysed_conversations": 10, "solo_analysed_conversations": 10}
    assert dashboard.assess(_solo(**ten, **base, pushy_conversations=1), []).rating == "strong"


def test_excelling_needs_every_aspect_to_earn_at_least_half_its_points():
    ten = {"conversations": 10, "analysed_conversations": 10, "solo_analysed_conversations": 10}
    good = {"upsell_rate": 0.8, "attempts": 9, "answered_offers": 9, **ten}
    strong = dashboard.assess(_solo(**good, acceptance_rate=0.5), [])
    assert strong.rating == "strong" and strong.headline.startswith("Excelling")
    # high total (12 of 15) but customers almost never say yes: not excelling, and it says why
    weak = dashboard.assess(_solo(**good, acceptance_rate=0.11), [])
    assert weak.rating == "solid" and weak.headline == "On track, held back by customers saying yes"
    # half the points on an aspect is enough
    half = dashboard.assess(_solo(**good, acceptance_rate=0.25), [])
    assert half.rating == "strong"


def test_two_ignored_questions_in_one_conversation_count_as_one_conversation():
    ten = {"conversations": 10, "analysed_conversations": 10, "solo_analysed_conversations": 10}
    base = {"upsell_rate": 0.8, "attempts": 9, "answered_offers": 9, "acceptance_rate": 0.5, **ten}
    # 3 ignored questions, all in one conversation of ten: a bad conversation, not a pattern
    one_bad = dashboard.assess(_solo(**base, unanswered_questions=3, conversations_with_unanswered=1), [])
    assert one_bad.rating == "strong"
    # the same kind of problem in 4 of 10 conversations is a pattern
    spread = dashboard.assess(_solo(**base, unanswered_questions=4, conversations_with_unanswered=4), [])
    assert spread.rating == "solid" and "unanswered in 4 conversations" in spread.headline


def test_headline_names_the_most_serious_reason_first():
    base = {"upsell_rate": 0.8, "attempts": 9, "answered_offers": 9, "conversations": 10,
            "analysed_conversations": 10, "solo_analysed_conversations": 10}  # fmt: skip
    # weak spot (customers rarely say yes) plus a pushed conversation and an irritated customer: all three are named
    a = dashboard.assess(_solo(**base, acceptance_rate=0.1, pushy_conversations=1, max_customer_frustration=6.0), [])
    assert a.rating == "solid"
    h = a.headline
    assert h.index("customers saying yes") < h.index("pitching again") < h.index("frustrated")
    # one very upset customer comes first
    b = dashboard.assess(_solo(**base, acceptance_rate=0.5, max_customer_frustration=8.0), [])
    assert b.headline == "On track, held back by a very frustrated customer (8/10)"


def test_needs_support_is_only_an_early_read_below_five_conversations():
    bad = {
        "greeting_rate": 0.0, "unanswered_questions": 3, "conversations_with_unanswered": 3, "pushy_conversations": 3,
        "avg_customer_frustration": 6.0, "max_customer_frustration": 6.0, "upsell_rate": 0.0,
    }  # fmt: skip
    three = {"conversations": 3, "analysed_conversations": 3, "solo_analysed_conversations": 3}
    early = dashboard.assess(_solo(**bad, **three), [])
    assert early.rating == "solid" and early.early_read and early.headline.startswith("Early read")
    five = {"conversations": 5, "analysed_conversations": 5, "solo_analysed_conversations": 5}
    assert dashboard.assess(_solo(**bad, **five), []).rating == "needs_work"


def test_mood_labels_with_a_role_suffix_still_match_the_conversations_customers():
    from upsell_poc.schemas import FrustrationMoment, SpeakerMood

    # The model sometimes writes "B (customer)"; it must still be read as customer "B".
    mood = SpeakerMood(
        speaker="B (customer)", overall_mood="frustrated", frustration_level=6, trend="worsening", summary="x"
    )
    assert mood.speaker == "B"
    moment = FrustrationMoment(
        segment_id=3, speaker="@ (other)", quote="q", evidence_source="words", evidence="e"
    )
    assert moment.speaker == "@"
    assert SpeakerMood(speaker="A", overall_mood="calm", frustration_level=0, trend="stable", summary="").speaker == "A"


def test_every_label_is_only_an_early_read_below_five_conversations():
    four = {"conversations": 4, "analysed_conversations": 4, "solo_analysed_conversations": 4}
    good = _solo(**four, upsell_rate=0.8, attempts=8, acceptance_rate=0.5, answered_offers=8)
    a = dashboard.assess(good, [])
    assert a.rating == "solid" and a.early_read and "looking good so far" in a.headline  # not "Excelling" on 4
    middling = dashboard.assess(_solo(**four, greeting_rate=0.6), [])
    assert middling.early_read and middling.rating == "solid"
    # five or more is a real rating again
    five = {"conversations": 5, "analysed_conversations": 5, "solo_analysed_conversations": 5}
    firm = dashboard.assess(_solo(**five, upsell_rate=0.8, attempts=8, acceptance_rate=0.5, answered_offers=8), [])
    assert not firm.early_read


def test_excelling_needs_a_minimum_number_of_conversations():
    five = {"conversations": 5, "analysed_conversations": 5, "solo_analysed_conversations": 5}
    six = {"conversations": 6, "analysed_conversations": 6, "solo_analysed_conversations": 6}
    strong = {"upsell_rate": 0.8, "attempts": 8, "acceptance_rate": 0.5, "answered_offers": 8}
    assert dashboard.MIN_FOR_EXCELLING == 6
    a = dashboard.assess(_solo(**strong, **five), [])  # a real rating, but not enough for the top label
    assert a.rating == "solid" and not a.early_read and "6 conversations are needed" in a.headline
    assert dashboard.assess(_solo(**strong, **six), []).rating == "strong"


def test_recent_calls_say_which_period_they_belong_to():
    from pathlib import Path

    from upsell_poc.storage import LocalStorage

    store = Path(__file__).parents[1] / "sample_data" / "store"
    for period in ("day", "week", "month"):
        board = dashboard.build_dashboard(LocalStorage(store), period)
        for person in board.people:
            labels = {b.period for b in person.series}
            assert person.recent_calls and all(c.period in labels for c in person.recent_calls)
            # the conversations behind the headline figures are exactly the ones carrying the latest label
            behind = [c for c in person.recent_calls if c.period == person.total.period]
            assert len(behind) == person.total.conversations or len(person.recent_calls) == 8
