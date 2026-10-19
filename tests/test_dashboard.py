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
