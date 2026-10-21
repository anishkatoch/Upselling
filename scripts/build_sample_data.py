"""Build the committed POC sample data: floor recordings per named employee, already analysed.

The app has no ingestion pipeline in the POC, so it ships with a fixed set of recordings:

    sample_data/audio/<Employee>/<date>_<name>_floor_session.mp3   one recording = a session of 3 customers in a row
                                                                   (+ .labels.json: the scripts behind it)
    sample_data/store/                                             the app's storage: reports, transcripts, status

1. An LLM writes each customer encounter (English / Hindi / Hinglish); OpenAI TTS voices it. The salesperson keeps
   one voice per employee, customers get other voices.
2. The encounters of a session are joined with pauses into one recording, like a real shift on the shop floor.
3. The normal pipeline analyses every recording once (transcription, roles, conversation splitting, upsell, mood).
4. Each recording is filed under its employee and dated so the dashboard has a history.

Needs OPENAI_API_KEY in .env. Idempotent: finished steps are skipped, so it can be re-run.

    uv run python scripts/build_sample_data.py            # everything
    uv run python scripts/build_sample_data.py --dry-run  # print the plan only
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import threading
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "sample_data"
# Must be set before the app settings are read.
os.environ["LOCAL_STORAGE_DIR"] = str(OUT / "store")
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))

INDUSTRY = "electronics retail"
GAP_S = 8  # silence between customers in a session
EXTRA = (
    "\nExactly TWO speakers: one salesperson and one customer (S1 = salesperson, S2 = customer). "
    "Keep it 12-16 turns, a realistic store-floor encounter."
)

BUNDLE = "clear upsell with a bundle discount that the customer accepts"
RETRY = "salesperson retries an upsell after the customer says no (persistence)"
RETRY_ACCEPT = "salesperson retries after the customer says no, and the customer finally accepts one smaller add-on"
NO_UPSELL = "no upsell at all: customer asks for an item and the salesperson just provides it"
TRICKY = "tricky: customer asks 'anything else good?' and the salesperson only shows what was asked"
UPGRADE_NO = "upgrade to a premium model plus extended warranty; customer gets irritated and refuses"
UPGRADE_YES = "upgrade to a premium model plus extended warranty; the customer thinks it over and accepts"
PUSHY = "pushy salesperson keeps pushing while the customer becomes frustrated"
SMALL_TALK = "staff small talk with no selling, then a short sale with one cross-sell"

# One voice per employee so the same person sounds the same across a session.
VOICE = {
    "Arjun Mehta": "onyx",
    "Priya Sharma": "coral",
    "Sneha Iyer": "nova",
    "Neha Sharma": "shimmer",
    "Rahul Verma": "echo",
    "Vikram Singh": "ash",
}
CUSTOMER_VOICES = ["alloy", "sage", "ash", "nova", "coral", "echo", "onyx", "shimmer"]


@dataclass(frozen=True)
class Session:
    employee: str
    when: str  # the dashboard buckets by this date
    encounters: tuple[tuple[str, str], ...]  # (language, scenario) per customer


# Arjun and Priya do well, Sneha is solid, Neha and Rahul slip, Vikram stays low. Two sessions each: the week of
# 28 Sep (the earlier point on the trend) and the current week.
PLAN: list[Session] = [
    Session("Arjun Mehta", "2026-09-29", (("english", NO_UPSELL), ("english", TRICKY), ("hinglish", BUNDLE))),
    Session("Arjun Mehta", "2026-10-20", (("english", BUNDLE), ("english", UPGRADE_YES), ("hinglish", SMALL_TALK))),
    Session("Priya Sharma", "2026-09-29", (("hinglish", RETRY_ACCEPT), ("english", BUNDLE), ("hindi", UPGRADE_YES))),
    Session("Priya Sharma", "2026-10-20", (("english", UPGRADE_YES), ("hinglish", BUNDLE), ("hindi", RETRY_ACCEPT))),
    Session("Sneha Iyer", "2026-09-29", (("hinglish", NO_UPSELL), ("hindi", TRICKY), ("english", RETRY))),
    Session("Sneha Iyer", "2026-10-20", (("hinglish", BUNDLE), ("hindi", RETRY), ("english", NO_UPSELL))),
    Session("Neha Sharma", "2026-09-29", (("hindi", BUNDLE), ("hinglish", UPGRADE_YES), ("hindi", RETRY_ACCEPT))),
    Session("Neha Sharma", "2026-10-20", (("hindi", RETRY), ("hinglish", PUSHY), ("hindi", NO_UPSELL))),
    Session("Rahul Verma", "2026-09-29", (("english", RETRY_ACCEPT), ("hinglish", BUNDLE), ("english", SMALL_TALK))),
    Session("Rahul Verma", "2026-10-20", (("english", PUSHY), ("hinglish", NO_UPSELL), ("english", UPGRADE_NO))),
    Session("Vikram Singh", "2026-09-29", (("english", NO_UPSELL), ("hindi", TRICKY), ("hinglish", SMALL_TALK))),
    Session("Vikram Singh", "2026-10-20", (("hindi", NO_UPSELL), ("english", TRICKY), ("english", NO_UPSELL))),
]

_names_lock = threading.Lock()


def stem(s: Session) -> str:
    return f"{s.when}_{s.employee.split()[0].lower()}_floor_session"


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True, capture_output=True)


def tts_encounter(script, cfg, client, employee: str, customer_voice: str, workdir: Path) -> list[Path]:
    paths = []
    for i, turn in enumerate(script.turns):
        voice = VOICE[employee] if turn.role == "salesperson" else customer_voice
        path = workdir / f"turn_{i:03d}.wav"
        with client.audio.speech.with_streaming_response.create(
            model=cfg.tts.model,
            voice=voice,
            input=turn.text,
            response_format="wav",
            instructions=f"Indian accent, natural in-store conversation, {turn.emotion} tone.",
        ) as response:
            response.stream_to_file(path)
        paths.append(path)
    return paths


def concat(parts: list[Path], out: Path, gap: float, fixed_gap: bool) -> None:
    """Concatenate wavs to 16 kHz mono with a pause after each (random short gaps between turns)."""
    inputs, filters = [], []
    for i, p in enumerate(parts):
        inputs += ["-i", str(p)]
        pad = gap if fixed_gap else random.uniform(0.2, 0.9)
        filters.append(f"[{i}:a]aresample=16000,aformat=channel_layouts=mono,apad=pad_dur={pad:.2f}[a{i}]")
    chain = "".join(f"[a{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
    ffmpeg(*inputs, "-filter_complex", ";".join([*filters, chain]), "-map", "[out]", str(out))


def generate(s: Session) -> Path:
    """Write <stem>.mp3 and <stem>.labels.json for one session (idempotent)."""
    d = OUT / "audio" / s.employee
    d.mkdir(parents=True, exist_ok=True)
    mp3, labels_path = d / f"{stem(s)}.mp3", d / f"{stem(s)}.labels.json"
    if mp3.exists() and labels_path.exists():
        return mp3

    import generate_test_data as g  # noqa: PLC0415
    import openai  # noqa: PLC0415
    from upsell_poc.config import load_models_config  # noqa: PLC0415
    from upsell_poc.llm.chain import build_chain  # noqa: PLC0415

    cfg = load_models_config()
    chain = build_chain(cfg.llm)
    client = openai.OpenAI(max_retries=3)
    work = d / f".work_{stem(s)}"
    work.mkdir(exist_ok=True)
    customers = [v for v in CUSTOMER_VOICES if v != VOICE[s.employee]]
    wavs, scripts = [], []
    for n, (language, scenario) in enumerate(s.encounters):
        enc_wav = work / f"enc_{n}.wav"
        script_json = work / f"enc_{n}.json"
        if enc_wav.exists() and script_json.exists():
            wavs.append(enc_wav)
            scripts.append(json.loads(script_json.read_text("utf-8")))
            continue
        script, _ = chain.generate(
            step="test_data_generation",
            system=g.SYSTEM + EXTRA,
            schema=g.TestScript,
            user=f"Industry: {INDUSTRY}\nLanguage: {language}\nScenario: {scenario}",
        )
        turn_dir = work / f"turns_{n}"
        turn_dir.mkdir(exist_ok=True)
        voice = customers[(zlib.crc32(s.employee.encode()) + n + int(s.when[-2:])) % len(customers)]
        concat(tts_encounter(script, cfg, client, s.employee, voice, turn_dir), enc_wav, 0, fixed_gap=False)
        data = script.model_dump()
        data["expected_attempts"] = sum(t.is_upsell_attempt for t in script.turns)
        script_json.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        wavs.append(enc_wav)
        scripts.append(data)
    session_wav = work / "session.wav"
    concat(wavs, session_wav, GAP_S, fixed_gap=True)
    ffmpeg("-i", str(session_wav), "-ac", "1", "-ar", "16000", "-b:a", "32k", str(mp3))
    labels_path.write_text(
        json.dumps({"employee": s.employee, "date": s.when, "encounters": scripts}, ensure_ascii=False, indent=2),
        "utf-8",
    )
    shutil.rmtree(work, ignore_errors=True)
    return mp3


def analyse(s: Session, mp3: Path, manifest: dict) -> dict:
    from upsell_poc import dashboard, jobs  # noqa: PLC0415
    from upsell_poc.config import get_settings  # noqa: PLC0415
    from upsell_poc.pipeline import run_job  # noqa: PLC0415
    from upsell_poc.storage import get_storage  # noqa: PLC0415

    storage = get_storage(get_settings())
    key = f"{s.employee}/{mp3.name}"
    if key in manifest:
        return {key: manifest[key]}
    st = jobs.create_job(storage, mp3, mp3.name, INDUSTRY, salesperson_name=s.employee)
    run_job(st.job_id)
    jobs.update_status(storage, st.job_id, created_at=f"{s.when}T10:30:00+00:00")
    report = storage.get_json(jobs.report_key(st.job_id)) or {}
    # The pipeline can split one employee's voice into several speaker labels; the source of a recording knows who
    # the employee is, so every salesperson label in it belongs to them.
    labels = {sp for c in report.get("conversations", []) if c.get("is_sales_interaction") for sp in c["salespeople"]}
    with _names_lock:
        for label in sorted(labels):
            dashboard.set_name(storage, st.job_id, label, s.employee)
    final = jobs.get_status(storage, st.job_id)
    return {
        key: {"job_id": st.job_id, "status": final.status if final else "unknown", "salesperson_labels": sorted(labels)}
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    random.seed(21)

    if args.dry_run:
        for s in PLAN:
            print(f"{s.employee:14} {s.when} {stem(s)}")
            for language, scenario in s.encounters:
                print(f"{'':16}- {language:8} {scenario[:70]}")
        n = sum(len(s.encounters) for s in PLAN)
        print(f"{len(PLAN)} recordings, {n} customer encounters, {len(VOICE)} employees")
        return

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {}

    mp3s: dict[str, Path] = {}
    with ThreadPoolExecutor(args.workers) as pool:
        futs = {pool.submit(generate, s): s for s in PLAN}
        for f in as_completed(futs):
            s = futs[f]
            try:
                mp3s[stem(s)] = f.result()
                print("audio ok  ", s.employee, stem(s), flush=True)
            except Exception as err:  # noqa: BLE001
                print("audio FAIL", s.employee, stem(s), repr(err)[:200], flush=True)

    with ThreadPoolExecutor(args.workers) as pool:
        futs = {pool.submit(analyse, s, mp3s[stem(s)], manifest): s for s in PLAN if stem(s) in mp3s}
        for f in as_completed(futs):
            s = futs[f]
            try:
                manifest.update(f.result())
                manifest_path.write_text(json.dumps(manifest, indent=2), "utf-8")
                print("analysed  ", s.employee, stem(s), flush=True)
            except Exception as err:  # noqa: BLE001
                print("analyse FAIL", s.employee, stem(s), repr(err)[:200], flush=True)
    print(f"done: {len(manifest)} of {len(PLAN)} recordings analysed")


if __name__ == "__main__":
    main()
