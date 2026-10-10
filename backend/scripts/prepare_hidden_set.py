"""Prepare a folder of recordings for the GPU box and the pipeline (hidden test set, RUNBOOK_HIDDEN_SET.md).

Every audio file becomes a 16 kHz mono WAV with a safe name (letters, digits, _ . -) in --out, so the
call ID on the laptop, the transcript name from the GPU box and the export all match. Writes
<out>/_names.csv (original file name -> call ID) to map results back to the organisers' names.
Unreadable files are listed and skipped.

Usage (from backend/): python scripts/prepare_hidden_set.py --in ~/Downloads/hidden --out ../data/hidden-test-set
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import subprocess
import sys
from pathlib import Path

import soundfile as sf

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows, used, failed = [], set(), []
    for p in sorted(args.inp.iterdir()):
        if not p.is_file() or p.name.startswith(".") or p.suffix.lower() not in AUDIO_EXT:
            continue
        stem = re.sub(r"[^A-Za-z0-9_.-]", "_", p.stem)  # ASCII only: safe for scp, shell and URLs
        call_id, n = stem, 2
        while call_id in used:
            call_id, n = f"{stem}_{n}", n + 1
        used.add(call_id)
        target = args.out / f"{call_id}.wav"
        try:
            info = sf.info(str(p)) if p.suffix.lower() == ".wav" else None
            if info and info.samplerate == 16000 and info.channels == 1:
                shutil.copy(p, target)
                how = "copied"
            else:
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(p), "-ar", "16000", "-ac", "1", str(target)],
                               check=True, capture_output=True, timeout=300)
                how = "converted"
            dur = sf.info(str(target)).duration
        except Exception as exc:
            failed.append((p.name, type(exc).__name__))
            target.unlink(missing_ok=True)
            continue
        rows.append({"original_file_name": p.name, "call_id": call_id, "duration_s": round(dur, 1), "prepared": how})
    with open(args.out / "_names.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["original_file_name", "call_id", "duration_s", "prepared"])
        w.writeheader()
        w.writerows(rows)
    total = sum(r["duration_s"] for r in rows)
    print(f"{len(rows)} recordings ready in {args.out} ({total / 60:.1f} min audio; "
          f"{sum(r['prepared'] == 'converted' for r in rows)} converted, {sum(r['call_id'] != Path(r['original_file_name']).stem for r in rows)} renamed)")
    for name, err in failed:
        print(f"  SKIPPED {name}: not readable as audio ({err})")
    print(f"Name mapping: {args.out / '_names.csv'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
