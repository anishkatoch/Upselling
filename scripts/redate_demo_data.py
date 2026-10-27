"""Move the sample recordings forward in time so the newest one lands on a chosen day (default: today).

The demo recordings are dated in October 2026. The Dashboard only counts people with recordings in the current
period, so once that month is over it would show nothing. Run this before a demo (or on the deployed volume):

    python scripts/redate_demo_data.py                    # newest recording becomes today
    python scripts/redate_demo_data.py --to 2026-11-10    # or a day you choose
    python scripts/redate_demo_data.py --dry-run          # only say what would change

Every recording moves by the same whole number of days, so the gaps between them (this week / last week) stay the
same. Only `created_at` / `updated_at` in each job's status.json change. The default store is `LOCAL_STORAGE_DIR`,
else sample_data/store.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

DEFAULT_STORE = Path(__file__).resolve().parents[1] / "sample_data" / "store"
FIELDS = ("created_at", "updated_at")


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", type=Path, default=Path(os.environ.get("LOCAL_STORAGE_DIR") or DEFAULT_STORE))
    today = datetime.now(UTC).date()
    ap.add_argument("--to", type=date.fromisoformat, default=today, help="day the newest recording should land on")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = sorted((args.store / "jobs").glob("*/status.json"))
    docs = {f: json.loads(f.read_text("utf-8")) for f in files}
    docs = {f: d for f, d in docs.items() if d.get("created_at")}
    if not docs:
        raise SystemExit(f"no recordings found under {args.store / 'jobs'}")
    newest = max(_parse(d["created_at"]) for d in docs.values())
    shift = timedelta(days=(args.to - newest.date()).days)
    print(f"{len(docs)} recordings; newest is {newest.date()}; moving all by {shift.days:+d} days so it lands on {args.to}")
    if args.dry_run or not shift.days:
        print("nothing written" if args.dry_run else "already on that day")
        return
    for f, d in docs.items():
        for key in FIELDS:
            if d.get(key):
                d[key] = (_parse(d[key]) + shift).isoformat()
        f.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print("done")


if __name__ == "__main__":
    main()
