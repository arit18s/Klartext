"""In-process pipeline state for GET /pipeline/status.

The DB has no table for the watcher or for stage progress. The watcher (B26) and the orchestrator report here;
until they do, the status is derived from the call rows alone and `watching` is false.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Progress:
    stage: str
    progress: float
    note: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class LastBatch:
    files: int
    failed: int
    duration_s: float
    finished_at: datetime


@dataclass
class PipelineState:
    watching: bool = False
    poll_interval_s: float = 5.0
    last_file_at: datetime | None = None
    last_batch: LastBatch | None = None
    progress: dict[str, Progress] = field(default_factory=dict)


_lock = threading.Lock()
_state = PipelineState()


def snapshot() -> PipelineState:
    with _lock:
        return PipelineState(_state.watching, _state.poll_interval_s, _state.last_file_at, _state.last_batch,
                             dict(_state.progress))


def set_watching(watching: bool, poll_interval_s: float | None = None) -> None:
    with _lock:
        _state.watching = watching
        if poll_interval_s is not None:
            _state.poll_interval_s = poll_interval_s


def file_seen(at: datetime | None = None) -> None:
    with _lock:
        _state.last_file_at = at or datetime.now(timezone.utc)


def report_progress(call_id: str, stage: str, progress: float, note: str | None = None) -> None:
    """Stage progress for one call; the start time is kept from its first report."""
    now = datetime.now(timezone.utc)
    with _lock:
        prev = _state.progress.get(call_id)
        started = prev.started_at if prev else now
        _state.progress[call_id] = Progress(stage, max(0.0, min(1.0, progress)), note, started, now)


def batch_finished(files: int, failed: int, duration_s: float) -> None:
    with _lock:
        _state.last_batch = LastBatch(files, failed, duration_s, datetime.now(timezone.utc))


def reset() -> None:
    global _state
    with _lock:
        _state = PipelineState()
