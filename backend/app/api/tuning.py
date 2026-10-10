"""GET /scores/suggestion: thresholds suggested from officer feedback (stretch goal R11).

Reads the latest verdict-type feedback per call (notes are ignored), re-decides every labelled call with the decision
rule (app/pipeline/decide.py) over a grid of thresholds and suggests the pair that fits the feedback best:
fewest misses first (D4), then fewest false alarms, extra reviews, unmet escalations, verdicts that change although
they were marked correct, and finally the smallest move from the active thresholds. Only suggests; never saves.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.common import PlainErrorRoute, active_config
from app.config import get_settings
from app.db import get_session
from app.models.tables import CheckResult, Decision, Feedback
from app.pipeline.decide import FAMILY_ORDER, DecisionInput, FamilyScore, decide

router = APIRouter(tags=["scores"], route_class=PlainErrorRoute)  # mounted under /api by scores.router
SessionDep = Annotated[Session, Depends(get_session)]

STEP = 5
VERDICT_LABELS = ("correct", "false_alarm", "missed", "escalated_to_alarm", "closed_no_alert")
Want = Literal["harmless", "flagged", "alarm", "keep"]
WANT: dict[str, Want] = {"false_alarm": "harmless", "closed_no_alert": "harmless", "missed": "flagged",
                         "escalated_to_alarm": "alarm", "correct": "keep"}


class Effect(BaseModel):
    """Errors against the feedback on the labelled calls, plus how many of all decided calls are flagged."""

    missed: int = 0  # marked real (missed, escalated, correct alarm/review) but no alert
    false_alarms: int = 0  # marked harmless (false alarm, closed, correct no alert) but alarm
    extra_reviews: int = 0  # marked harmless but review
    unmet_escalations: int = 0  # escalated to alarm but still review
    changed_confirmed: int = 0  # marked correct, verdict would change (still caught)
    flagged: int = 0  # alarm or review among all decided calls


class Thresholds(BaseModel):
    review: float
    alarm: float


class SuggestionOut(BaseModel):
    current: Thresholds
    thresholds_version_id: int
    labelled_calls: int
    labels: dict[str, int]
    suggestion: Thresholds | None
    current_effect: Effect
    suggested_effect: Effect | None
    summary: str  # one sentence for the Tuning page


class _Call(BaseModel):
    call_id: str
    verdict: str  # as decided now
    asr_uncertain: bool
    families: list[FamilyScore]
    want: Want | None


def _latest_labels(session: Session) -> dict[str, str]:
    """Latest verdict-type feedback per call; plain notes say nothing about the verdict."""
    labels: dict[str, str] = {}
    for fb in session.exec(select(Feedback).order_by(Feedback.created_at, Feedback.id)):
        if fb.label in VERDICT_LABELS:
            labels[fb.call_id] = fb.label
    return labels


def _calls(session: Session, enabled: set[str]) -> list[_Call]:
    labels = _latest_labels(session)
    results: dict[str, list[CheckResult]] = {}
    for r in session.exec(select(CheckResult)):
        if r.family in enabled:
            results.setdefault(r.call_id, []).append(r)
    return [
        _Call(call_id=d.call_id, verdict=d.verdict, asr_uncertain=d.asr_uncertain,
              want=WANT.get(labels.get(d.call_id, "")),
              families=[FamilyScore(family=r.family, score=r.score, failed=r.event_majority == "failed",
                                    needs_human_votes=r.needs_human_votes) for r in results.get(d.call_id, [])])
        for d in session.exec(select(Decision))
    ]


def _effect(calls: list[_Call], review: float, alarm: float, k: int) -> Effect:
    e = Effect()
    for c in calls:
        v = decide(DecisionInput(families=c.families, t_review=review, t_alarm=alarm, samples=k, asr_uncertain=c.asr_uncertain)).verdict
        e.flagged += v != "no_alert"
        want = c.want
        if want == "keep":
            want = "harmless" if c.verdict == "no_alert" else "keep"
        if want == "harmless":
            e.false_alarms += v == "alarm"
            e.extra_reviews += v == "review"
        elif want in ("flagged", "alarm", "keep"):
            if v == "no_alert":
                e.missed += 1
            elif want == "alarm" and v != "alarm":
                e.unmet_escalations += 1
            elif want == "keep" and v != c.verdict:
                e.changed_confirmed += 1
    return e


def _errors(e: Effect) -> tuple[int, ...]:
    return (e.missed, e.false_alarms, e.extra_reviews, e.unmet_escalations, e.changed_confirmed)


def _n(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _summary(cur: Effect, new: Effect) -> str:
    parts = []
    if (d := cur.false_alarms - new.false_alarms) > 0:
        parts.append(f"avoid {_n(d, 'false alarm', 'false alarms')}")
    if (d := cur.extra_reviews - new.extra_reviews) > 0:
        parts.append(f"avoid {_n(d, 'extra review', 'extra reviews')}")
    if (d := cur.unmet_escalations - new.unmet_escalations) > 0:
        parts.append(f"raise {_n(d, 'escalated call', 'escalated calls')} to alarm")
    if (d := cur.missed - new.missed) > 0:
        parts.append(f"catch {_n(d, 'missed call', 'missed calls')}")
    text = "Would " + ", ".join(parts) if parts else "Would change nothing the feedback marks"
    text += ", misses nothing" if new.missed == 0 else f", still misses {_n(new.missed, 'marked call', 'marked calls')}"
    if new.changed_confirmed:
        text += f"; changes {_n(new.changed_confirmed, 'verdict', 'verdicts')} marked correct"
    return text + "."


@router.get("/scores/suggestion", response_model=SuggestionOut)
def get_suggestion(session: SessionDep) -> SuggestionOut:
    thresholds, _ = active_config("thresholds")
    families, _ = active_config("families")
    enabled = {f for f in FAMILY_ORDER if (families.data.get(f) or {}).get("enabled", False)}
    k = get_settings().llm_samples
    cur_t = Thresholds(review=thresholds.data["review"], alarm=thresholds.data["alarm"])
    calls = _calls(session, enabled)
    labelled = [c for c in calls if c.want is not None]
    counts: dict[str, int] = {}
    for label in _latest_labels(session).values():
        counts[label] = counts.get(label, 0) + 1

    def effect(review: float, alarm: float) -> Effect:
        e = _effect(labelled, review, alarm, k)
        e.flagged = _effect(calls, review, alarm, k).flagged
        return e

    current = effect(cur_t.review, cur_t.alarm)
    base = SuggestionOut(current=cur_t, thresholds_version_id=thresholds.version_id, labelled_calls=len(labelled),
                         labels=counts, suggestion=None, current_effect=current, suggested_effect=None, summary="")
    if not labelled:
        base.summary = "No feedback on calls yet. Mark calls as correct, false alarm or missed to get a suggestion."
        return base

    grid = sorted({*range(0, 101, STEP), int(cur_t.review), int(cur_t.alarm)})
    best: tuple[tuple, float, float] | None = None
    for review in grid:
        for alarm in grid:
            if alarm < review:
                continue
            e = _effect(labelled, review, alarm, k)
            key = (*_errors(e), abs(review - cur_t.review) + abs(alarm - cur_t.alarm))
            if best is None or key < best[0]:
                best = (key, review, alarm)
    assert best is not None
    _, review, alarm = best
    suggested = effect(review, alarm)
    if _errors(suggested) >= _errors(current):
        base.summary = "The active thresholds already fit the feedback best. No change suggested."
        return base
    base.suggestion = Thresholds(review=review, alarm=alarm)
    base.suggested_effect = suggested
    base.summary = _summary(current, suggested)
    return base
