"""Command line: analyze a local file without the API.

uv run upsell-poc analyze recording.mp4 --industry electronics --out report.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from upsell_poc import jobs
from upsell_poc.config import get_settings
from upsell_poc.logging_setup import setup_logging
from upsell_poc.pipeline import run_job
from upsell_poc.storage import get_storage


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="upsell-poc")
    sub = parser.add_subparsers(dest="command", required=True)
    analyze = sub.add_parser("analyze", help="analyze an audio/video file")
    analyze.add_argument("file", type=Path)
    analyze.add_argument("--industry")
    analyze.add_argument("--catalog", type=Path, help="text file with the product catalog")
    analyze.add_argument("--out", type=Path, default=Path("report.json"))
    args = parser.parse_args(argv)

    settings = get_settings()
    setup_logging(settings.log_level)
    storage = get_storage(settings)
    catalog = args.catalog.read_text(encoding="utf-8") if args.catalog else None
    status = jobs.create_job(storage, args.file, args.file.name, args.industry, catalog)
    try:
        run_job(status.job_id)
    except Exception as e:  # noqa: BLE001
        print(f"job {status.job_id} failed: {e}", file=sys.stderr)
        return 1
    report = storage.get_json(jobs.report_key(status.job_id))
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"job {status.job_id} done -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
