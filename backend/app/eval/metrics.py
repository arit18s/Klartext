"""Evaluation metrics (05_BACKEND_STRUCTURE.md section 10), in the GET /eval/latest shape of API_CONTRACT.md.

EVALUATION ONLY. Binary scoring as agreed with the case partners: flagged = alarm or review,
positive = expected alarm or review (a fraud call sent to review counts as caught).
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from pydantic import BaseModel

from app.pipeline.decide import DecisionInput, FamilyScore, decide

LABELS = ["alarm", "review", "no_alert"]


class EvalRow(BaseModel):
    unit_id: str  # recording (asr) or dialogue (script)
    dialogue_id: str
    level: int | None
    variant: str | None  # clean / noisy / None for script source
    expected_verdict: str
    expected_family: str
    predicted_verdict: str
    predicted_family: str | None
    score: float
    reason: str | None
    families: list[FamilyScore]  # for the PR curve
    keyword_flagged: bool  # keyword-only baseline
    evidence_hit: bool | None = None  # alarm trigger on an expected evidence turn; None = not measurable / no alarm


def _flag(v: str) -> bool:
    return v in ("alarm", "review")


def binary(pairs: list[tuple[bool, bool]]) -> dict[str, Any]:
    """pairs = (positive, flagged)."""
    tp = sum(1 for p, f in pairs if p and f)
    fp = sum(1 for p, f in pairs if not p and f)
    fn = sum(1 for p, f in pairs if p and not f)
    tn = sum(1 for p, f in pairs if not p and not f)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision is not None and recall is not None else None)
    r = lambda x: None if x is None else round(x, 3)  # noqa: E731
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": r(precision), "recall": r(recall), "f1": r(f1)}


def _breakdown(rows: list[EvalRow], group: str, key_fn) -> list[dict[str, Any]]:
    buckets: dict[str, list[EvalRow]] = defaultdict(list)
    for row in rows:
        k = key_fn(row)
        if k is not None:
            buckets[str(k)].append(row)
    out = []
    for key in sorted(buckets):
        b = binary([(_flag(r.expected_verdict), _flag(r.predicted_verdict)) for r in buckets[key]])
        out.append({"group": group, "key": key, "calls": len(buckets[key]), "cases": b["tp"] + b["fn"],
                    "recall": b["recall"], "precision": b["precision"], "note": None})
    return out


def _stufe2_pairs(rows: list[EvalRow]) -> list[dict[str, Any]]:
    """Measured on clean audio (script source: the dialogue itself). Fraud side first."""
    by_dlg = {r.dialogue_id: r for r in rows if r.level == 2 and r.variant in ("clean", None)}
    pairs = []
    for did in sorted(by_dlg):
        m = re.match(r"Stufe2_C(\d{2})$", did)
        if not m or int(m.group(1)) % 2 == 0:
            continue
        other = f"Stufe2_C{int(m.group(1)) + 1:02d}"
        if other not in by_dlg:
            continue
        a, b = by_dlg[did], by_dlg[other]
        fraud, harmless = (b, a) if _flag(b.expected_verdict) and not _flag(a.expected_verdict) else (a, b)
        both_right = all(_flag(x.expected_verdict) == _flag(x.predicted_verdict) for x in (a, b))
        pairs.append({"pair": [fraud.dialogue_id, harmless.dialogue_id], "family": a.expected_family,
                      "fraud_side": fraud.predicted_verdict, "harmless_side": harmless.predicted_verdict, "both_right": both_right})
    return pairs


def _clean_noisy(rows: list[EvalRow]) -> dict[str, int] | None:
    by: dict[str, dict[str, str]] = defaultdict(dict)
    for r in rows:
        if r.variant:
            by[r.dialogue_id][r.variant] = r.predicted_verdict
    both = [v for v in by.values() if "clean" in v and "noisy" in v]
    if not both:
        return None
    return {"agree": sum(1 for v in both if v["clean"] == v["noisy"]), "total": len(both)}


def _pr_curve(rows: list[EvalRow], t_alarm: float, k: int) -> list[dict[str, Any]]:
    curve = []
    for t in range(0, 101):
        pairs = []
        for r in rows:
            d = decide(DecisionInput(families=r.families, t_review=t, t_alarm=max(t_alarm, t), samples=k))
            pairs.append((_flag(r.expected_verdict), _flag(d.verdict)))
        b = binary(pairs)
        curve.append({"t_review": t, "precision": b["precision"], "recall": b["recall"]})
    return curve


def _evidence_overlap(rows: list[EvalRow]) -> dict[str, int] | None:
    alarms = [r for r in rows if r.predicted_verdict == "alarm"]
    measurable = [r for r in alarms if r.evidence_hit is not None]
    if not measurable:
        return None
    return {"hit": sum(1 for r in measurable if r.evidence_hit), "measurable": len(measurable), "alarms": len(alarms)}


def compute_metrics(rows: list[EvalRow], t_alarm: float, k: int) -> dict[str, Any]:
    confusion = [[sum(1 for r in rows if r.expected_verdict == e and r.predicted_verdict == p) for p in LABELS] for e in LABELS]
    exact = sum(1 for r in rows if r.expected_verdict == r.predicted_verdict)
    stufe3 = [r for r in rows if r.level == 3]
    fam_rows = [r for r in rows if _flag(r.expected_verdict) and _flag(r.predicted_verdict) and r.expected_family != "numbers"]
    kb = binary([(_flag(r.expected_verdict), r.keyword_flagged) for r in rows])
    kb["flagged"] = sum(1 for r in rows if r.keyword_flagged)
    return {
        "n_calls": len(rows),
        "binary": binary([(_flag(r.expected_verdict), _flag(r.predicted_verdict)) for r in rows]),
        "exact": {"correct": exact, "total": len(rows), "accuracy": round(exact / len(rows), 3) if rows else None},
        "confusion": {"labels": LABELS, "matrix": confusion},
        "breakdown": (
            _breakdown(rows, "level", lambda r: r.level)
            + _breakdown(rows, "family", lambda r: r.expected_family)
            + _breakdown(rows, "variant", lambda r: r.variant)
        ),
        "stufe2_pairs": _stufe2_pairs(rows),
        "stufe3_review": {"reviewed": sum(1 for r in stufe3 if r.predicted_verdict == "review"), "total": len(stufe3)},
        "clean_noisy_agreement": _clean_noisy(rows),
        "evidence_overlap": _evidence_overlap(rows),
        "family_accuracy": {"correct": sum(1 for r in fam_rows if r.predicted_family == r.expected_family), "total": len(fam_rows)},
        "pr_curve": _pr_curve(rows, t_alarm, k),
        "keyword_baseline": kb,
        "mismatches": [
            {"call_id": r.unit_id, "expected": r.expected_verdict, "predicted": r.predicted_verdict,
             "caught": _flag(r.expected_verdict) and _flag(r.predicted_verdict), "reason": r.reason}
            for r in rows if r.expected_verdict != r.predicted_verdict
        ],
    }
