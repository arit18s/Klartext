"""Reset the live-drop demo so demo_call.wav can be dropped again (rehearsals, video takes).

1. Removes inbox/<call_id>.wav if it is a byte-identical copy of data/demo/<call_id>.wav (otherwise left alone),
   so the watcher does not pick it up again.
2. Purges the call (scripts/purge_call.py --keep-transcript): DB rows, stage outputs, snippets; the cached
   transcript stays, so the next drop needs no ASR.
3. Outcept list: clears it (DELETE /triggers) and posts every batch alert and review once more, so the list is
   back to the batch calls only. Each re-post writes a triggers_sent row and a trigger_sent audit entry.

Usage (from backend/): python scripts/reset_demo.py [--call-id demo_call] [--keep-outcept]
"""

from __future__ import annotations

import argparse
import filecmp
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from sqlmodel import Session, delete, select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.models.tables import AuditLog, Decision, Evidence, TriggerSent  # noqa: E402
from app.pipeline.notify import VERDICT_LABEL, build_payload  # noqa: E402
from app.services.trigger_client import send_trigger  # noqa: E402


def repost_outcept() -> str:
    s = get_settings()
    httpx.delete(f"{s.trigger_api_url.rstrip('/')}/triggers", timeout=10).raise_for_status()
    sent = failed = 0
    with Session(get_engine()) as session:
        session.exec(delete(TriggerSent))
        decisions = session.exec(select(Decision).where(Decision.verdict.in_(list(VERDICT_LABEL)))).all()
        for d in sorted(decisions, key=lambda d: d.call_id):
            payload = build_payload(d, list(session.exec(select(Evidence).where(Evidence.call_id == d.call_id)).all()))
            r = send_trigger(**payload)
            session.add(TriggerSent(call_id=d.call_id, remote_id=r.remote_id, url=payload["url"], status_code=r.status_code))
            session.add(AuditLog(actor="system", action="trigger_sent", target=f"call:{d.call_id}", details_json=json.dumps(
                {"remote_id": r.remote_id, "status_code": r.status_code, "url": payload["url"], "verdict": d.verdict,
                 "family": d.family, "error": r.error, "note": "re-posted by reset_demo.py"})))
            sent, failed = sent + r.ok, failed + (not r.ok)
        session.commit()
    return f"Outcept list cleared and re-posted: {sent} sent, {failed} failed."


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--call-id", default="demo_call")
    ap.add_argument("--keep-outcept", action="store_true", help="Leave the Outcept list as it is")
    args = ap.parse_args()
    s = get_settings()

    inbox_file, original = s.inbox_path / f"{args.call_id}.wav", s.data_path / "demo" / f"{args.call_id}.wav"
    if inbox_file.exists():
        if original.exists() and filecmp.cmp(inbox_file, original, shallow=False):
            inbox_file.unlink()
            print(f"Removed {inbox_file} (copy of {original}).")
        else:
            print(f"Left {inbox_file} in place: it is not a copy of {original}. Remove it yourself if it is a demo drop.")

    purge = Path(__file__).with_name("purge_call.py")
    rc = subprocess.run([sys.executable, str(purge), args.call_id, "--keep-transcript"], check=False).returncode
    if rc != 0:
        return rc
    if not args.keep_outcept:
        print(repost_outcept())
    return 0


if __name__ == "__main__":
    sys.exit(main())
