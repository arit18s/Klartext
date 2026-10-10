"""Family checks (05_BACKEND_STRUCTURE.md section 4).

Two phases, both parallel on one shared executor (LLM_CONCURRENCY):
  1. numbers helper, once per call: classifies number objects, feeds the family checks
  2. every enabled family x k samples
Each sample passes the hallucination guard; k samples aggregate into a FamilyResult.
"""

from __future__ import annotations

import re
from collections import Counter
from concurrent.futures import Executor
from typing import Any

from pydantic import BaseModel
from rapidfuzz import fuzz

from app.models.checks import EVENT_VALUE, CheckSample, FamilyResult, NumbersOutput, SampleRecord
from app.models.transcript import Transcript
from app.prompts import FAMILY_NAMES, family_guidance, load, prompt_version, render
from app.services.llm_client import LLMResult, complete_json

QUOTE_MIN_RATIO = 80
NO_EVIDENCE_QUESTION = "Evidence could not be located in the transcript."


class NumbersRun(BaseModel):
    output: NumbersOutput | None
    record: SampleRecord  # cost and status of the helper call


class CallChecks(BaseModel):
    call_id: str
    source: str
    model: str
    reasoning: bool
    prompt_version: str
    families_version_id: int | None
    numbers: NumbersOutput | None
    families: dict[str, FamilyResult]


# ---------- formatting ----------

def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"


def format_transcript(t: Transcript) -> str:
    return "\n".join(f"[{s.seg_id} {_mmss(s.start_s)} {s.role or 'unknown'}] {s.text}" for s in t.segments)


def format_numbers(numbers: NumbersOutput | None) -> str:
    if numbers is None:
        return "not available (helper failed)"
    if not numbers.numbers:
        return "none"
    return "; ".join(f"{n.seg_id}: {n.value} = {n.kind}, {n.status} ({n.note})" for n in numbers.numbers)


def _record(idx: int, r: LLMResult, sample: CheckSample | None = None, notes: list[str] | None = None) -> SampleRecord:
    """valid = the model gave a usable answer (for family checks: a sample that passed validation)."""
    return SampleRecord(
        sample_idx=idx, valid=r.ok, sample=sample, guard_notes=notes or [],
        error=r.error, cached=r.cached, latency_ms=r.latency_ms, prompt_tokens=r.prompt_tokens,
        completion_tokens=r.completion_tokens, reasoning_tokens=r.reasoning_tokens,
    )


# ---------- hallucination guard ----------

def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[«»\"'„“”.,;:!?…]", " ", text.casefold())).strip()


def guard(sample: CheckSample, t: Transcript) -> tuple[CheckSample, list[str]]:
    """Drop evidence that points nowhere; downgrade unsupported 'present' to 'undetermined'."""
    segs = {s.seg_id: s.text for s in t.segments}
    notes: list[str] = []
    kept = []
    for ev in sample.evidence:
        if ev.seg_id not in segs:
            notes.append(f"dropped evidence: unknown {ev.seg_id}")
        elif fuzz.partial_ratio(_norm(ev.quote), _norm(segs[ev.seg_id])) < QUOTE_MIN_RATIO:
            notes.append(f"dropped evidence: quote not in {ev.seg_id}")
        else:
            kept.append(ev)
    judgements = [k for k in sample.keyword_judgements if k.seg_id in segs]
    update: dict[str, Any] = {"evidence": kept, "keyword_judgements": judgements}
    if sample.event == "present" and not any(e.role == "trigger" for e in kept):
        notes.append("present without valid trigger: downgraded to undetermined")
        update |= {"event": "undetermined", "open_question": NO_EVIDENCE_QUESTION}
    return sample.model_copy(update=update), notes


# ---------- aggregation ----------

def aggregate(family: str, records: list[SampleRecord]) -> FamilyResult:
    valid = [r.sample for r in records if r.valid and r.sample]
    base: dict[str, Any] = {"family": family, "samples": records, "valid_samples": len(valid)}
    if not valid:
        return FamilyResult(
            **base, score=None, event_majority="failed", agreement=None, agreement_text=f"0 of {len(records)}",
            needs_human_votes=0, open_question=None, reason="A check could not complete. Needs a human.",
            reason_de="Eine Prüfung konnte nicht abgeschlossen werden. Braucht einen Menschen.",
            benign_explanation=None, evidence=[],
        )
    counts = Counter(s.event for s in valid).most_common()
    top = counts[0][1]
    majority = counts[0][0] if sum(1 for _, n in counts if n == top) == 1 else "undetermined"
    agree = sum(1 for s in valid if s.event == majority)
    chosen = next((s for s in valid if s.event == majority), valid[0])
    return FamilyResult(
        **base,
        score=round(100 * sum(EVENT_VALUE[s.event] for s in valid) / len(valid), 1),
        event_majority=majority,
        agreement=round(agree / len(valid), 3),
        agreement_text=f"{agree} of {len(valid)}",
        needs_human_votes=sum(1 for s in valid if s.needs_human),
        open_question=chosen.open_question,
        reason=chosen.reason,
        reason_de=chosen.reason_de,
        benign_explanation=chosen.benign_explanation,
        evidence=chosen.evidence,
    )


# ---------- running ----------

def _numbers_job(t: Transcript, reasoning: bool) -> NumbersRun:
    user = f"Transcript (segment id, time, speaker role, text):\n<transcript>\n{format_transcript(t)}\n</transcript>"
    r = complete_json(load("numbers_system.md"), user, NumbersOutput, temperature=0.0, reasoning=reasoning)
    return NumbersRun(output=r.value if r.ok else None, record=_record(0, r))


def _family_user_prompt(family: str, cfg: dict[str, Any], t: Transcript, numbers: NumbersOutput | None, keyword_hints: str) -> str:
    return render(
        "check_user.md",
        family_name=FAMILY_NAMES.get(family, family),
        rule=cfg.get("rule") or "(none configured)",
        harmless=cfg.get("harmless") or "(none configured, see guidance)",
        family_guidance=family_guidance(family),
        keyword_hints=keyword_hints,
        numbers=format_numbers(numbers),
        transcript=format_transcript(t),
    )


def _sample_job(user: str, t: Transcript, idx: int, reasoning: bool) -> SampleRecord:
    r = complete_json(load("system.md"), user, CheckSample, reasoning=reasoning, sample_idx=idx)
    if not r.ok or r.value is None:
        return _record(idx, r)
    sample, notes = guard(r.value, t)
    return _record(idx, r, sample, notes)


def run_numbers_many(transcripts: list[Transcript], executor: Executor, reasoning: bool) -> dict[str, NumbersRun]:
    futures = {t.call_id: executor.submit(_numbers_job, t, reasoning) for t in transcripts}
    return {cid: f.result() for cid, f in futures.items()}


def run_checks_many(
    transcripts: list[Transcript],
    numbers: dict[str, NumbersRun],
    families_cfg: dict[str, Any],
    executor: Executor,
    k: int,
    reasoning: bool,
    model: str,
    families_version_id: int | None = None,
    keyword_hints: dict[str, str] | None = None,
    sample_offset: int = 0,
) -> dict[str, CallChecks]:
    """sample_offset shifts sample indices (cache keys), so a repeat run draws new, independent samples."""
    enabled = [f for f, c in families_cfg.items() if c.get("enabled") and not c.get("helper")]
    futures: dict[tuple[str, str], list] = {}
    for t in transcripts:
        nums = numbers[t.call_id].output if t.call_id in numbers else None
        for fam in enabled:
            user = _family_user_prompt(fam, families_cfg[fam], t, nums, (keyword_hints or {}).get(t.call_id, "none"))
            futures[(t.call_id, fam)] = [executor.submit(_sample_job, user, t, sample_offset + i, reasoning) for i in range(k)]

    out: dict[str, CallChecks] = {}
    for t in transcripts:
        out[t.call_id] = CallChecks(
            call_id=t.call_id, source=t.source, model=model, reasoning=reasoning, prompt_version=prompt_version(),
            families_version_id=families_version_id,
            numbers=numbers[t.call_id].output if t.call_id in numbers else None,
            families={fam: aggregate(fam, [f.result() for f in futures[(t.call_id, fam)]]) for fam in enabled},
        )
    return out
