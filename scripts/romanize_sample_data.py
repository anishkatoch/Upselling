"""Rewrite the saved sample-data reports and transcripts so Hindi appears as Hinglish (English letters).

Safe to re-run. Needs OPENAI_API_KEY only for Hindi words not already in src/upsell_poc/hinglish_words.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from upsell_poc.romanize import devanagari_words, ensure_words, romanize_text  # noqa: E402


def main() -> None:
    files = sorted((ROOT / "sample_data" / "store" / "jobs").glob("*/*.json"))
    texts = {f: f.read_text("utf-8") for f in files}
    words = set().union(*(devanagari_words(t) for t in texts.values()))
    print(f"{len(words)} distinct Hindi words in {sum(1 for t in texts.values() if devanagari_words(t))} files")
    chain = None
    if words:
        from dotenv import load_dotenv  # noqa: PLC0415

        load_dotenv(ROOT / ".env")
        from upsell_poc.config import load_models_config  # noqa: PLC0415
        from upsell_poc.llm.chain import build_chain  # noqa: PLC0415

        chain = build_chain(load_models_config().llm)
    lookup = ensure_words(words, chain)
    changed = 0
    for f, t in texts.items():
        new = romanize_text(t, lookup)
        if new != t:
            json.loads(new)  # still valid JSON
            f.write_text(new, "utf-8")
            changed += 1
    left = sum(1 for f in files if devanagari_words(f.read_text("utf-8")))
    print(f"rewrote {changed} files; files still containing Hindi script: {left}")


if __name__ == "__main__":
    main()
