"""Check stage + decision for a batch of transcripts, with stage outputs on disk.

Writes <out_dir>/<call_id>.json = {"checks": CallChecks, "decision": DecisionOutput}. An existing file is
reused when model, reasoning, prompt version and families config version all match (unless recheck=True);
otherwise the checks run again (the LLM cache still skips unchanged prompts).
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pydantic import BaseModel

from app.db.config_store import ActiveConfig
from app.models.checks import SampleRecord
from app.models.transcript import Transcript
from app.pipeline.checks import CallChecks, run_checks_many, run_numbers_many
from app.pipeline.decide import FAMILY_ORDER, DecisionInput, DecisionOutput, FamilyScore, decide
from app.prompts import prompt_version


class CheckOutcome(BaseModel):
    checks: CallChecks
    decision: DecisionOutput
    reused: bool = False
    numbers_record: SampleRecord | None = None


def family_scores(cc: CallChecks) -> list[FamilyScore]:
    return [
        FamilyScore(family=f, score=r.score, failed=r.failed, needs_human_votes=r.needs_human_votes,
                    open_question=r.open_question, reason=r.reason, reason_de=r.reason_de)
        for f, r in sorted(cc.families.items(), key=lambda kv: FAMILY_ORDER.index(kv[0]) if kv[0] in FAMILY_ORDER else 99)
    ]


def decision_for(cc: CallChecks, thresholds: dict, k: int, asr_uncertain: bool = False) -> DecisionOutput:
    return decide(DecisionInput(families=family_scores(cc), t_review=thresholds["review"], t_alarm=thresholds["alarm"], samples=k, asr_uncertain=asr_uncertain))


def _load_reusable(path: Path, model: str, reasoning: bool, families_version: int | None) -> CallChecks | None:
    if not path.exists():
        return None
    try:
        cc = CallChecks.model_validate(json.loads(path.read_text(encoding="utf-8"))["checks"])
    except (ValueError, KeyError):
        return None
    same = (cc.model, cc.reasoning, cc.prompt_version, cc.families_version_id) == (model, reasoning, prompt_version(), families_version)
    return cc if same else None


def run_check_stage(
    transcripts: list[Transcript],
    out_dir: Path,
    families: ActiveConfig,
    thresholds: dict,
    model: str,
    k: int,
    reasoning: bool,
    concurrency: int,
    keyword_hints: dict[str, str] | None = None,
    recheck: bool = False,
) -> dict[str, CheckOutcome]:
    out_dir.mkdir(parents=True, exist_ok=True)
    outcomes: dict[str, CheckOutcome] = {}
    todo: list[Transcript] = []
    for t in transcripts:
        cc = None if recheck else _load_reusable(out_dir / f"{t.call_id}.json", model, reasoning, families.version_id)
        if cc:
            outcomes[t.call_id] = CheckOutcome(checks=cc, decision=decision_for(cc, thresholds, k), reused=True)
        else:
            todo.append(t)

    if todo:
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            numbers = run_numbers_many(todo, ex, reasoning)
            results = run_checks_many(todo, numbers, families.data, ex, k, reasoning, model, families.version_id, keyword_hints)
        for t in todo:
            cc = results[t.call_id]
            d = decision_for(cc, thresholds, k)
            (out_dir / f"{t.call_id}.json").write_text(
                json.dumps({"checks": cc.model_dump(), "decision": d.model_dump()}, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            outcomes[t.call_id] = CheckOutcome(checks=cc, decision=d, numbers_record=numbers[t.call_id].record)
    return {t.call_id: outcomes[t.call_id] for t in transcripts}


def all_records(outcomes: dict[str, CheckOutcome]) -> list[SampleRecord]:
    """Every LLM request behind these outcomes (fresh runs only include the numbers helper)."""
    recs = [o.numbers_record for o in outcomes.values() if o.numbers_record and not o.reused]
    return recs + [r for o in outcomes.values() if not o.reused for fr in o.checks.families.values() for r in fr.samples]
