"""GET /advisors: patterns across calls per advisor (stretch goal R12, 02_APP_FLOW screen 8).

Grouped by `calls.advisor_name` from the role labelling; calls without a recognised name are left out.
Alarms and reviews are split by who raised them (`raised_by` in common.py): customer-raised ones are customer
requests, not the advisor's own behaviour. `unclear` counts as advisor-raised, so nothing is hidden.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.common import PlainErrorRoute, family_rank, iso, parse_since, raised_by, trigger_speakers, utc
from app.db import get_session
from app.models.tables import Call, Decision
from app.pipeline.decide import FAMILY_ORDER

router = APIRouter(tags=["advisors"], route_class=PlainErrorRoute)  # mounted under /api by scores.router
SessionDep = Annotated[Session, Depends(get_session)]


class AdvisorRow(BaseModel):
    advisor_name: str
    calls: int
    alarm: int
    review: int
    no_alert: int
    advisor_alarm: int  # alarm/review split by raised_by: advisor (or unclear) vs customer
    advisor_review: int
    customer_alarm: int
    customer_review: int
    families: list[str]  # families of this advisor's alarms and reviews, in the fixed family order
    last_call_at: str | None
    last_call_id: str | None


@router.get("/advisors", response_model=list[AdvisorRow])
def get_advisors(session: SessionDep, since: str | None = None) -> list[AdvisorRow]:
    """`since`: only calls processed at or after it (same as GET /calls). Most advisor-raised alarms, then
    advisor-raised reviews first."""
    since_dt = parse_since(since)
    decisions = {d.call_id: d for d in session.exec(select(Decision))}
    speakers = trigger_speakers(session, decisions)
    groups: dict[str, list[Call]] = {}
    for c in session.exec(select(Call).where(Call.advisor_name != None)):  # noqa: E711
        name = (c.advisor_name or "").strip()
        if not name or (since_dt and (c.processed_at is None or utc(c.processed_at) < since_dt)):
            continue
        groups.setdefault(name, []).append(c)
    rows = [_row(name, calls, decisions, speakers) for name, calls in groups.items()]
    return sorted(rows, key=lambda r: (-r.advisor_alarm, -r.advisor_review, -r.alarm, -r.review, -r.calls,
                                       r.advisor_name.casefold()))


def _row(name: str, calls: list[Call], decisions: dict[str, Decision], speakers: dict[str, list[str | None]]) -> AdvisorRow:
    verdicts = [decisions[c.id] for c in calls if c.id in decisions]
    count = lambda v: sum(1 for d in verdicts if d.verdict == v)  # noqa: E731
    by_customer = lambda v: sum(  # noqa: E731
        1 for d in verdicts if d.verdict == v and raised_by(d.verdict, speakers.get(d.call_id, [])) == "customer")
    families = {d.family for d in verdicts if d.verdict in ("alarm", "review") and d.family in FAMILY_ORDER}
    stamp = lambda c: utc(c.processed_at or c.created_at) or datetime.min.replace(tzinfo=timezone.utc)  # noqa: E731
    last = max(calls, key=lambda c: (stamp(c), c.id))
    return AdvisorRow(advisor_name=name, calls=len(calls), alarm=count("alarm"), review=count("review"),
                      no_alert=count("no_alert"), advisor_alarm=count("alarm") - by_customer("alarm"),
                      advisor_review=count("review") - by_customer("review"), customer_alarm=by_customer("alarm"),
                      customer_review=by_customer("review"), families=sorted(families, key=family_rank),
                      last_call_at=iso(last.processed_at or last.created_at), last_call_id=last.id)
