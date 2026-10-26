# Saudi demo data

Demo content is now Saudi. Nothing needed live API keys: all text is hand-authored and written as stored data.

## What changed
- `sample_data/store/`: replaced with 6 salespeople x 2 recordings (12 jobs, 3 conversations each, dated 2026-10-14 and 2026-10-21). Same schema as before (`status`, `report`, `transcript`, `people/names.json`, `people/roster.json`).
  - Faisal Al-Otaibi (electronics), Imran Siddiqui (electronics, expat), Noura Al-Qahtani (perfume), Khalid Al-Dosari (car showroom), Mohammed Hassan (telecom, expat), Reem Al-Harbi (appliances).
  - Spread: good upsell (Noura, Faisal), pushy upsell (Khalid 14 Oct: 4 offers, 3 after a "no", customer leaves), missed chance (Mohammed 14 Oct), unhappy customer (Reem 14 Oct delivery complaint), several customers per recording (every recording), improvement between R1 and R2 for Khalid, Mohammed, Reem.
  - Arabic script mixed with English, SAR prices, Saudi retail context.
- `sample_data/audio/` + `manifest.json`: removed. **There is no audio** for the Saudi set; `/audio` returns 404 and the UI offers no playback. Originals are in `sample_data_india_backup/` (full copy of the old `sample_data/`).
- Frontend (built into `src/upsell_poc/api/static`):
  - `Person.tsx`: figures are shown as final values, no count-up.
  - `TeamGlanceTable.tsx`: "Earlier period" badge hidden when every person is on an earlier period.
- Generator (not in the repo): `saudi_engine.py`, `saudi_content_a.py`, `saudi_content_b.py`, `build_saudi.py` in the shared notes folder `side-session-notes/local_a40c37f4-.../`. Run from repo root with `PYTHONPATH=src uv run python <dir>/build_saudi.py`. It validates every report against `JobReport` and recomputes metrics with the repo's own `salesperson_metrics` / `effort_score`.

## Review issues
- 100% vs 14% greeting rate: could not reproduce in the API (backend greeting_rate = greeted / solo analysed conversations, consistent everywhere). Most likely cause: `AnimatedNumber` counts up from 0 and a capture mid-animation shows a partial figure (14%). Not confirmed by an actual capture. Fix: Person page shows final values. `Dashboard.tsx` still uses `AnimatedNumber` for its tiles.
- "Salesperson A/D" labels: `speakerName()` falls back to these only when a recording has several salespeople or no employee name. Saudi jobs have one salesperson and a `salesperson_name`, so the UI shows the name. Code unchanged.
- Internal notes in role descriptions: roles are stripped by `public.py` (`TRANSCRIPT_HIDDEN`), and the Saudi data has empty reasoning. No code change.
- "Earlier period": data is dated close to today, and the badge is hidden when all are stale. Not verified: behaviour with a mix of current and stale people (code path untouched).
- Currency: `money()` in `frontend/src/lib/format.ts` still formats `$` but is not called anywhere in the frontend. Left as is. All SAR amounts are inside the hand-authored text.

## Verified (port 8765, uvicorn stopped afterwards)
- `curl` login with demo account: 200. `/api/dashboard?period=day|week|month`: 200 each; 6 people; month totals: 6 conversations each.
- All 12 jobs: `/report` and `/transcript` 200 (24/24). Spot check on one job: `/status` 200, `/outcomes` 200, `/audio` 404 (expected).
- Built-in browser: `/team` lists the 6 people, no stale badges; recording page for Khalid 14 Oct shows his name (not "Salesperson A"), "Customer 1/2/3", pushy count 1; Arabic transcript tab renders with shaped glyphs.
- `tests/test_public.py`: 6 passed. `npm ci && npm run build` (includes `tsc -b`): ok.

## Not verified / known gaps
- **Arabic has not been reviewed by a native speaker.** It is Gulf-flavoured, with some Egyptian touches for the Egyptian expat (Mohammed). Needs native review.
- RTL layout is not done: Arabic punctuation and mixed-direction lines are placed wrong in the transcript (seen in the screenshot). Later slice.
- `Language` in `schemas.py` has no `arabic`; Arabic or mixed conversations use `"other"`. Follow-up for the ASR session.
- Rating logic: Khalid is rated "Excelling" on the month view while his improvements list a pushy pitch and an irritated customer. Rating comes from `dashboard.py`; not changed (outside this slice).
- Remaining test failures in `uv run pytest` (21) are pre-existing: `frontend/src/data/dummy-report.json` and `demo-dashboard.json` are missing from the repo (not tracked in git). Not caused by this change.
- Single-recording browser check only; Person page and Dashboard page were not opened in the browser after the count-up change.
- No commit or push.
