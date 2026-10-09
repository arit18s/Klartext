"""Decision rule: the single source of truth (05_BACKEND_STRUCTURE.md section 5).

Mirrored exactly in frontend/src/lib/decide.ts. Change both together; decision_cases.json must pass in both.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Verdict = Literal["alarm", "review", "no_alert"]

FAILED_REASON = "A check could not complete. Needs a human."
ASR_REASON = "Transcription unclear at the key passage."


class FamilyScore(BaseModel):
    family: str
    score: float | None  # None when failed
    failed: bool = False
    needs_human_votes: int = 0
    open_question: str | None = None
    reason: str | None = None


class DecisionInput(BaseModel):
    families: list[FamilyScore]  # enabled families only, helper excluded
    t_review: float = 30
    t_alarm: float = 70
    samples: int = 3  # k
    asr_uncertain: bool = False


class DecisionOutput(BaseModel):
    verdict: Verdict
    family: str | None
    score: float
    reason: str | None
    open_question: str | None
    rule: str  # which branch fired, for traceability


def decide(inp: DecisionInput) -> DecisionOutput:
    scored = [f for f in inp.families if not f.failed and f.score is not None]
    top = max(scored, key=lambda f: f.score, default=None)  # first max wins ties: input order is stable
    s = top.score if top else 0.0
    fam = top.family if top else None

    failed = next((f for f in inp.families if f.failed or f.score is None), None)
    if failed:
        return DecisionOutput(verdict="review", family=failed.family, score=s, reason=FAILED_REASON, open_question=None, rule="family_failed")
    if top and s >= inp.t_alarm:
        return DecisionOutput(verdict="alarm", family=fam, score=s, reason=top.reason, open_question=None, rule="score_alarm")
    if top and s >= inp.t_review:
        return DecisionOutput(verdict="review", family=fam, score=s, reason=top.reason, open_question=top.open_question, rule="score_review")
    human = next((f for f in inp.families if f.needs_human_votes > inp.samples / 2), None)
    if human:
        return DecisionOutput(verdict="review", family=human.family, score=s, reason=human.reason, open_question=human.open_question, rule="needs_human")
    if inp.asr_uncertain and s >= inp.t_review / 2:
        return DecisionOutput(verdict="review", family=fam, score=s, reason=ASR_REASON, open_question=None, rule="asr_uncertain")
    return DecisionOutput(verdict="no_alert", family=fam, score=s, reason=top.reason if top else None, open_question=None, rule="no_alert")
