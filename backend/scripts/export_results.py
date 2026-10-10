"""Export the results for the recordings in one folder (hidden test set, RUNBOOK_HIDDEN_SET.md).

Same columns as GET /pipeline/export (app.api.pipeline.export_rows), plus original_file_name from the
folder's _names.csv. Calls are found by file hash, not by name, so a recording whose audio equals an
earlier call (skipped as duplicate) is still in the results. Writes <out>.json and <out>.csv.

Usage (from backend/): python scripts/export_results.py --folder ../data/hidden-test-set --out ../data/export/hidden_results
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session, select  # noqa: E402

from app.api.pipeline import EXPORT_COLUMNS, _csv_value, export_rows  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.models.tables import Call  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folder", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True, help="Output path without extension")
    args = ap.parse_args()
    names = {}
    if (args.folder / "_names.csv").exists():
        with open(args.folder / "_names.csv", encoding="utf-8") as f:
            names = {r["call_id"]: r["original_file_name"] for r in csv.DictReader(f)}
    wavs = sorted(p for p in args.folder.glob("*.wav"))
    with Session(get_engine()) as session:
        by_hash = {c.file_hash: c.id for c in session.exec(select(Call))}
        rows = {r["call_id"]: r for r in export_rows(session)}
    out, missing = [], []
    for p in wavs:
        cid = by_hash.get(hashlib.sha256(p.read_bytes()).hexdigest())
        if cid is None or cid not in rows:
            missing.append(p.name)
            continue
        row = dict(rows[cid])
        row["original_file_name"] = names.get(p.stem, p.name)
        out.append(row)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.with_suffix(".json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    with open(args.out.with_suffix(".csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(EXPORT_COLUMNS + ["original_file_name"])
        for r in out:
            ev = ";".join(f"{e['role']}:{e['start_s']:g}-{e['end_s']:g}" for e in r["evidence"])
            w.writerow([_csv_value(ev if col == "evidence" else r[col]) for col in EXPORT_COLUMNS] + [_csv_value(r["original_file_name"])])
    undecided = [r["call_id"] for r in out if r["verdict"] is None]
    counts = {v: sum(1 for r in out if r["verdict"] == v) for v in ("alarm", "review", "no_alert")}
    print(f"{len(out)} of {len(wavs)} recordings exported -> {args.out}.json / .csv | {counts}")
    if undecided:
        print(f"  NOT DECIDED yet ({len(undecided)}): {', '.join(undecided)}  (check status: waiting_for_asr / failed)")
    if missing:
        print(f"  NOT REGISTERED ({len(missing)}): {', '.join(missing)}  (run process_all.py --folder first)")
    return 1 if undecided or missing else 0


if __name__ == "__main__":
    sys.exit(main())
