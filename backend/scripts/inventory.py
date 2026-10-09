"""Inventory of the case data: every WAV with duration, format and derived IDs.

Derived fields come from the Outcept file-name convention and are for reporting
and evaluation only. Unknown names (hidden test set) yield null fields.

Usage: python scripts/inventory.py [--case-data ../case-data] [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import soundfile as sf
from pydantic import BaseModel

NAME_RE = re.compile(r"^(?P<dialogue>Stufe(?P<level>[123])_[A-Z]\d{2})-(?P<k>K[1-4])$")
VARIANTS = {"K1": "clean", "K3": "clean", "K2": "noisy", "K4": "noisy"}


class WavInfo(BaseModel):
    call_id: str
    dialogue_id: str | None
    variant: str | None
    level: int | None
    duration_s: float
    sample_rate: int
    channels: int
    subtype: str


def derive_ids(stem: str) -> tuple[str | None, str | None, int | None]:
    m = NAME_RE.match(stem)
    if not m:
        return None, None, None
    return m["dialogue"], VARIANTS[m["k"]], int(m["level"])


def inspect_wav(path: Path) -> WavInfo:
    info = sf.info(str(path))
    dialogue_id, variant, level = derive_ids(path.stem)
    return WavInfo(
        call_id=path.stem,
        dialogue_id=dialogue_id,
        variant=variant,
        level=level,
        duration_s=round(info.duration, 2),
        sample_rate=info.samplerate,
        channels=info.channels,
        subtype=info.subtype,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-data", type=Path, default=Path(__file__).resolve().parents[2] / "case-data")
    parser.add_argument("--json", type=Path, help="Optional path to write the inventory as JSON")
    args = parser.parse_args()

    wavs = sorted((args.case_data / "Audio").glob("*.wav"))
    rows = [inspect_wav(p) for p in wavs]

    print(f"{'call_id':<20} {'dialogue':<12} {'variant':<7} {'lvl':>3} {'dur_s':>7} {'sr':>6} {'ch':>2} subtype")
    for r in rows:
        print(
            f"{r.call_id:<20} {r.dialogue_id or '-':<12} {r.variant or '-':<7} {r.level or '-':>3} "
            f"{r.duration_s:>7.1f} {r.sample_rate:>6} {r.channels:>2} {r.subtype}"
        )

    scripts = sorted((args.case_data / "Transkript").glob("*.txt"))
    graded = sorted((args.case_data / "Skript_mit_Sollbewertung").glob("*.txt"))
    dialogues = {r.dialogue_id for r in rows if r.dialogue_id}
    per_level = Counter(r.level for r in rows)
    per_variant = Counter(r.variant for r in rows)
    bad_format = [r.call_id for r in rows if r.sample_rate != 16000 or r.channels != 1]
    total_min = sum(r.duration_s for r in rows) / 60

    print()
    print(f"WAVs: {len(rows)}  ({total_min:.1f} min total)")
    print(f"Scripts: {len(scripts)} in Transkript/, {len(graded)} in Skript_mit_Sollbewertung/")
    print(f"Dialogues with audio: {len(dialogues)}")
    print("WAVs per level: " + ", ".join(f"Stufe{k}: {v}" for k, v in sorted(per_level.items(), key=lambda kv: kv[0] or 0)))
    print("WAVs per variant: " + ", ".join(f"{k}: {v}" for k, v in sorted(per_variant.items(), key=str)))
    print(f"All 16 kHz mono: {'yes' if not bad_format else 'NO -> ' + ', '.join(bad_format)}")
    unknown = [r.call_id for r in rows if r.dialogue_id is None]
    if unknown:
        print(f"Unrecognised file names: {', '.join(unknown)}")

    if args.json:
        args.json.write_text(json.dumps([r.model_dump() for r in rows], indent=2))
        print(f"Wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
