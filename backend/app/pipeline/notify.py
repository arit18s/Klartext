"""Outcept trigger API notification (05_BACKEND_STRUCTURE.md section 7, plan B22).

Every alarm or review is posted once per decision: re-runs skip a call whose current verdict, family
and deep link were already posted with 201. Failures are recorded and retried on the next run; they
never block processing (the client retries once and never raises).
"""

from __future__ import annotations

import json
import math

from sqlmodel import Session, select

from app.config import get_settings
from app.db import get_engine
from app.models.tables import AuditLog, Decision, Evidence, TriggerSent
from app.prompts import FAMILY_NAMES
from app.services.trigger_client import send_trigger

VERDICT_LABEL = {"alarm": "Alert", "review": "Review"}  # display text; the verdict value stays "alarm"


def _mmss(s: float) -> str:
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


def deep_link(call_id: str, trigger_start: float | None) -> str:
    t = max(0, math.floor((trigger_start or 0) - 10))
    return f"{get_settings().public_base_url.rstrip('/')}/calls/{call_id}?t={t}"


def build_payload(d: Decision, evidence: list[Evidence]) -> dict[str, str]:
    triggers = [e for e in evidence if e.role == "trigger"]
    first = min(triggers or evidence, key=lambda e: e.start_s, default=None)
    family = FAMILY_NAMES.get(d.family or "", d.family or "Check")
    title = f"{VERDICT_LABEL.get(d.verdict, d.verdict)}: {family} ({d.call_id})"
    parts = [d.reason or ""]
    if d.open_question:
        parts.append(f"Missing to decide: {d.open_question}")
    if first:
        parts.append(f"Evidence {_mmss(first.start_s)}–{_mmss(first.end_s)}.")
    return {"url": deep_link(d.call_id, first.start_s if first else None), "title": title, "description": " ".join(p for p in parts if p)}


def _already_sent(session: Session, d: Decision, url: str) -> bool:
    rows = session.exec(select(AuditLog).where(AuditLog.target == f"call:{d.call_id}", AuditLog.action == "trigger_sent")).all()
    for row in rows:
        det = json.loads(row.details_json or "{}")
        if det.get("status_code") == 201 and det.get("url") == url and det.get("verdict") == d.verdict and det.get("family") == d.family:
            return True
    return False


def notify(call_id: str) -> str:
    """Returns 'sent', 'skipped' (already sent / not flagged / disabled) or 'failed'."""
    if not get_settings().trigger_api_enabled:
        return "skipped"
    with Session(get_engine()) as session:
        d = session.get(Decision, call_id)
        if d is None or d.verdict not in VERDICT_LABEL:
            return "skipped"
        evidence = list(session.exec(select(Evidence).where(Evidence.call_id == call_id)).all())
        payload = build_payload(d, evidence)
        if _already_sent(session, d, payload["url"]):
            return "skipped"
        result = send_trigger(**payload)
        session.add(TriggerSent(call_id=call_id, remote_id=result.remote_id, url=payload["url"], status_code=result.status_code))
        session.add(AuditLog(actor="system", action="trigger_sent", target=f"call:{call_id}",
                             details_json=json.dumps({"remote_id": result.remote_id, "status_code": result.status_code,
                                                      "url": payload["url"], "verdict": d.verdict, "family": d.family,
                                                      "error": result.error})))
        session.commit()
        return "sent" if result.ok else "failed"
