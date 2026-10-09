"""Decision rule: the single source of truth (05_BACKEND_STRUCTURE.md section 5).

Mirrored exactly in frontend/src/lib/decide.ts. Change both together; shared/decision_cases.json must pass in both.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Verdict = Literal["alarm", "review", "no_alert"]

# Fixed family order: breaks ties for the top score and for the needs_human branch, whatever the input order.
FAMILY_ORDER = ["trade", "splitting", "access", "disclosure", "documentation"]

NO_CHECKS_REASON = "No checks enabled."
NO_CHECKS_REASON_DE = "Keine Prüfungen aktiviert."
FAILED_REASON = "A check could not complete. Needs a human."
FAILED_REASON_DE = "Eine Prüfung konnte nicht abgeschlossen werden. Braucht einen Menschen."
ASR_REASON = "Transcription unclear at the key passage."
ASR_REASON_DE = "Die Transkription ist an der entscheidenden Stelle unklar."


class FamilyScore(BaseModel):
    family: str
    score: float | None  # None when failed
    failed: bool = False
    needs_human_votes: int = 0
    open_question: str | None = None
    reason: str | None = None
    reason_de: str | None = None


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
    reason_de: str | None
    open_question: str | None
    rule: str  # which branch fired, for traceability


def _order(family: str) -> int:
    return FAMILY_ORDER.index(family) if family in FAMILY_ORDER else len(FAMILY_ORDER)


def _with_failed_notes(text: str | None, failed: list[FamilyScore], de: bool) -> str:
    notes = [
        f"Hinweis: Die Prüfung {f.family} konnte nicht abgeschlossen werden." if de
        else f"Note: the {f.family} check could not complete."
        for f in failed
    ]
    return " ".join([text] + notes if text else notes)


def decide(inp: DecisionInput) -> DecisionOutput:
    families = sorted(inp.families, key=lambda f: _order(f.family))  # stable: unknown families keep input order
    if not families:
        return DecisionOutput(verdict="review", family=None, score=0.0, reason=NO_CHECKS_REASON, reason_de=NO_CHECKS_REASON_DE, open_question=None, rule="no_checks")

    failed = [f for f in families if f.failed or f.score is None]
    scored = [f for f in families if not (f.failed or f.score is None)]
    top = max(scored, key=lambda f: f.score, default=None)  # max() keeps the first of equal scores: fixed order wins
    s = top.score if top else 0.0
    fam = top.family if top else None

    if top and s >= inp.t_alarm:
        reason, reason_de = top.reason, top.reason_de
        if failed:
            reason, reason_de = _with_failed_notes(reason, failed, de=False), _with_failed_notes(reason_de, failed, de=True)
        return DecisionOutput(verdict="alarm", family=fam, score=s, reason=reason, reason_de=reason_de, open_question=None, rule="score_alarm")
    if failed:
        return DecisionOutput(verdict="review", family=failed[0].family, score=s, reason=FAILED_REASON, reason_de=FAILED_REASON_DE, open_question=None, rule="family_failed")
    if top and s >= inp.t_review:
        return DecisionOutput(verdict="review", family=fam, score=s, reason=top.reason, reason_de=top.reason_de, open_question=top.open_question, rule="score_review")
    human = next((f for f in families if f.needs_human_votes > inp.samples / 2), None)
    if human:
        return DecisionOutput(verdict="review", family=human.family, score=s, reason=human.reason, reason_de=human.reason_de, open_question=human.open_question, rule="needs_human")
    if inp.asr_uncertain and s >= inp.t_review / 2:
        return DecisionOutput(verdict="review", family=fam, score=s, reason=ASR_REASON, reason_de=ASR_REASON_DE, open_question=None, rule="asr_uncertain")
    return DecisionOutput(verdict="no_alert", family=fam, score=s, reason=top.reason if top else None, reason_de=top.reason_de if top else None, open_question=None, rule="no_alert")
