"""GET /scores: family scores of every decided call, for client-side re-decision on the Tuning page."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.common import PlainErrorRoute, active_config, expected_verdicts, family_rank, iso
from app.api.configs import ThresholdsOut
from app.config import get_settings
from app.db import get_session
from app.models.tables import Call, CheckResult, Decision
from app.pipeline.decide import FAMILY_ORDER

router = APIRouter(prefix="/api", tags=["scores"], route_class=PlainErrorRoute)
SessionDep = Annotated[Session, Depends(get_session)]


class FamilyScoreOut(BaseModel):
    family: str
    score: float | None
    needs_human_votes: int
    failed: bool


class CallScoresOut(BaseModel):
    call_id: str
    dialogue_id: str | None
    variant: str | None
    level: int | None
    verdict: str | None
    asr_uncertain: bool
    expected_verdict: str | None
    families: list[FamilyScoreOut]


class ScoresOut(BaseModel):
    thresholds: ThresholdsOut
    samples_per_check: int
    enabled_families: list[str]
    calls: list[CallScoresOut]


@router.get("/scores", response_model=ScoresOut)
def get_scores(session: SessionDep) -> ScoresOut:
    thresholds, t_row = active_config("thresholds")
    families, _ = active_config("families")
    enabled = [f for f in FAMILY_ORDER if (families.data.get(f) or {}).get("enabled", False)]
    results: dict[str, list[CheckResult]] = {}
    for r in session.exec(select(CheckResult)):
        if r.family in FAMILY_ORDER:
            results.setdefault(r.call_id, []).append(r)
    expected = expected_verdicts()
    calls = []
    for call, d in session.exec(select(Call, Decision).where(Call.id == Decision.call_id).order_by(Call.id)):
        rows = sorted(results.get(call.id, []), key=lambda r: family_rank(r.family))
        calls.append(CallScoresOut(
            call_id=call.id, dialogue_id=call.dialogue_id, variant=call.variant, level=call.level, verdict=d.verdict,
            asr_uncertain=d.asr_uncertain, expected_verdict=expected.get(call.dialogue_id or ""),
            families=[FamilyScoreOut(family=r.family, score=r.score, needs_human_votes=r.needs_human_votes,
                                     failed=r.event_majority == "failed") for r in rows],
        ))
    return ScoresOut(
        thresholds=ThresholdsOut(version_id=thresholds.version_id, review=thresholds.data["review"], alarm=thresholds.data["alarm"],
                                 note=t_row.note, created_at=iso(t_row.created_at)),
        samples_per_check=get_settings().llm_samples, enabled_families=enabled, calls=calls,
    )
