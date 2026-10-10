"""Run family checks + decision on SCRIPT transcripts (development only, plan B10).

Sets: --set small = dev Stufe2 pairs + Stufe3_C17 + Stufe3_C18 (default), --set dev = whole dev split.
Holdout dialogues are refused (rule 4).
Writes data/checks_script/reasoning-<on|off>/<dialogue>.json and prints per-dialogue results,
binary precision/recall against the ground truth (evaluation only) and cost totals.

Usage (from backend/):
  python scripts/run_checks.py --reasoning off
  python scripts/run_checks.py --reasoning on --dialogues Stufe2_C09 Stufe2_C10
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.db.config_store import get_active_config  # noqa: E402
from app.eval.ground_truth import load_ground_truth  # noqa: E402
from app.models.checks import SampleRecord  # noqa: E402
from app.pipeline.checks import CallChecks, run_checks_many, run_numbers_many  # noqa: E402
from app.pipeline.check_stage import decision_for  # noqa: E402
from app.pipeline.sources import ScriptTranscriptSource  # noqa: E402

SPLITS = Path(__file__).resolve().parents[1] / "app/eval/splits.json"
SHORT = {"trade": "trd", "splitting": "spl", "access": "acc", "disclosure": "dis", "documentation": "doc"}


def dialogue_set(name: str) -> list[str]:
    splits = json.loads(SPLITS.read_text())
    if name == "dev":
        return list(splits["dev"])
    return [d for d in splits["dev"] if d.startswith("Stufe2_")] + ["Stufe3_C17", "Stufe3_C18"]


def main() -> int:
    s = get_settings()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dialogues", nargs="*", help="Dialogue IDs (overrides --set)")
    ap.add_argument("--set", choices=["small", "dev"], default="small", dest="set_name")
    ap.add_argument("--reasoning", choices=["on", "off"], default=s.llm_reasoning)
    ap.add_argument("--samples", type=int, default=s.llm_samples)
    ap.add_argument("--concurrency", type=int, default=s.llm_concurrency)
    ap.add_argument("--verbose", action="store_true", help="Log every LLM request")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)

    splits = json.loads(SPLITS.read_text())
    ids = args.dialogues or dialogue_set(args.set_name)
    if set(ids) & set(splits["holdout"]):
        print("Refusing to run on holdout dialogues (rule 4): " + ", ".join(sorted(set(ids) & set(splits["holdout"]))))
        return 2

    reasoning = args.reasoning == "on"
    families = get_active_config("families")
    thresholds = get_active_config("thresholds").data
    src = ScriptTranscriptSource()
    transcripts = [src.load(d) for d in ids]
    out_dir = s.data_path / "checks_script" / f"reasoning-{args.reasoning}"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Model {s.llm_model} | reasoning {args.reasoning} | k={args.samples} | concurrency {args.concurrency} | {len(ids)} dialogues")
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        numbers = run_numbers_many(transcripts, ex, reasoning)
        results = run_checks_many(transcripts, numbers, families.data, ex, args.samples, reasoning, s.llm_model, families.version_id)
    wall = time.monotonic() - started

    gt = load_ground_truth()
    rows, records = [], [n.record for n in numbers.values()]
    for did in ids:
        cc = results[did]
        d = decision_for(cc, thresholds, args.samples)
        payload = {"checks": cc.model_dump(), "decision": d.model_dump()}
        (out_dir / f"{did}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        records += [r for fr in cc.families.values() for r in fr.samples]
        rows.append((did, gt[did], d, cc))

    # ---- per dialogue ----
    fam_hdr = " ".join(f"{v:>5}" for v in SHORT.values())
    print(f"\n{'dialogue':<12} {'expected':<22} {'klartext':<22} {'rule':<13} {fam_hdr}  nh  ok")
    for did, g, d, cc in rows:
        scores = " ".join(
            f"{'fail' if cc.families[f].failed else int(cc.families[f].score):>5}" for f in SHORT if f in cc.families
        )
        nh = sum(fr.needs_human_votes for fr in cc.families.values())
        flagged, positive = d.verdict != "no_alert", g.is_positive
        mark = "✓" if flagged == positive else "✗"
        print(f"{did:<12} {g.verdict + ' ' + g.family:<22} {d.verdict + ' ' + (d.family or '-'):<22} {d.rule:<13} {scores}  {nh:>2}  {mark}")

    # ---- metrics (binary as scored by the case partners: review counts as caught) ----
    tp = sum(1 for _, g, d, _ in rows if g.is_positive and d.verdict != "no_alert")
    fp = sum(1 for _, g, d, _ in rows if not g.is_positive and d.verdict != "no_alert")
    fn = sum(1 for _, g, d, _ in rows if g.is_positive and d.verdict == "no_alert")
    exact = sum(1 for _, g, d, _ in rows if g.verdict == d.verdict)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    print(f"\nPrecision {prec:.2f} ({tp}/{tp + fp})  Recall {rec:.2f} ({tp}/{tp + fn})  Exact verdict {exact}/{len(rows)}")

    # ---- cost ----
    fresh = [r for r in records if not r.cached]
    failed = [r for r in records if not r.valid]
    guard_hits = sum(1 for r in records if r.guard_notes)
    tot = lambda attr, rs: sum(getattr(r, attr) for r in rs)  # noqa: E731
    print(
        f"Requests {len(records)} ({len(fresh)} API, {len(records) - len(fresh)} cached), failed {len(failed)}, guard edits {guard_hits}\n"
        f"Tokens (API calls only): in {tot('prompt_tokens', fresh):,}  out {tot('completion_tokens', fresh):,}  "
        f"of which reasoning {tot('reasoning_tokens', fresh):,}\n"
        f"Latency per API request: mean {tot('latency_ms', fresh) / max(len(fresh), 1) / 1000:.1f} s, "
        f"max {max((r.latency_ms for r in fresh), default=0) / 1000:.1f} s | wall time {wall:.0f} s\n"
        f"Results in {out_dir}"
    )
    for r in failed[:5]:
        print(f"  failed sample: {r.error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
