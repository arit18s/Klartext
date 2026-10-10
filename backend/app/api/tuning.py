"""GET /scores/suggestion: thresholds suggested from officer feedback (stretch goal R11).

Reads the latest verdict-type feedback per call (notes are ignored), re-decides every labelled call with the decision
rule (app/pipeline/decide.py) over a grid of thresholds and suggests the pair that fits the feedback best:
fewest misses first (D4), then fewest false alarms, extra reviews, unmet escalations, verdicts that change although
they were marked correct, and finally the smallest move from the active thresholds. Only suggests; never saves.

Safety (D44): a suggestion must keep recall on the latest dev evaluation run at least as high as the active
thresholds do, and must not make any feedback error count worse (no trading a false alarm for an extra review).
Recall per review threshold comes from that run's PR curve: with alarm >= review, whether a call is flagged depends
on the review threshold only. No dev run: no suggestion (fail safe). The holdout split is never read here.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.common import PlainErrorRoute, active_config
from app.api.evaluation import _latest_file, _latest_row
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


class DevRecall(BaseModel):
    """Recall on the latest dev evaluation run (its PR curve), at the active and at the suggested review threshold."""

    run_id: str
    current: float | None
    suggested: float | None


NO_DEV_RUN = ("No Dev evaluation run yet, so Klartext cannot check that a change still catches every real case. "
              "Run Dev on the Quality page first.")
NO_SAFE = "No safe suggestion: every change would miss real cases."


class SuggestionOut(BaseModel):
    current: Thresholds
    thresholds_version_id: int
    labelled_calls: int
    labels: dict[str, int]
    suggestion: Thresholds | None
    current_effect: Effect
    suggested_effect: Effect | None
    dev_recall: DevRecall | None  # None without a dev evaluation run
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


def _dev_curve(session: Session) -> tuple[str, dict[int, float | None]] | None:
    """Run ID and recall by review threshold of the latest dev run. Dev only: never tune on holdout."""
    run = _latest_file("dev") or _latest_row(session, "dev")
    if run is None:
        return None
    curve = (run.get("metrics") or {}).get("pr_curve") or []
    return run["run_id"], {int(p["t_review"]): p.get("recall") for p in curve if isinstance(p, dict) and "t_review" in p}


def _recall_at(curve: dict[int, float | None], review: float) -> float | None:
    """The curve has integer thresholds; a fractional one reads the lower point (recall only falls as review rises)."""
    return curve.get(int(review))


def _no_worse(new: Effect, cur: Effect) -> bool:
    return all(a <= b for a, b in zip(_errors(new), _errors(cur)))


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
                         labels=counts, suggestion=None, current_effect=current, suggested_effect=None, dev_recall=None,
                         summary="")
    if not labelled:
        base.summary = "No feedback on calls yet. Mark calls as correct, false alarm or missed to get a suggestion."
        return base
    dev = _dev_curve(session)
    if dev is None:
        base.summary = NO_DEV_RUN
        return base
    run_id, curve = dev
    floor = _recall_at(curve, cur_t.review)
    base.dev_recall = DevRecall(run_id=run_id, current=floor, suggested=None)

    def safe(review: float) -> bool:  # unknown recall counts as unsafe
        r = _recall_at(curve, review)
        return floor is not None and r is not None and r >= floor

    grid = sorted({*range(0, 101, STEP), int(cur_t.review), int(cur_t.alarm)})
    best: tuple[tuple, float, float] | None = None
    unsafe_gain = False  # some pair fits the feedback better, but only by losing dev recall
    for review in grid:
        for alarm in grid:
            if alarm < review:
                continue
            e = _effect(labelled, review, alarm, k)
            if not (_no_worse(e, current) and _errors(e) < _errors(current)):
                continue
            if not safe(review):
                unsafe_gain = True
                continue
            key = (*_errors(e), abs(review - cur_t.review) + abs(alarm - cur_t.alarm))
            if best is None or key < best[0]:
                best = (key, review, alarm)
    if best is None:
        base.summary = NO_SAFE if unsafe_gain else "No threshold change would fit the feedback better. No change suggested."
        return base
    _, review, alarm = best
    base.suggestion = Thresholds(review=review, alarm=alarm)
    base.suggested_effect = effect(review, alarm)
    base.dev_recall.suggested = _recall_at(curve, review)
    base.summary = _summary(current, base.suggested_effect)
    return base
