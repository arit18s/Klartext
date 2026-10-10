"""Remove one call completely: DB rows, stage outputs, snippets, converted audio (demo reset, tests).

The live demo drops a re-encoded copy of a batch call (e.g. demo_call.wav); after each rehearsal this puts
the Inbox back to the batch state. Refuses calls recorded in case-data unless --force (protects the batch).

Usage (from backend/): python scripts/purge_call.py demo_call [--keep-transcript] [--force]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session, delete  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.models.tables import (  # noqa: E402
    AuditLog, Call, CheckResult, CheckRun, Decision, Evidence, Feedback, KeywordHit, Segment, TriggerSent,
)

STAGE_DIRS = ["asr", "roles", "normalise", "keywords", "checks", "decide", "evidence"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("call_id")
    ap.add_argument("--keep-transcript", action="store_true", help="Keep data/transcripts/<call_id>.json for the next rehearsal")
    ap.add_argument("--force", action="store_true", help="Allow purging a call recorded in case-data")
    args = ap.parse_args()
    s = get_settings()
    with Session(get_engine()) as session:
        call = session.get(Call, args.call_id)
        if call and not args.force and Path(call.file_path).resolve().is_relative_to(s.case_data_path.resolve()):
            print(f"{args.call_id} is a batch recording from case-data. Use --force to purge it anyway.")
            return 2
        for table in (Segment, KeywordHit, CheckRun, CheckResult, Decision, Evidence, Feedback, TriggerSent):
            session.exec(delete(table).where(table.call_id == args.call_id))
        session.exec(delete(AuditLog).where(AuditLog.target == f"call:{args.call_id}"))
        if call:
            session.delete(call)
        session.commit()
    removed = [p for d in STAGE_DIRS for p in [s.data_path / d / f"{args.call_id}.json"] if p.exists()]
    removed += list((s.data_path / "snippets").glob(f"{args.call_id}_*.wav")) + [p for p in [s.data_path / "audio" / f"{args.call_id}.wav"] if p.exists()]
    if not args.keep_transcript and (s.data_path / "transcripts" / f"{args.call_id}.json").exists():
        removed.append(s.data_path / "transcripts" / f"{args.call_id}.json")
    for p in removed:
        p.unlink()
    print(f"Purged {args.call_id}: {'DB rows' if call else 'no DB row'}, {len(removed)} files. The twin stage refreshes on the next run.")
    print("Note: an Outcept trigger already posted stays in the Outcept list (DELETE /triggers clears that list).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
