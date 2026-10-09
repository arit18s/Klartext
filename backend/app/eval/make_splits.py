"""Create the fixed dev / holdout split (05_BACKEND_STRUCTURE.md section 10, plan B7).

EVALUATION ONLY. Groups: each Stufe1 dialogue, each Stufe2 pair (C01+C02, C03+C04, ...),
each Stufe3 dialogue; both recordings of a script always stay together.
Holdout = 3 Stufe1 + 3 Stufe2 pairs + 1 Stufe3 group, stratified by family:
  - Stufe1 picks have distinct families and include an alarm and a no_alert
  - Stufe2 picks have distinct families
  - holdout contains an access case and a splitting case (alarm or review)
  - dev keeps at least one case for every verdict family, so every check can be tuned
  - demo and B10 test groups stay in dev (DEMO_DEV_GROUPS): C09+C10 (twin pair), C17 (review), C18 (absent but review)
All valid holdouts are enumerated and one is picked with a fixed seed.

Run from backend/: python -m app.eval.make_splits   (writes app/eval/splits.json)
"""

from __future__ import annotations

import itertools
import json
import random
import re
from pathlib import Path

from app.config import get_settings
from app.eval.ground_truth import GroundTruth, load_ground_truth

SEED = 20261009
VERDICT_FAMILIES = ["trade", "splitting", "access", "disclosure", "documentation"]
SPLITS_PATH = Path(__file__).with_name("splits.json")
DEMO_DEV_GROUPS = {"Stufe2_C09+C10", "Stufe3_C17", "Stufe3_C18"}  # demo + B10 test cases, so never holdout


def build_groups(gt: dict[str, GroundTruth]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for did in sorted(gt):
        m = re.match(r"Stufe2_C(\d{2})$", did)
        if m:
            n = int(m.group(1))
            first = n if n % 2 == 1 else n - 1
            gid = f"Stufe2_C{first:02d}+C{first + 1:02d}"
        else:
            gid = did
        groups.setdefault(gid, []).append(did)
    return groups


def group_family(gt: dict[str, GroundTruth], members: list[str]) -> str:
    families = {gt[d].family for d in members}
    assert len(families) == 1, f"Group {members} mixes families {families}"
    return families.pop()


def cases(gt: dict[str, GroundTruth], dialogue_ids: list[str]) -> set[str]:
    return {gt[d].family for d in dialogue_ids if gt[d].is_positive}


def is_valid(gt: dict[str, GroundTruth], groups: dict[str, list[str]], s1: tuple, s2: tuple, s3: tuple) -> bool:
    if DEMO_DEV_GROUPS & set(s1 + s2 + s3):
        return False
    s1_fams = [group_family(gt, groups[g]) for g in s1]
    s2_fams = [group_family(gt, groups[g]) for g in s2]
    if len(set(s1_fams)) != len(s1_fams) or len(set(s2_fams)) != len(s2_fams):
        return False
    s1_verdicts = {gt[groups[g][0]].verdict for g in s1}
    if not {"alarm", "no_alert"} <= s1_verdicts:
        return False
    holdout = [d for g in s1 + s2 + s3 for d in groups[g]]
    if not {"access", "splitting"} <= cases(gt, holdout):
        return False
    dev = [d for d in gt if d not in holdout]
    return set(VERDICT_FAMILIES) <= cases(gt, dev)


def recordings(dialogue_id: str) -> list[str]:
    audio = get_settings().case_data_path / "Audio"
    return sorted(p.stem for p in audio.glob(f"{dialogue_id}-K*.wav"))


def main() -> None:
    gt = load_ground_truth()
    groups = build_groups(gt)
    by_level = {lvl: sorted(g for g in groups if g.startswith(f"Stufe{lvl}_")) for lvl in (1, 2, 3)}

    valid = [
        (s1, s2, s3)
        for s1 in itertools.combinations(by_level[1], 3)
        for s2 in itertools.combinations(by_level[2], 3)
        for s3 in itertools.combinations(by_level[3], 1)
        if is_valid(gt, groups, s1, s2, s3)
    ]
    s1, s2, s3 = random.Random(SEED).choice(valid)
    holdout_groups = sorted(s1 + s2 + s3)

    out = {
        "note": "Fixed split. Tune prompts and thresholds on dev only. Never tune on holdout.",
        "seed": SEED,
        "valid_candidates": len(valid),
        "groups": {
            gid: {
                "split": "holdout" if gid in holdout_groups else "dev",
                "family": group_family(gt, members),
                "dialogues": members,
                "verdicts": [gt[d].verdict for d in members],
                "recordings": [r for d in members for r in recordings(d)],
            }
            for gid, members in groups.items()
        },
    }
    for split in ("dev", "holdout"):
        out[split] = sorted(d for g in out["groups"].values() if g["split"] == split for d in g["dialogues"])
    SPLITS_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {SPLITS_PATH} ({len(valid)} valid holdout choices, seed {SEED})")


if __name__ == "__main__":
    main()
