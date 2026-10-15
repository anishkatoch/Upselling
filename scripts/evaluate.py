"""Phase 5: compare pipeline reports against generated labels.

    uv run python scripts/evaluate.py --data testdata --run      # analyze every file, then score
    uv run python scripts/evaluate.py --data testdata            # score existing reports only

For each case_NNN[_noise|_phone].wav with case_NNN.labels.json it checks:
  - attempted upsell (yes/no): precision, recall, accuracy
  - number of attempts: mean absolute error
  - number of speakers detected vs. scripted
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("testdata"))
    parser.add_argument("--reports", type=Path, default=Path("reports"))
    parser.add_argument("--run", action="store_true", help="run the pipeline on each file first")
    args = parser.parse_args()
    args.reports.mkdir(parents=True, exist_ok=True)

    rows = []
    for wav in sorted(args.data.glob("case_*.wav")):
        case = re.match(r"(case_\d+)", wav.stem).group(1)  # type: ignore[union-attr]
        labels_path = args.data / f"{case}.labels.json"
        if not labels_path.exists():
            continue
        report_path = args.reports / f"{wav.stem}.json"
        if args.run and not report_path.exists():
            print(f"analyzing {wav.name} ...", flush=True)
            subprocess.run(
                [sys.executable, "-m", "upsell_poc.cli", "analyze", str(wav), "--out", str(report_path)], check=False
            )
        if not report_path.exists():
            print(f"skip {wav.name}: no report")
            continue
        labels = json.loads(labels_path.read_text("utf-8"))
        report = json.loads(report_path.read_text("utf-8"))
        attempts = sum(len(c["upsell"]["upsell_attempts"]) for c in report["conversations"] if c.get("upsell"))
        rows.append(
            {
                "file": wav.name,
                "expected": labels["expected_attempted_upsell"],
                "predicted": attempts > 0,
                "expected_attempts": labels["expected_attempts"],
                "attempts": attempts,
                "expected_speakers": labels["expected_speakers"],
                "speakers": len(report["speakers"]),
            }
        )

    if not rows:
        print("no reports to score")
        return
    tp = sum(r["expected"] and r["predicted"] for r in rows)
    fp = sum(not r["expected"] and r["predicted"] for r in rows)
    fn = sum(r["expected"] and not r["predicted"] for r in rows)
    acc = sum(r["expected"] == r["predicted"] for r in rows) / len(rows)
    mae = sum(abs(r["expected_attempts"] - r["attempts"]) for r in rows) / len(rows)
    spk = sum(r["expected_speakers"] == r["speakers"] for r in rows) / len(rows)

    print(f"\n{'file':28} {'exp':>4} {'pred':>5} {'att':>7} {'spk':>7}")
    for r in rows:
        print(
            f"{r['file']:28} {str(r['expected'])[0]:>4} {str(r['predicted'])[0]:>5} "
            f"{r['attempts']:>3}/{r['expected_attempts']:<3} {r['speakers']:>3}/{r['expected_speakers']:<3}"
        )
    print(
        f"\ncases={len(rows)}  accuracy={acc:.2f}  precision={tp / (tp + fp) if tp + fp else 0:.2f}  "
        f"recall={tp / (tp + fn) if tp + fn else 0:.2f}  attempts_MAE={mae:.2f}  speaker_count_acc={spk:.2f}"
    )


if __name__ == "__main__":
    main()
