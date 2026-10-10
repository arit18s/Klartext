"""Evaluation runner (plan B12). EVALUATION ONLY: ground truth never feeds the pipeline.

Runs checks + decision on a split (stage outputs reused when model, reasoning, prompts and config match;
--recheck forces a new check run), computes the section 10 metrics plus the keyword-only baseline,
saves data/eval/<run_id>.json (GET /eval/latest shape) and a row in eval_runs, prints a compact report.

  --source script  one script transcript per dialogue (development; unit = dialogue)
  --source asr     the pipeline's own results per recording (data/roles, data/checks, data/decide from
                   process_all.py; unit = recording). Nothing is re-run, so the numbers are what the pipeline decided
  --split holdout  needs --holdout: run once, in B29, with frozen prompts and thresholds (rule 4)

Usage (from backend/): python scripts/evaluate.py --split dev --source script
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.db.config_store import get_active_config  # noqa: E402
from app.eval.align import align  # noqa: E402
from app.eval.ground_truth import load_ground_truth  # noqa: E402
from app.eval.script_parser import parse_script  # noqa: E402
from app.eval.metrics import EvalRow, compute_metrics  # noqa: E402
from app.models.tables import EvalRun  # noqa: E402
from app.models.transcript import Transcript  # noqa: E402
from app.pipeline.check_stage import CheckOutcome, all_records, family_scores, run_check_stage  # noqa: E402
from app.pipeline.decide import DecisionOutput  # noqa: E402
from app.pipeline.keywords import match_keywords  # noqa: E402
from app.pipeline.sources import ScriptTranscriptSource  # noqa: E402
from app.prompts import prompt_version  # noqa: E402

SPLITS = Path(__file__).resolve().parents[1] / "app/eval/splits.json"


def units_for(split: str, source: str) -> list[tuple[str, str, str | None]]:
    """(unit_id, dialogue_id, variant) for the split."""
    splits = json.loads(SPLITS.read_text())
    groups = [g for g in splits["groups"].values() if split == "all" or g["split"] == split]
    if source == "script":
        return [(d, d, None) for g in groups for d in g["dialogues"]]
    units = []
    for g in groups:
        for rec in g["recordings"]:
            dlg, k = rec.rsplit("-", 1)
            units.append((rec, dlg, "clean" if k in ("K1", "K3") else "noisy"))
    return units


def load_transcripts(units, source: str) -> list[Transcript]:
    if source == "script":
        src = ScriptTranscriptSource()
        return [src.load(u) for u, _, _ in units]
    data = get_settings().data_path
    missing = [u for u, _, _ in units if not (data / "decide" / f"{u}.json").exists()]
    if missing:
        raise SystemExit(f"No pipeline decision for {len(missing)} recordings (e.g. {missing[0]}). Run scripts/process_all.py first.")
    return [Transcript.model_validate(json.loads((data / "roles" / f"{u}.json").read_text(encoding="utf-8"))["transcript"]) for u, _, _ in units]


def pipeline_outcomes(units) -> dict:
    """Decisions and checks exactly as the pipeline stored them (no re-run)."""
    data = get_settings().data_path
    out = {}
    for u, _, _ in units:
        o = CheckOutcome.model_validate_json((data / "checks" / f"{u}.json").read_text(encoding="utf-8")) if (data / "checks" / f"{u}.json").exists() else None
        d = DecisionOutput.model_validate(json.loads((data / "decide" / f"{u}.json").read_text(encoding="utf-8")))
        out[u] = (o, d)
    return out


MIN_ALIGN_SIM = 40  # mean alignment similarity below this: evidence overlap "not measurable"


def evidence_hit(unit: str, dlg: str, t: Transcript, verdict: str, expected_turns: list[str]) -> bool | None:
    """Alarm only: does a trigger evidence segment align to an expected evidence turn (Belege)?"""
    if verdict != "alarm":
        return None
    path = get_settings().data_path / "evidence" / f"{unit}.json"
    rows = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    triggers = {r["seg_id"] for r in rows if r["role"] == "trigger"}
    if not triggers:
        return False
    turns = parse_script(get_settings().case_data_path / "Transkript" / f"{dlg}.txt").turns
    al = align(t.segments, turns)
    if al.mean_similarity < MIN_ALIGN_SIM:
        return None
    seg_turn = {s.seg_id: turns[ti].turn_id for s, ti in zip(t.segments, al.turn_index)}
    return any(seg_turn.get(seg) in set(expected_turns) for seg in triggers)


def print_report(run: dict, wall: float, records) -> None:
    m = run["metrics"]
    b, kb = m["binary"], m["keyword_baseline"]
    fmt = lambda x: "–" if x is None else f"{x:.2f}"  # noqa: E731
    print(f"\n{run['run_id']} | split {run['split']} | source {run['source']} | {m['n_calls']} units | config {run['config_versions']}")
    print(f"Precision {fmt(b['precision'])}  Recall {fmt(b['recall'])}  F1 {fmt(b['f1'])}   (tp {b['tp']} fp {b['fp']} fn {b['fn']} tn {b['tn']})")
    print(f"Exact verdict {m['exact']['correct']}/{m['exact']['total']}   Family accuracy {m['family_accuracy']['correct']}/{m['family_accuracy']['total']} (numbers dialogues excluded)")
    print(f"Keyword-only baseline: flags {kb['flagged']}, precision {fmt(kb['precision'])}, recall {fmt(kb['recall'])}")
    print("\nConfusion (rows expected, columns Klartext):")
    print(f"{'':>10}" + "".join(f"{l:>10}" for l in m["confusion"]["labels"]))
    for label, row in zip(m["confusion"]["labels"], m["confusion"]["matrix"]):
        print(f"{label:>10}" + "".join(f"{n:>10}" for n in row))
    pairs = m["stufe2_pairs"]
    print(f"\nStufe2 pairs both right: {sum(p['both_right'] for p in pairs)}/{len(pairs)}   "
          + "  ".join(f"{p['pair'][0][-3:]}+{p['pair'][1][-3:]} {'✓' if p['both_right'] else '✗'}" for p in pairs))
    s3 = m["stufe3_review"]
    print(f"Stufe3 sent to review: {s3['reviewed']}/{s3['total']}")
    cn = m["clean_noisy_agreement"]
    print("Clean vs noisy agreement: " + ("n/a (script source)" if cn is None else f"{cn['agree']}/{cn['total']}"))
    eo = m["evidence_overlap"]
    print("Evidence overlap (alarm trigger on an expected turn): " + ("n/a" if eo is None else f"{eo['hit']}/{eo['measurable']} measurable of {eo['alarms']} alarms"))
    best = max((p for p in m["pr_curve"] if p["recall"] == 1.0), key=lambda p: p["t_review"], default=None)
    if best:
        print(f"PR curve: recall stays 1.00 up to review threshold {best['t_review']} (precision {fmt(best['precision'])})")
    print(f"\nMismatches ({len(m['mismatches'])}):")
    for x in m["mismatches"]:
        print(f"  {x['call_id']:<16} expected {x['expected']:<8} got {x['predicted']:<8} {'caught' if x['caught'] else 'NOT caught' if x['expected'] != 'no_alert' else 'extra flag'}: {(x['reason'] or '')[:110]}")
    fresh = [r for r in records if not r.cached]
    print(f"\nLLM requests {len(records)} ({len(fresh)} API), tokens in {sum(r.prompt_tokens for r in fresh):,} out {sum(r.completion_tokens for r in fresh):,}, wall {wall:.0f} s")


def main() -> int:
    s = get_settings()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", choices=["dev", "holdout", "all"], required=True)
    ap.add_argument("--source", choices=["script", "asr"], required=True)
    ap.add_argument("--holdout", action="store_true", help="Confirm a holdout run (B29 only, frozen config)")
    ap.add_argument("--recheck", action="store_true", help="Run the checks again instead of reusing stage outputs")
    ap.add_argument("--reasoning", choices=["on", "off"], default=s.llm_reasoning)
    args = ap.parse_args()
    if args.split in ("holdout", "all") and not args.holdout:
        print(f"Split '{args.split}' contains holdout dialogues. Holdout runs once in B29 with frozen prompts and thresholds; pass --holdout to confirm.")
        return 2
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    families, thresholds, keywords = get_active_config("families"), get_active_config("thresholds"), get_active_config("keywords")
    units = units_for(args.split, args.source)
    transcripts = load_transcripts(units, args.source)
    out_dir = s.data_path / ("checks_script" if args.source == "script" else "checks") / f"reasoning-{args.reasoning}"

    started = time.monotonic()
    if args.source == "script":
        outcomes = run_check_stage(transcripts, out_dir, families, thresholds.data, s.llm_model, s.llm_samples,
                                   args.reasoning == "on", s.llm_concurrency, recheck=args.recheck)
        pairs = {u: (o.checks, o.decision) for u, o in outcomes.items()}
    else:
        outcomes = {}
        pairs = {u: (o.checks if o else None, d) for u, (o, d) in pipeline_outcomes(units).items()}
    wall = time.monotonic() - started

    gt = load_ground_truth()
    rows = []
    for (unit, dlg, variant), t in zip(units, transcripts):
        checks, decision = pairs[unit]
        g = gt[dlg]
        rows.append(EvalRow(
            unit_id=unit, dialogue_id=dlg, level=g.level, variant=variant,
            expected_verdict=g.verdict, expected_family=g.family,
            predicted_verdict=decision.verdict, predicted_family=decision.family, score=decision.score,
            reason=decision.reason, families=family_scores(checks) if checks else [],
            keyword_flagged=bool(match_keywords(t, keywords.data)),
            evidence_hit=evidence_hit(unit, dlg, t, decision.verdict, g.evidence_turns) if args.source == "asr" else None,
        ))

    now = datetime.now(timezone.utc)
    run_id = f"eval-{now:%Y%m%d-%H%M%S}-{args.split}-{args.source}"
    run = {
        "run_id": run_id, "split": args.split, "source": args.source,
        "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "config_versions": {"keywords": keywords.version_id, "families": families.version_id, "thresholds": thresholds.version_id, "model": None},
        "metrics": compute_metrics(rows, thresholds.data["alarm"], s.llm_samples),
    }
    snapshot = {"model": s.llm_model, "reasoning": args.reasoning, "samples": s.llm_samples, "prompt_version": prompt_version(),
                "thresholds": thresholds.data, "unit": "dialogue" if args.source == "script" else "recording"}
    eval_dir = s.data_path / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)
    (eval_dir / f"{run_id}.json").write_text(json.dumps(run | {"snapshot": snapshot}, indent=2, ensure_ascii=False), encoding="utf-8")
    with Session(get_engine()) as session:
        session.add(EvalRun(split=args.split, config_snapshot_json=json.dumps(run["config_versions"] | snapshot), metrics_json=json.dumps(run["metrics"])))
        session.commit()

    print_report(run, wall, all_records(outcomes))
    print(f"Saved {eval_dir / (run_id + '.json')} and an eval_runs row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
