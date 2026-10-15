"""Phase 0: build a labelled synthetic test set (no real recordings needed).

1. The LLM chain writes sales conversations across industries / languages / scenarios,
   with ground-truth labels for every upsell attempt.
2. OpenAI TTS voices each speaker differently (with an emotion instruction).
3. Turns are joined with natural gaps; optional shop noise and phone-quality copies;
   optionally all files are stitched into one long recording.

    uv run python scripts/generate_test_data.py --count 12 --noise --phone --stitch
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import subprocess
from pathlib import Path

import openai
from pydantic import BaseModel, Field

from upsell_poc.config import load_models_config
from upsell_poc.llm.chain import build_chain
from upsell_poc.schemas import Mood, Role, Technique

INDUSTRIES = [
    "electronics retail",
    "footwear store",
    "mobile telecom plans",
    "pharmacy",
    "quick-service restaurant",
    "car showroom",
    "insurance",
    "supermarket",
]
LANGUAGES = ["hinglish", "english", "hindi"]
SCENARIOS = [
    "clear upsell with a bundle discount that the customer accepts",
    "salesperson retries an upsell after the customer says no (persistence)",
    "no upsell at all: customer asks for an item and the salesperson just provides it",
    "tricky: customer asks 'anything else good?' and the salesperson only shows what was asked",
    "upgrade to a premium model plus extended warranty; customer gets irritated and refuses",
    "two salespeople and two customers talking in overlapping interactions",
    "pushy salesperson keeps pushing while the customer becomes frustrated",
    "staff small talk with no selling, then a short sale with one cross-sell",
]

SYSTEM = """You write realistic sales conversation scripts for testing an upsell-detection system.
Use natural Indian shop-floor speech. For hindi use Devanagari; for hinglish use Roman-script \
Hindi mixed with English. 10-24 turns. Speaker labels S1, S2, ... Label every turn honestly: \
is_upsell_attempt is true ONLY for a salesperson proactively offering something beyond what the \
customer asked for (cross-sell, upgrade, bundle, conditional discount, warranty, plan upgrade, \
membership, urgency or social-proof pushes for extra items). Fulfilling a request is not an upsell."""


class ScriptTurn(BaseModel):
    speaker: str
    role: Role
    text: str
    emotion: Mood
    is_upsell_attempt: bool
    technique: Technique | None = Field(description="Set only when is_upsell_attempt is true.")


class TestScript(BaseModel):
    industry: str
    language: str
    scenario: str
    turns: list[ScriptTurn]
    expected_attempted_upsell: bool
    expected_attempts: int
    notes: str


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def tts_turns(client: openai.OpenAI, script: TestScript, model: str, voices: list[str], workdir: Path) -> list[Path]:
    voice_for: dict[str, str] = {}
    pool = itertools.cycle(random.sample(voices, len(voices)))
    paths = []
    for i, turn in enumerate(script.turns):
        voice = voice_for.setdefault(turn.speaker, next(pool))
        path = workdir / f"turn_{i:03d}.wav"
        with client.audio.speech.with_streaming_response.create(
            model=model,
            voice=voice,
            input=turn.text,
            response_format="wav",
            instructions=f"Indian accent, natural in-store conversation, {turn.emotion} tone.",
        ) as response:
            response.stream_to_file(path)
        paths.append(path)
    return paths


def join_turns(turns: list[Path], out: Path) -> None:
    """Concatenate with random 0.2-0.9 s gaps, resampled to 16 kHz mono."""
    inputs, filters = [], []
    for i, path in enumerate(turns):
        inputs += ["-i", str(path)]
        gap = random.uniform(0.2, 0.9)
        filters.append(f"[{i}:a]aresample=16000,aformat=channel_layouts=mono,apad=pad_dur={gap:.2f}[a{i}]")
    concat = "".join(f"[a{i}]" for i in range(len(turns))) + f"concat=n={len(turns)}:v=0:a=1[out]"
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            *inputs,
            "-filter_complex",
            ";".join([*filters, concat]),
            "-map",
            "[out]",
            str(out),
        ]
    )


def add_noise(src: Path, dst: Path) -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(src),
            "-filter_complex",
            "anoisesrc=color=pink:amplitude=0.02:sample_rate=16000[n];[0:a][n]amix=inputs=2:duration=first",
            str(dst),
        ]
    )


def phone_quality(src: Path, dst: Path) -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(src),
            "-af",
            "highpass=f=300,lowpass=f=3400",
            "-ar",
            "8000",
            "-ac",
            "1",
            str(dst),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=8)
    parser.add_argument("--out", type=Path, default=Path("testdata"))
    parser.add_argument("--noise", action="store_true", help="also write a shop-noise copy")
    parser.add_argument("--phone", action="store_true", help="also write an 8 kHz phone copy")
    parser.add_argument("--stitch", action="store_true", help="join all clean files into one long file")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    random.seed(args.seed)
    cfg = load_models_config()
    chain = build_chain(cfg.llm)
    client = openai.OpenAI(max_retries=3)
    args.out.mkdir(parents=True, exist_ok=True)

    combos = list(itertools.product(INDUSTRIES, LANGUAGES, SCENARIOS))
    random.shuffle(combos)
    clean_files: list[Path] = []
    for n, (industry, language, scenario) in enumerate(combos[: args.count], start=1):
        name = f"case_{n:03d}"
        script, _ = chain.generate(
            step="test_data_generation",
            system=SYSTEM,
            schema=TestScript,
            user=f"Industry: {industry}\nLanguage: {language}\nScenario: {scenario}",
        )
        workdir = args.out / f".work_{name}"
        workdir.mkdir(exist_ok=True)
        clean = args.out / f"{name}.wav"
        join_turns(tts_turns(client, script, cfg.tts.model, cfg.tts.voices, workdir), clean)
        clean_files.append(clean)
        if args.noise:
            add_noise(clean, args.out / f"{name}_noise.wav")
        if args.phone:
            phone_quality(clean, args.out / f"{name}_phone.wav")
        labels = script.model_dump()
        labels["expected_attempts"] = sum(t.is_upsell_attempt for t in script.turns)
        labels["expected_attempted_upsell"] = labels["expected_attempts"] > 0
        labels["expected_speakers"] = len({t.speaker for t in script.turns})
        (args.out / f"{name}.labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), "utf-8")
        for p in workdir.iterdir():
            p.unlink()
        workdir.rmdir()
        print(f"{name}: {industry} / {language} / attempts={labels['expected_attempts']}")

    if args.stitch and len(clean_files) > 1:
        listing = args.out / "stitch.txt"
        listing.write_text("".join(f"file '{p.resolve()}'\n" for p in clean_files))
        run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(listing),
                "-c",
                "copy",
                str(args.out / "long_stitched.wav"),
            ]
        )
        listing.unlink()
        print(f"long file: {args.out / 'long_stitched.wav'}")


if __name__ == "__main__":
    main()
