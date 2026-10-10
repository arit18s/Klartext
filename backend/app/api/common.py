"""Shared helpers for the read API (docs/API_CONTRACT.md conventions)."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import get_settings
from app.db import get_engine
from app.db.config_store import ActiveConfig, get_active_config
from app.models.tables import AuditLog, Call, ConfigVersion, Decision, Evidence, Feedback, TriggerSent
from app.pipeline.decide import FAMILY_ORDER

log = logging.getLogger(__name__)

VERDICT_RANK = {"alarm": 0, "review": 1, "no_alert": 2}  # undecided sorts last
CONFIG_KINDS = ["keywords", "families", "thresholds", "model"]


def iso(dt: datetime | None) -> str | None:
    """ISO 8601 UTC with Z. SQLite returns naive datetimes; they are stored as UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_since(since: str | None) -> datetime | None:
    if not since:
        return None
    try:
        dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="since must be an ISO time, e.g. 2026-10-10T08:00:00Z.") from exc
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def family_rank(family: str) -> int:
    return FAMILY_ORDER.index(family) if family in FAMILY_ORDER else len(FAMILY_ORDER)


def expected_verdicts() -> dict[str, str]:
    """Ground-truth verdict by dialogue_id. EVALUATION ONLY: shown in evaluation mode, never used by the pipeline."""
    from app.eval.ground_truth import load_ground_truth

    try:
        return {dlg: gt.verdict for dlg, gt in load_ground_truth().items()}
    except Exception:  # missing or unreadable case data: the column stays empty
        log.warning("Ground truth not available; expected_verdict is null")
        return {}


def active_config(kind: str) -> tuple[ActiveConfig, ConfigVersion]:
    try:
        cfg = get_active_config(kind)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    with Session(get_engine()) as session:
        row = session.get(ConfigVersion, cfg.version_id)
    assert row is not None
    return cfg, row


def config_versions(session: Session) -> dict[str, int | None]:
    out: dict[str, int | None] = {}
    for kind in CONFIG_KINDS:
        row = session.exec(
            select(ConfigVersion).where(ConfigVersion.kind == kind, ConfigVersion.active == True)  # noqa: E712
            .order_by(ConfigVersion.id.desc())
        ).first()
        out[kind] = row.id if row else None
    return out


def get_call_or_404(session: Session, call_id: str) -> Call:
    call = session.get(Call, call_id)
    if call is None:
        raise HTTPException(status_code=404, detail=f"No call with ID {call_id}.")
    return call


def file_name(call: Call) -> str:
    return Path(call.file_path).name


def confined(path_str: str | None) -> Path | None:
    """Resolve a stored path and allow it only inside DATA_DIR, INBOX_DIR or the case data (07_SECURITY section 5)."""
    if not path_str:
        return None
    s = get_settings()
    path = Path(path_str)
    path = (path if path.is_absolute() else s.data_path / path).resolve()
    roots = [s.data_path.resolve(), s.inbox_path.resolve(), s.case_data_path.resolve()]
    if not any(path.is_relative_to(root) for root in roots):
        log.warning("Refused a file outside the allowed folders")
        return None
    return path if path.is_file() else None


def triggered_call_ids(session: Session, call_ids: Iterable[str] | None = None) -> set[str]:
    """Calls with at least one trigger the Outcept API accepted (2xx)."""
    stmt = select(TriggerSent.call_id, TriggerSent.status_code)
    if call_ids is not None:
        stmt = stmt.where(TriggerSent.call_id.in_(list(call_ids)))
    return {cid for cid, code in session.exec(stmt) if code is not None and 200 <= code < 300}


def latest_feedback_labels(session: Session) -> dict[str, str]:
    out: dict[str, str] = {}
    for fb in session.exec(select(Feedback).order_by(Feedback.created_at, Feedback.id)):
        out[fb.call_id] = fb.label
    return out


def raised_by(verdict: str | None, trigger_speakers: Iterable[str | None]) -> str | None:
    """Who raised a flagged call, from the speaker roles of the decided family's trigger evidence. Read-only:
    no model call, the verdict is unchanged. Any advisor line -> advisor; only customer lines -> customer;
    no trigger evidence or an unknown speaker -> unclear. None for no-alert and undecided calls."""
    if verdict not in ("alarm", "review"):
        return None
    roles = list(trigger_speakers)
    if "advisor" in roles:
        return "advisor"
    if roles and all(r == "customer" for r in roles):
        return "customer"
    return "unclear"


def trigger_speakers(session: Session, decisions: dict[str, Decision]) -> dict[str, list[str | None]]:
    """Speaker roles of each call's trigger evidence in its decided family (evidence table)."""
    out: dict[str, list[str | None]] = {}
    for call_id, family, speaker in session.exec(
        select(Evidence.call_id, Evidence.family, Evidence.speaker_role).where(Evidence.role == "trigger")
    ):
        d = decisions.get(call_id)
        if d is not None and d.family == family:
            out.setdefault(call_id, []).append(speaker)
    return out


class CallSummary(BaseModel):
    call_id: str
    file_name: str
    dialogue_id: str | None
    variant: str | None
    level: int | None
    duration_s: float | None
    advisor_name: str | None
    status: str
    error: str | None
    created_at: str | None
    processed_at: str | None
    verdict: str | None
    family: str | None
    score: float | None
    reason: str | None
    open_question: str | None
    feedback_label: str | None
    trigger_sent: bool
    expected_verdict: str | None
    raised_by: str | None  # advisor / customer / unclear for alarms and reviews, see raised_by()


def call_summary(call: Call, decision: Decision | None, feedback_label: str | None, trigger_sent: bool,
                 expected: dict[str, str], speakers: Iterable[str | None] = ()) -> CallSummary:
    return CallSummary(
        call_id=call.id, file_name=file_name(call), dialogue_id=call.dialogue_id, variant=call.variant,
        level=call.level, duration_s=call.duration_s, advisor_name=call.advisor_name, status=call.status,
        error=call.error, created_at=iso(call.created_at), processed_at=iso(call.processed_at),
        verdict=decision.verdict if decision else None, family=decision.family if decision else None,
        score=decision.score if decision else None, reason=decision.reason if decision else None,
        open_question=decision.open_question if decision else None, feedback_label=feedback_label,
        trigger_sent=trigger_sent, expected_verdict=expected.get(call.dialogue_id or ""),
        raised_by=raised_by(decision.verdict if decision else None, speakers),
    )


def parse_json(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


ACTOR = "Compliance officer"  # no login in the MVP; every officer action is attributed to this role


def audit(session: Session, action: str, target: str, details: dict[str, Any] | None = None, actor: str = ACTOR) -> None:
    """Add an audit_log row to the session (the caller commits)."""
    session.add(AuditLog(actor=actor, action=action, target=target,
                         details_json=json.dumps(details, ensure_ascii=False) if details is not None else None))


def _plain(err: dict[str, Any]) -> str:
    loc = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
    msg = str(err.get("msg", "Invalid value.")).removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc and not msg.endswith(".") else msg


class PlainErrorRoute(APIRoute):
    """422 as {"detail": "<one sentence>"} (API_CONTRACT conventions), not FastAPI's list of error objects."""

    def get_route_handler(self):  # type: ignore[no-untyped-def]
        handler = super().get_route_handler()

        async def route(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                errors = list(exc.errors())
                detail = "; ".join(_plain(e) for e in errors[:3]) or "Invalid request."
                return JSONResponse(status_code=422, content={"detail": detail})

        return route
