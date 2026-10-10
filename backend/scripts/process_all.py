"""Run the pipeline for every WAV in a folder (plan B18).

Registers each file (dedup by hash), then runs the stages for all calls in stage-major batches,
with LLM calls bounded by LLM_CONCURRENCY. Calls without an ASR transcript wait (waiting_for_asr).

Usage (from backend/):
  python scripts/process_all.py                       # case-data/Audio, all stages
  python scripts/process_all.py --from checks         # re-run checks + decision on stored outputs
  python scripts/process_all.py --calls Stufe2_C09-K3 Stufe2_C10-K3
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session, select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.db.init import init_db  # noqa: E402
from app.models.tables import Call, Decision  # noqa: E402
from app.pipeline.run import PENDING_STAGES, STAGES, process, register  # noqa: E402


def main() -> int:
    s = get_settings()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folder", type=Path, default=s.case_data_path / "Audio")
    ap.add_argument("--from", dest="from_stage", choices=STAGES, default="asr")
    ap.add_argument("--calls", nargs="*", help="Only these call IDs (file stems)")
    ap.add_argument("--recheck", action="store_true", help="Re-run the checks instead of reusing stored results (LLM cache still applies)")
    ap.add_argument("--list", action="store_true", help="Print every call's verdict (includes holdout calls: evaluation reads them in B29 only)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)

    init_db()
    wavs = sorted(args.folder.glob("*.wav"))
    if args.calls:
        wavs = [w for w in wavs if w.stem in set(args.calls)]
    ids, new = [], 0
    for w in wavs:
        call, is_new = register(w)
        ids.append(call.id)
        new += is_new
    print(f"{len(ids)} calls ({new} new) | stages from '{args.from_stage}': {', '.join(STAGES[STAGES.index(args.from_stage):])} "
          f"| not built yet: {', '.join(PENDING_STAGES)} | k={s.llm_samples}, reasoning {s.llm_reasoning}, concurrency {s.llm_concurrency}")
    started = time.monotonic()
    summary = process(ids, args.from_stage, recheck=args.recheck)
    print(f"done {len(summary.done)} | waiting_for_asr {len(summary.waiting_for_asr)} | failed {len(summary.failed)} | "
          f"Outcept triggers {summary.notified or '-'} | {time.monotonic() - started:.0f} s")
    for cid, err in summary.failed.items():
        print(f"  FAILED {cid}: {err}")
    with Session(get_engine()) as session:
        for cid in summary.done if args.list else []:
            d = session.get(Decision, cid)
            print(f"  {cid:<16} {d.verdict:<8} {d.family or '-':<14} score {d.score:>5.1f}  {(d.reason or '')[:70]}")
        counts = {}
        for c in session.exec(select(Call)).all():
            counts[c.status] = counts.get(c.status, 0) + 1
    print("Call statuses in the DB:", counts)
    return 1 if summary.failed else 0


if __name__ == "__main__":
    sys.exit(main())
