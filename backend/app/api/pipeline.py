"""GET /pipeline/status (API_CONTRACT.md "Pipeline"). Also the payload of the SSE event `pipeline_status`."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api import pipeline_state
from app.api.common import file_name, iso, triggered_call_ids
from app.config import get_settings
from app.db import get_session
from app.models.tables import Call, Decision

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])
SessionDep = Annotated[Session, Depends(get_session)]

RECENT = 20
# Progress shown for a call status when no stage progress was reported.
STATUS_PROGRESS = {"queued": 0.0, "waiting_for_asr": 0.0, "transcribing": 0.2, "checking": 0.6, "failed": 0.0, "done": 1.0}


class PipelineItem(BaseModel):
    call_id: str
    file_name: str
    stage: str
    progress: float
    progress_note: str | None
    duration_s: float | None
    elapsed_s: float | None
    verdict: str | None
    score: float | None
    trigger_sent: bool
    error: str | None
    updated_at: str | None


class LastBatchOut(BaseModel):
    files: int
    failed: int
    duration_s: float
    finished_at: str | None


class PipelineStatus(BaseModel):
    watching: bool
    inbox_dir: str
    poll_interval_s: float
    last_file_at: str | None
    queue: list[PipelineItem]
    recent: list[PipelineItem]
    last_batch: LastBatchOut | None


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _item(call: Call, d: Decision | None, triggered: bool, prog: pipeline_state.Progress | None, now: datetime) -> PipelineItem:
    active = call.status not in ("done", "failed")
    use = prog if prog and active else None
    stage = use.stage if use else call.status
    if call.status == "done":
        end = _utc(call.processed_at)
    elif active:
        end = now
    else:
        end = prog.updated_at if prog else None
    start = prog.started_at if prog else _utc(call.created_at)
    elapsed = round((end - start).total_seconds(), 1) if end and start else None
    updated = (prog.updated_at if use else None) or _utc(call.processed_at) or (_utc(d.decided_at) if d else None) or _utc(call.created_at)
    return PipelineItem(
        call_id=call.id, file_name=file_name(call), stage=stage,
        progress=use.progress if use else STATUS_PROGRESS.get(call.status, 0.0), progress_note=use.note if use else None,
        duration_s=call.duration_s, elapsed_s=max(0.0, elapsed) if elapsed is not None else None,
        verdict=d.verdict if d and call.status == "done" else None, score=d.score if d and call.status == "done" else None,
        trigger_sent=triggered, error=call.error if call.status == "failed" else None, updated_at=iso(updated),
    )


def build_status(session: Session) -> PipelineStatus:
    state = pipeline_state.snapshot()
    now = datetime.now(timezone.utc)
    calls = list(session.exec(select(Call)))
    decisions = {d.call_id: d for d in session.exec(select(Decision))}
    triggered = triggered_call_ids(session)

    def item(c: Call) -> PipelineItem:
        return _item(c, decisions.get(c.id), c.id in triggered, state.progress.get(c.id), now)

    queue = sorted((c for c in calls if c.status != "done"), key=lambda c: (_utc(c.created_at) or now, c.id))
    done = sorted((c for c in calls if c.status == "done"), key=lambda c: (_utc(c.processed_at) or now, c.id), reverse=True)
    last_file = state.last_file_at or max((_utc(c.created_at) for c in calls if c.created_at), default=None)
    lb = state.last_batch
    return PipelineStatus(
        watching=state.watching, inbox_dir=str(get_settings().inbox_path), poll_interval_s=state.poll_interval_s,
        last_file_at=iso(last_file), queue=[item(c) for c in queue], recent=[item(c) for c in done[:RECENT]],
        last_batch=LastBatchOut(files=lb.files, failed=lb.failed, duration_s=lb.duration_s, finished_at=iso(lb.finished_at)) if lb else None,
    )


@router.get("/status", response_model=PipelineStatus)
def get_status(session: SessionDep) -> PipelineStatus:
    return build_status(session)
