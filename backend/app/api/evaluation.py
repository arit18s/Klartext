"""GET /eval/latest: the newest evaluation run written by scripts/evaluate.py (B12)."""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.common import iso, parse_json
from app.config import get_settings
from app.db import get_session
from app.models.tables import EvalRun

router = APIRouter(prefix="/api/eval", tags=["eval"])
SessionDep = Annotated[Session, Depends(get_session)]
log = logging.getLogger(__name__)


class EvalRunOut(BaseModel):
    run_id: str
    split: str
    source: str
    created_at: str | None
    config_versions: dict[str, int | None]
    metrics: dict[str, Any]


def _latest_file() -> dict[str, Any] | None:
    """data/eval/<run_id>.json holds the full run (run_id, source); newest by created_at."""
    folder = get_settings().data_path / "eval"
    runs = []
    for path in folder.glob("*.json") if folder.is_dir() else []:
        try:
            runs.append(json.loads(path.read_text(encoding="utf-8")))
        except ValueError:
            log.warning("Skipped an unreadable evaluation file")
    runs = [r for r in runs if isinstance(r, dict) and r.get("created_at") and r.get("metrics")]
    return max(runs, key=lambda r: (r["created_at"], r.get("run_id", ""))) if runs else None


def _latest_row(session: Session) -> dict[str, Any] | None:
    """Fallback when the run files are gone: the newest eval_runs row."""
    row = session.exec(select(EvalRun).order_by(EvalRun.created_at.desc(), EvalRun.id.desc())).first()  # type: ignore[union-attr]
    if row is None:
        return None
    snap = parse_json(row.config_snapshot_json) or {}
    return {
        "run_id": f"eval-{row.id}", "split": row.split,
        "source": "script" if snap.get("unit") == "dialogue" else "asr",
        "created_at": iso(row.created_at),
        "config_versions": {k: snap.get(k) for k in ("keywords", "families", "thresholds", "model")},
        "metrics": parse_json(row.metrics_json) or {},
    }


@router.get("/latest", response_model=EvalRunOut)
def get_latest(session: SessionDep) -> EvalRunOut:
    run = _latest_file() or _latest_row(session)
    if run is None:
        raise HTTPException(status_code=404, detail="No evaluation run yet. Run one on the Quality page or with scripts/evaluate.py.")
    cv = run.get("config_versions") or {}
    return EvalRunOut(run_id=run["run_id"], split=run["split"], source=run["source"], created_at=run["created_at"],
                      config_versions={k: cv.get(k) for k in ("keywords", "families", "thresholds", "model")},
                      metrics=run["metrics"])
