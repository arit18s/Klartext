"""Calls API (API_CONTRACT.md "Calls"): list, detail, audio, snippets, history; feedback, recheck, retry."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from sqlmodel import Session, select

from app.api import jobs
from app.api.common import (
    VERDICT_RANK, PlainErrorRoute, parse_since, utc, CallSummary, audit, call_summary, confined, expected_verdicts, family_rank, get_call_or_404, iso,
    latest_feedback_labels, parse_json, triggered_call_ids,
)
from app.config import get_settings
from app.db import get_session
from app.models.tables import (
    AuditLog, Call, CheckResult, CheckRun, Decision, Evidence, Feedback, KeywordHit, Segment, TriggerSent,
)
from app.pipeline.decide import FAMILY_ORDER

router = APIRouter(prefix="/api/calls", tags=["calls"], route_class=PlainErrorRoute)
SessionDep = Annotated[Session, Depends(get_session)]
ZURICH = ZoneInfo("Europe/Zurich")

VERDICTS = {"alarm", "review", "no_alert"}
VARIANTS = {"clean", "noisy"}


# ---------- response models ----------

class CallCounts(BaseModel):
    total: int
    done: int
    flagged: int
    alarm: int
    review: int
    no_alert: int
    checked_today: int


class CallList(BaseModel):
    items: list[CallSummary]
    counts: CallCounts


class DecisionOut(BaseModel):
    verdict: str
    family: str | None
    score: float | None
    reason: str | None
    reason_de: str | None
    open_question: str | None
    asr_uncertain: bool
    thresholds_version_id: int | None
    decided_at: str | None


class CheckOut(BaseModel):
    family: str
    score: float | None
    event_majority: str
    agreement: float | None
    samples: int
    needs_human_votes: int
    open_question: str | None
    reason: str | None
    reason_de: str | None
    benign_explanation: str | None


class EvidenceOut(BaseModel):
    id: int
    family: str
    seg_id: str
    role: str
    start_s: float
    end_s: float
    speaker_role: str | None
    quote: str
    note: str | None
    snippet_url: str


class KeywordHitOut(BaseModel):
    keyword_id: str
    family: str | None
    phrase: str
    seg_id: str
    start_s: float
    end_s: float
    label: str | None


class SegmentOut(BaseModel):
    seg_id: str
    start_s: float
    end_s: float
    role: str | None
    text: str
    low_confidence: bool


class TwinOut(BaseModel):
    call_id: str
    dialogue_id: str | None
    variant: str | None
    verdict: str | None
    note: str | None


class FeedbackOut(BaseModel):
    id: int
    call_id: str
    label: str
    note: str | None
    created_at: str | None


class TriggerOut(BaseModel):
    id: int
    call_id: str
    remote_id: str | None
    url: str
    status_code: int | None
    created_at: str | None


class CallDetail(BaseModel):
    call: CallSummary
    decision: DecisionOut | None
    checks: list[CheckOut]
    evidence: list[EvidenceOut]
    keyword_hits: list[KeywordHitOut]
    segments: list[SegmentOut]
    twin: TwinOut | None
    feedback: list[FeedbackOut]
    triggers: list[TriggerOut]


# ---------- GET /calls ----------

def _split(value: str | None, allowed: set[str] | None = None, name: str = "") -> set[str] | None:
    if not value:
        return None
    items = {v.strip() for v in value.split(",") if v.strip()}
    if allowed is not None and not items <= allowed:
        bad = ", ".join(sorted(items - allowed))
        raise HTTPException(status_code=422, detail=f"Unknown {name} value: {bad}. Use one of: {', '.join(sorted(allowed))}.")
    return items or None


def _counts(calls: list[Call], decisions: dict[str, Decision]) -> CallCounts:
    ids = {c.id for c in calls}
    verdicts = Counter(d.verdict for d in decisions.values() if d.call_id in ids)
    today = datetime.now(ZURICH).date()
    checked_today = sum(1 for c in calls if c.processed_at and utc(c.processed_at).astimezone(ZURICH).date() == today)
    return CallCounts(
        total=len(calls), done=sum(1 for c in calls if c.status == "done"),
        flagged=verdicts["alarm"] + verdicts["review"], alarm=verdicts["alarm"], review=verdicts["review"],
        no_alert=verdicts["no_alert"], checked_today=checked_today,
    )


def _text_matches(session: Session, q: str) -> set[str]:
    needle = f"%{q.lower()}%"
    stmt = select(Segment.call_id).where(Segment.text.ilike(needle)).distinct()  # type: ignore[attr-defined]
    return set(session.exec(stmt))


@router.get("", response_model=CallList)
def list_calls(
    session: SessionDep,
    verdict: str | None = None,
    family: str | None = None,
    level: str | None = None,
    variant: str | None = None,
    advisor: str | None = None,
    since: str | None = None,
    q: str | None = None,
    flagged_only: bool = False,
) -> CallList:
    verdicts = _split(verdict, VERDICTS, "verdict")
    families = _split(family, set(FAMILY_ORDER), "family")
    levels = _split(level, {"1", "2", "3"}, "level")
    variants = _split(variant, VARIANTS, "variant")
    advisors = _split(advisor)
    since_dt = parse_since(since)

    calls = list(session.exec(select(Call)))
    decisions = {d.call_id: d for d in session.exec(select(Decision))}
    feedback = latest_feedback_labels(session)
    triggered = triggered_call_ids(session)
    expected = expected_verdicts()
    text_hits = _text_matches(session, q.strip()) if q and q.strip() else set()
    needle = q.strip().lower() if q else ""

    def keep(c: Call) -> bool:
        d = decisions.get(c.id)
        if verdicts and (d is None or d.verdict not in verdicts):
            return False
        if flagged_only and (d is None or d.verdict not in ("alarm", "review")):
            return False
        if families and (d is None or d.family not in families):
            return False
        if levels and str(c.level) not in levels:
            return False
        if variants and c.variant not in variants:
            return False
        if advisors and c.advisor_name not in advisors:
            return False
        if since_dt and (c.processed_at is None or utc(c.processed_at) < since_dt):
            return False
        if needle and not (needle in c.id.lower() or needle in (c.advisor_name or "").lower() or c.id in text_hits):
            return False
        return True

    def order(c: Call) -> tuple:
        d = decisions.get(c.id)
        rank = VERDICT_RANK.get(d.verdict, 3) if d else 3
        score = d.score if d and d.score is not None else -1.0
        return (rank, -score, c.id)

    items = [
        call_summary(c, decisions.get(c.id), feedback.get(c.id), c.id in triggered, expected)
        for c in sorted(filter(keep, calls), key=order)
    ]
    return CallList(items=items, counts=_counts(calls, decisions))


# ---------- GET /calls/{id} ----------

def _decision(d: Decision | None) -> DecisionOut | None:
    if d is None:
        return None
    return DecisionOut(
        verdict=d.verdict, family=d.family, score=d.score, reason=d.reason, reason_de=d.reason_de,
        open_question=d.open_question, asr_uncertain=d.asr_uncertain,
        thresholds_version_id=d.thresholds_version_id, decided_at=iso(d.decided_at),
    )


def _checks(session: Session, call_id: str) -> list[CheckOut]:
    rows = sorted(session.exec(select(CheckResult).where(CheckResult.call_id == call_id)), key=lambda r: family_rank(r.family))
    valid = Counter(fam for fam, ok in session.exec(
        select(CheckRun.family, CheckRun.valid).where(CheckRun.call_id == call_id)) if ok)
    return [
        CheckOut(family=r.family, score=r.score, event_majority=r.event_majority, agreement=r.agreement,
                 samples=valid[r.family], needs_human_votes=r.needs_human_votes, open_question=r.open_question,
                 reason=r.reason, reason_de=r.reason_de, benign_explanation=r.benign_explanation)
        for r in rows if r.family in FAMILY_ORDER
    ]


def _snippet_url(call_id: str, seg_id: str) -> str:
    return f"/api/calls/{call_id}/snippets/{seg_id}"


def _evidence(session: Session, call_id: str, family: str | None, segments: list[Segment]) -> list[EvidenceOut]:
    if not family:
        return []
    rows = list(session.exec(select(Evidence).where(Evidence.call_id == call_id, Evidence.family == family)))
    if rows:
        out = [EvidenceOut(id=e.id or 0, family=e.family, seg_id=e.seg_id, role=e.role, start_s=e.start_s, end_s=e.end_s,
                           speaker_role=e.speaker_role, quote=e.quote, note=e.note, snippet_url=_snippet_url(call_id, e.seg_id))
               for e in rows]
    else:
        out = _evidence_from_checks(call_id, family, segments)
    return sorted(out, key=lambda e: (e.start_s, e.id))


def _evidence_from_checks(call_id: str, family: str, segments: list[Segment]) -> list[EvidenceOut]:
    """Until the evidence stage (B20) fills the table: the decided family's evidence from data/checks/<call_id>.json,
    placed on its segment. Quotes there already passed the hallucination guard."""
    path = get_settings().data_path / "checks" / f"{call_id}.json"
    if not path.is_file():
        return []
    try:
        items = json.loads(path.read_text(encoding="utf-8"))["checks"]["families"][family]["evidence"]
    except (ValueError, KeyError, TypeError):
        return []
    by_seg = {s.seg_id: s for s in segments}
    out = []
    for i, ev in enumerate(items, start=1):
        seg = by_seg.get(ev.get("seg_id"))
        if seg is None or not ev.get("quote"):
            continue
        out.append(EvidenceOut(id=i, family=family, seg_id=seg.seg_id, role=ev.get("role", "context"), start_s=seg.start_s,
                               end_s=seg.end_s, speaker_role=seg.role, quote=ev["quote"], note=ev.get("note"),
                               snippet_url=_snippet_url(call_id, seg.seg_id)))
    return out


def _keyword_labels(session: Session, call_id: str) -> dict[tuple[str, str, str], str]:
    """Majority of keyword_judgements per (family, keyword_id, seg_id) over that family's valid samples; ties count as relevant."""
    votes: dict[tuple[str, str, str], Counter] = {}
    for run in session.exec(select(CheckRun).where(CheckRun.call_id == call_id, CheckRun.valid == True)):  # noqa: E712
        try:
            judgements = (json.loads(run.output_json).get("sample") or {}).get("keyword_judgements") or []
        except (ValueError, AttributeError):
            continue
        for j in judgements:
            if isinstance(j, dict) and j.get("label") in ("relevant", "benign"):
                votes.setdefault((run.family, j.get("keyword_id"), j.get("seg_id")), Counter())[j["label"]] += 1
    return {k: "relevant" if c["relevant"] >= c["benign"] else "benign" for k, c in votes.items()}


def _keyword_hits(session: Session, call_id: str) -> list[KeywordHitOut]:
    labels = _keyword_labels(session, call_id)
    rows = session.exec(select(KeywordHit).where(KeywordHit.call_id == call_id).order_by(KeywordHit.start_s, KeywordHit.id))
    return [
        KeywordHitOut(keyword_id=h.keyword_id, family=h.family or None, phrase=h.phrase, seg_id=h.seg_id, start_s=h.start_s,
                      end_s=h.end_s, label=labels.get((h.family, h.keyword_id, h.seg_id)))
        for h in rows
    ]


def _twin(session: Session, d: Decision | None) -> TwinOut | None:
    if d is None or not d.twin_call_id:
        return None
    twin = session.get(Call, d.twin_call_id)
    if twin is None:
        return None
    td = session.get(Decision, twin.id)
    return TwinOut(call_id=twin.id, dialogue_id=twin.dialogue_id, variant=twin.variant,
                   verdict=td.verdict if td else None, note=d.twin_note)


@router.get("/{call_id}", response_model=CallDetail)
def get_call(call_id: str, session: SessionDep) -> CallDetail:
    call = get_call_or_404(session, call_id)
    d = session.get(Decision, call_id)
    segments = list(session.exec(select(Segment).where(Segment.call_id == call_id).order_by(Segment.start_s, Segment.id)))
    feedback = list(session.exec(select(Feedback).where(Feedback.call_id == call_id).order_by(Feedback.created_at, Feedback.id)))
    triggers = list(session.exec(select(TriggerSent).where(TriggerSent.call_id == call_id).order_by(TriggerSent.created_at, TriggerSent.id)))
    summary = call_summary(call, d, feedback[-1].label if feedback else None, call_id in triggered_call_ids(session, [call_id]),
                           expected_verdicts())
    return CallDetail(
        call=summary,
        decision=_decision(d),
        checks=_checks(session, call_id),
        evidence=_evidence(session, call_id, d.family if d else None, segments),
        keyword_hits=_keyword_hits(session, call_id),
        segments=[SegmentOut(seg_id=s.seg_id, start_s=s.start_s, end_s=s.end_s, role=s.role, text=s.text,
                             low_confidence=s.low_confidence) for s in segments],
        twin=_twin(session, d),
        feedback=[FeedbackOut(id=f.id or 0, call_id=f.call_id, label=f.label, note=f.note, created_at=iso(f.created_at))
                  for f in feedback],
        triggers=[TriggerOut(id=t.id or 0, call_id=t.call_id, remote_id=t.remote_id, url=t.url, status_code=t.status_code,
                             created_at=iso(t.created_at)) for t in triggers],
    )


# ---------- audio ----------

@router.get("/{call_id}/audio", response_class=FileResponse)
def get_audio(call_id: str, session: SessionDep) -> FileResponse:
    """The full recording. FileResponse answers Range requests with 206 Partial Content."""
    call = get_call_or_404(session, call_id)
    path = confined(call.file_path)
    if path is None:
        raise HTTPException(status_code=404, detail=f"The recording for {call_id} is not available.")
    return FileResponse(path, media_type="audio/wav")


@router.get("/{call_id}/snippets/{seg_id}", response_class=FileResponse)
def get_snippet(call_id: str, seg_id: str, session: SessionDep) -> FileResponse:
    get_call_or_404(session, call_id)
    rows = session.exec(select(Evidence).where(Evidence.call_id == call_id, Evidence.seg_id == seg_id))
    path = next((p for p in (confined(e.snippet_path) for e in rows) if p is not None), None)
    if path is None:
        raise HTTPException(status_code=404, detail=f"No snippet for {seg_id} in {call_id}.")
    return FileResponse(path, media_type="audio/wav")


# ---------- GET /calls/{id}/history ----------

class HistoryEntry(BaseModel):
    id: int
    actor: str
    action: str
    target: str | None
    details: dict[str, Any] | None
    created_at: str | None


@router.get("/{call_id}/history", response_model=list[HistoryEntry])
def get_history(call_id: str, session: SessionDep) -> list[HistoryEntry]:
    get_call_or_404(session, call_id)
    rows = session.exec(select(AuditLog).where(AuditLog.target == f"call:{call_id}")
                        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc()))  # type: ignore[union-attr]
    out = []
    for r in rows:
        details = parse_json(r.details_json)
        out.append(HistoryEntry(id=r.id or 0, actor=r.actor, action=r.action, target=r.target,
                                details=details if isinstance(details, dict) else None, created_at=iso(r.created_at)))
    return out


# ---------- POST /calls/{id}/feedback ----------

FeedbackLabel = Literal["correct", "false_alarm", "missed", "escalated_to_alarm", "closed_no_alert", "note"]
NOTE_MAX = 2000


class FeedbackRequest(BaseModel):
    label: FeedbackLabel
    note: str | None = Field(default=None, max_length=NOTE_MAX)

    @model_validator(mode="after")
    def _note_rules(self) -> "FeedbackRequest":
        self.note = (self.note or "").strip() or None
        if self.label == "note" and not self.note:
            raise ValueError("A note needs text. Write the note and save it again.")
        return self


@router.post("/{call_id}/feedback", status_code=201, response_model=FeedbackOut)
def post_feedback(call_id: str, body: FeedbackRequest, session: SessionDep) -> FeedbackOut:
    get_call_or_404(session, call_id)
    fb = Feedback(call_id=call_id, label=body.label, note=body.note)
    session.add(fb)
    audit(session, "feedback", f"call:{call_id}", {"label": body.label, "note": body.note})
    session.commit()
    session.refresh(fb)
    _notify(call_id)
    return FeedbackOut(id=fb.id or 0, call_id=fb.call_id, label=fb.label, note=fb.note, created_at=iso(fb.created_at))


# ---------- POST /calls/{id}/recheck, /retry ----------

class JobAccepted(BaseModel):
    call_id: str
    status: str


def _notify(call_id: str) -> None:
    from app.api.events import notify_call_updated

    try:
        notify_call_updated(call_id)
    except Exception:  # live updates are best effort; the write already succeeded
        pass


def _process(call_id: str, from_stage: str) -> None:
    from app.pipeline.run import process

    process([call_id], from_stage=from_stage)


def _set_status(call_id: str, status: str) -> None:
    from app.pipeline.run import _set_status as set_status

    set_status(call_id, status)


@router.post("/{call_id}/recheck", status_code=202, response_model=JobAccepted)
def post_recheck(call_id: str, session: SessionDep) -> JobAccepted:
    """Checks and decision again from the stored transcript, with the active config (verdicts may change)."""
    call = get_call_or_404(session, call_id)
    if call.status not in ("done", "failed"):
        raise HTTPException(status_code=409, detail=f"{call_id} is still being processed ({call.status}). Wait until it is done, then recheck.")
    if not (get_settings().data_path / "roles" / f"{call_id}.json").is_file():
        raise HTTPException(status_code=409, detail=f"{call_id} has no transcript yet, so there is nothing to recheck. Retry the call instead.")
    audit(session, "recheck", f"call:{call_id}", {"previous_status": call.status})
    session.commit()
    _set_status(call_id, "checking")
    jobs.submit(f"recheck {call_id}", lambda: _process(call_id, "checks"))
    return JobAccepted(call_id=call_id, status="checking")


@router.post("/{call_id}/retry", status_code=202, response_model=JobAccepted)
def post_retry(call_id: str, session: SessionDep) -> JobAccepted:
    """Re-queue a failed call and run it from the first stage."""
    call = get_call_or_404(session, call_id)
    if call.status != "failed":
        raise HTTPException(status_code=409, detail=f"{call_id} has not failed, so there is nothing to retry.")
    audit(session, "retry", f"call:{call_id}", {"error": call.error})
    session.commit()
    _set_status(call_id, "queued")
    jobs.submit(f"retry {call_id}", lambda: _process(call_id, "asr"))
    return JobAccepted(call_id=call_id, status="queued")
