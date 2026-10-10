"""Evaluation API: GET /eval/latest (newest run of scripts/evaluate.py, B12) and POST /eval/run."""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.common import PlainErrorRoute, audit, iso, parse_json
from app.config import get_settings
from app.db import get_session
from app.models.tables import EvalRun

router = APIRouter(prefix="/api/eval", tags=["eval"], route_class=PlainErrorRoute)
SessionDep = Annotated[Session, Depends(get_session)]
log = logging.getLogger(__name__)


class EvalRunOut(BaseModel):
    run_id: str
    split: str
    source: str
    created_at: str | None
    config_versions: dict[str, int | None]
    metrics: dict[str, Any]


def _latest_file(split: str | None = None) -> dict[str, Any] | None:
    """data/eval/<run_id>.json holds the full run (run_id, source); newest by created_at, optionally of one split."""
    folder = get_settings().data_path / "eval"
    runs = []
    for path in folder.glob("*.json") if folder.is_dir() else []:
        try:
            runs.append(json.loads(path.read_text(encoding="utf-8")))
        except ValueError:
            log.warning("Skipped an unreadable evaluation file")
    runs = [r for r in runs if isinstance(r, dict) and r.get("created_at") and r.get("metrics") and (split is None or r.get("split") == split)]
    return max(runs, key=lambda r: (r["created_at"], r.get("run_id", ""))) if runs else None


def _latest_row(session: Session, split: str | None = None) -> dict[str, Any] | None:
    """Fallback when the run files are gone: the newest eval_runs row."""
    stmt = select(EvalRun) if split is None else select(EvalRun).where(EvalRun.split == split)
    row = session.exec(stmt.order_by(EvalRun.created_at.desc(), EvalRun.id.desc())).first()  # type: ignore[union-attr]
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
def get_latest(session: SessionDep, split: Literal["dev", "holdout", "all"] | None = None) -> EvalRunOut:
    """`split`: the newest run of that split (the Quality page shows the B29 holdout run read-only this way)."""
    run = _latest_file(split) or _latest_row(session, split)
    if run is None:
        detail = f"No evaluation run on the {split} split yet." if split else "No evaluation run yet. Run one on the Quality page or with scripts/evaluate.py."
        raise HTTPException(status_code=404, detail=detail)
    cv = run.get("config_versions") or {}
    return EvalRunOut(run_id=run["run_id"], split=run["split"], source=run["source"], created_at=run["created_at"],
                      config_versions={k: cv.get(k) for k in ("keywords", "families", "thresholds", "model")},
                      metrics=run["metrics"])


# ---------- POST /eval/run ----------

BACKEND = Path(__file__).resolve().parents[2]
EVAL_TIMEOUT_S = 600


class EvalRunRequest(BaseModel):
    split: Literal["dev", "holdout", "all"]


def run_evaluate_script(split: str) -> subprocess.CompletedProcess[str]:
    """scripts/evaluate.py on the pipeline's stored results (--source asr: no LLM calls). Holdout and all need the
    script's --holdout confirmation; the officer gives it by choosing that split (the Quality page warns first)."""
    cmd = [sys.executable, "scripts/evaluate.py", "--split", split, "--source", "asr"]
    if split in ("holdout", "all"):
        cmd.append("--holdout")
    return subprocess.run(cmd, cwd=BACKEND, capture_output=True, text=True, timeout=EVAL_TIMEOUT_S)


def _last_line(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith(("Traceback", " "))]
    return lines[-1] if lines else ""


@router.post("/run", response_model=EvalRunOut)
def post_run(body: EvalRunRequest, session: SessionDep) -> EvalRunOut:
    before = (_latest_file() or {}).get("run_id")
    try:
        proc = run_evaluate_script(body.split)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="The evaluation took too long. Run scripts/evaluate.py from the terminal.") from exc
    run = _latest_file()
    if proc.returncode != 0 or run is None or run.get("run_id") == before:
        reason = _last_line(proc.stdout) or _last_line(proc.stderr) or "The evaluation did not finish."
        log.warning("Evaluation failed (exit %s)", proc.returncode)
        raise HTTPException(status_code=409, detail=reason[:300])
    audit(session, "eval_run", "eval", {"run_id": run["run_id"], "split": body.split})
    session.commit()
    return get_latest(session, None)
