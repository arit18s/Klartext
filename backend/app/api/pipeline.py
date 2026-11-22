"""Pipeline API (API_CONTRACT.md "Pipeline"): status (also the SSE `pipeline_status` payload), watch, inbox drop,
process-folder and export."""

from __future__ import annotations

import csv
import hashlib
import io
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api import jobs, pipeline_state
from app.api.common import PlainErrorRoute, audit, utc, file_name, iso, triggered_call_ids
from app.config import get_settings
from app.db import get_session
from app.models.tables import Call, Decision, Evidence

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"], route_class=PlainErrorRoute)
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


def _item(call: Call, d: Decision | None, triggered: bool, prog: pipeline_state.Progress | None, now: datetime) -> PipelineItem:
    active = call.status not in ("done", "failed")
    use = prog if prog and active else None
    stage = use.stage if use else call.status
    if call.status == "done":
        end = utc(call.processed_at)
    elif active:
        end = now
    else:
        end = prog.updated_at if prog else None
    start = prog.started_at if prog else utc(call.created_at)
    if call.status == "done" and end is not None and not (prog and prog.started_at <= end <= prog.updated_at + timedelta(seconds=60)):
        start = None  # no timing of the run that finished (e.g. processed by another process): show none, not hours
    elapsed = round((end - start).total_seconds(), 1) if end and start else None
    updated = (prog.updated_at if use else None) or utc(call.processed_at) or (utc(d.decided_at) if d else None) or utc(call.created_at)
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

    queue = sorted((c for c in calls if c.status != "done"), key=lambda c: (utc(c.created_at) or now, c.id))
    done = sorted((c for c in calls if c.status == "done"), key=lambda c: (utc(c.processed_at) or now, c.id), reverse=True)
    last_file = state.last_file_at or max((utc(c.created_at) for c in calls if c.created_at), default=None)
    lb = state.last_batch
    return PipelineStatus(
        watching=state.watching, inbox_dir=str(get_settings().inbox_path), poll_interval_s=state.poll_interval_s,
        last_file_at=iso(last_file), queue=[item(c) for c in queue], recent=[item(c) for c in done[:RECENT]],
        last_batch=LastBatchOut(files=lb.files, failed=lb.failed, duration_s=lb.duration_s, finished_at=iso(lb.finished_at)) if lb else None,
    )


@router.get("/status", response_model=PipelineStatus)
def get_status(session: SessionDep) -> PipelineStatus:
    return build_status(session)


# ---------- POST /pipeline/watch ----------

class WatchRequest(BaseModel):
    enabled: bool


class WatchOut(BaseModel):
    watching: bool


@router.post("/watch", response_model=WatchOut)
def post_watch(body: WatchRequest, session: SessionDep) -> WatchOut:
    """Pause or resume the inbox watcher. False when no watcher runs (WATCHER_ENABLED=false)."""
    from app.services.watcher import set_watching

    watching = set_watching(body.enabled)
    audit(session, "watch", "pipeline", {"requested": body.enabled, "watching": watching})
    session.commit()
    _pipeline_changed()
    return WatchOut(watching=watching)


def _pipeline_changed() -> None:
    from app.api.events import notify_pipeline_status

    try:
        notify_pipeline_status()
    except Exception:  # live updates are best effort
        pass


# ---------- POST /pipeline/inbox ----------

MAX_UPLOAD = 200 * 1024 * 1024
CHUNK = 1024 * 1024
UNSAFE = re.compile(r"[^\w.-]")
# Accepted uploads, checked by the file's first bytes, not only its name. Non-WAV files keep their extension in the
# inbox; the watcher converts them to 16 kHz mono WAV with ffmpeg (audio track only for .mp4).
UPLOAD_EXT = (".wav", ".mp3", ".m4a", ".mp4", ".flac", ".ogg")


def _looks_like(ext: str, head: bytes) -> bool:
    if ext == ".wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext == ".mp3":
        return head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if ext in (".m4a", ".mp4"):
        return head[4:8] == b"ftyp"
    if ext == ".flac":
        return head[:4] == b"fLaC"
    if ext == ".ogg":
        return head[:4] == b"OggS"
    return False


class InboxOut(BaseModel):
    file_name: str
    queued: bool
    duplicate: bool


def safe_stem(name: str) -> str:
    """The client's file name only as a label: no directories, only word characters, dots and dashes."""
    stem = Path(name.replace("\\", "/")).name
    stem = Path(stem).stem
    stem = UNSAFE.sub("_", stem).strip("._")[:80]
    return stem or "recording"


def _free_name(session: Session, inbox: Path, stem: str, ext: str = ".wav") -> str:
    """A name not in the inbox (any accepted extension) and not an existing call ID (the call ID is the file stem)."""
    candidate, n = stem, 1
    while any((inbox / f"{candidate}{e}").exists() for e in UPLOAD_EXT) or session.get(Call, candidate) is not None:
        n += 1
        candidate = f"{stem}_{n}"
    return f"{candidate}{ext}"


def _too_large(name: str) -> HTTPException:
    return HTTPException(status_code=413, detail=f"{name} is larger than 200 MB. Split or compress it and drop it again.")


def _not_wav(name: str) -> HTTPException:
    return HTTPException(status_code=415, detail=f"{name} is not a recording Klartext can read. Use WAV, MP3, M4A, MP4, FLAC or OGG and drop it again.")


@router.post("/inbox", status_code=202, response_model=InboxOut)
async def post_inbox(request: Request, session: SessionDep, file: UploadFile = File(...)) -> InboxOut:
    """Write one recording into INBOX_DIR under a safe name; the watcher processes it like any other recording."""
    shown = Path((file.filename or "recording.wav").replace("\\", "/")).name
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_UPLOAD + CHUNK:
        raise _too_large(shown)
    ext = Path(shown).suffix.lower()
    if ext not in UPLOAD_EXT:
        raise _not_wav(shown)
    inbox = get_settings().inbox_path
    inbox.mkdir(parents=True, exist_ok=True)
    tmp = inbox / f".upload-{os.getpid()}-{id(file)}.part"  # dot file: the watcher ignores it until the rename
    digest, size = hashlib.sha256(), 0
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(CHUNK):
                if size == 0 and not _looks_like(ext, chunk[:12]):
                    raise _not_wav(shown)
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise _too_large(shown)
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise _not_wav(shown)
        if session.exec(select(Call).where(Call.file_hash == digest.hexdigest())).first() is not None:
            return InboxOut(file_name=shown, queued=False, duplicate=True)
        name = _free_name(session, inbox, safe_stem(shown), ext)
        tmp.replace(inbox / name)
    finally:
        tmp.unlink(missing_ok=True)
    pipeline_state.file_seen()
    _pipeline_changed()
    return InboxOut(file_name=name, queued=True, duplicate=False)


# ---------- POST /pipeline/process-folder ----------

class ProcessFolderRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


class Rejected(BaseModel):
    file_name: str
    error: str


class ProcessFolderOut(BaseModel):
    path: str
    enqueued: int
    skipped_duplicates: int
    rejected: list[Rejected]


def _allowed_folder(raw: str) -> Path:
    """Resolve and confine to DATA_DIR / INBOX_DIR / CASE_DATA_DIR (07_SECURITY section 5)."""
    s = get_settings()
    path = Path(raw).expanduser()
    path = (path if path.is_absolute() else s.data_path / path).resolve()
    roots = [s.data_path.resolve(), s.inbox_path.resolve(), s.case_data_path.resolve()]
    if not any(path.is_relative_to(r) for r in roots):
        raise HTTPException(status_code=422, detail="This folder is outside the allowed folders. Copy the recordings into the data or inbox folder first.")
    if not path.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found. Check the path and try again.")
    return path


def _register_folder(folder: Path) -> tuple[list[str], int, list[Rejected]]:
    from app.pipeline.run import register
    from app.services.watcher import AUDIO_EXT, convert, needs_conversion

    new, dups, rejected = [], 0, []
    for p in sorted(folder.iterdir()):
        if not p.is_file() or p.name.startswith("."):
            continue
        if p.suffix.lower() not in AUDIO_EXT:
            rejected.append(Rejected(file_name=p.name, error="Not an audio file."))
            continue
        audio = p
        if needs_conversion(p):
            try:
                audio = convert(p)
            except ValueError as exc:
                rejected.append(Rejected(file_name=p.name, error=str(exc)))
                continue
        call, is_new = register(audio)
        if is_new:
            new.append(call.id)
        else:
            dups += 1
    return new, dups, rejected


@router.post("/process-folder", status_code=202, response_model=ProcessFolderOut)
def post_process_folder(body: ProcessFolderRequest, session: SessionDep) -> ProcessFolderOut:
    """Register every recording in the folder (dedup by hash) and process the new ones in the background."""
    from app.pipeline.run import process

    folder = _allowed_folder(body.path)
    new, dups, rejected = _register_folder(folder)
    audit(session, "process_folder", "pipeline", {"path": str(folder), "enqueued": len(new), "skipped_duplicates": dups,
                                                  "rejected": len(rejected)})
    session.commit()
    if new:
        jobs.submit(f"process-folder {folder.name}", lambda: process(new))
    _pipeline_changed()
    return ProcessFolderOut(path=body.path, enqueued=len(new), skipped_duplicates=dups, rejected=rejected)


# ---------- GET /pipeline/export ----------

EXPORT_COLUMNS = ["call_id", "file_name", "verdict", "family", "score", "reason", "open_question", "evidence"]


def export_rows(session: Session) -> list[dict[str, Any]]:
    """One row per call, sorted by call ID; evidence of the decided family, by start time."""
    decisions = {d.call_id: d for d in session.exec(select(Decision))}
    evidence: dict[str, list[Evidence]] = {}
    for e in session.exec(select(Evidence).order_by(Evidence.start_s, Evidence.id)):
        evidence.setdefault(e.call_id, []).append(e)
    rows = []
    for c in session.exec(select(Call).order_by(Call.id)):
        d = decisions.get(c.id)
        ev = [e for e in evidence.get(c.id, []) if d and e.family == d.family]
        rows.append({
            "call_id": c.id, "file_name": file_name(c), "verdict": d.verdict if d else None, "family": d.family if d else None,
            "score": d.score if d else None, "reason": d.reason if d else None, "open_question": d.open_question if d else None,
            "evidence": [{"role": e.role, "start_s": e.start_s, "end_s": e.end_s} for e in ev],
        })
    return rows


def _csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:g}"
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text  # no spreadsheet formulas from call text


def to_csv(rows: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(EXPORT_COLUMNS)
    for r in rows:
        ev = ";".join(f"{e['role']}:{e['start_s']:g}-{e['end_s']:g}" for e in r["evidence"])
        writer.writerow([_csv_value(r[c]) for c in EXPORT_COLUMNS[:-1]] + [ev])
    return buf.getvalue()


@router.get("/export")
def get_export(session: SessionDep, format: Literal["json", "csv"] = Query("json")) -> Response:
    rows = export_rows(session)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    if format == "csv":
        return Response(to_csv(rows), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="klartext-results-{stamp}.csv"'})
    return JSONResponse(rows, headers={"Content-Disposition": f'attachment; filename="klartext-results-{stamp}.json"'})
