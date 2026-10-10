"""Inbox watcher (plan B26): every recording that lands in INBOX_DIR is processed with no click.

watchdog events plus a scan at start and every poll interval (catches files that were already there or
missed events). A file is taken once its size has been stable for STABLE_S (no half-copied files).
Audio that is not 16 kHz mono WAV is converted with ffmpeg into DATA_DIR/audio/. One worker thread runs
the pipeline call by call; duplicates are skipped by file hash. Reports to app.api.pipeline_state.
Nothing here executes or trusts file names beyond using them as the call ID.
"""

from __future__ import annotations

import logging
import queue
import re
import subprocess
import threading
import time
from pathlib import Path

import soundfile as sf
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from app.config import get_settings

log = logging.getLogger(__name__)

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
POLL_INTERVAL_S = 5.0
STABLE_S = 1.0
SAFE_STEM = re.compile(r"[^\w.-]")


def _state():
    from app.api import pipeline_state  # lazy: the watcher also runs without the API

    return pipeline_state


def needs_conversion(path: Path) -> bool:
    if path.suffix.lower() != ".wav":
        return True
    try:
        info = sf.info(str(path))
    except RuntimeError:
        return True
    return info.samplerate != 16000 or info.channels != 1


def convert(path: Path) -> Path:
    """ffmpeg to 16 kHz mono WAV in DATA_DIR/audio/<stem>.wav. Raises with a plain message on failure."""
    out_dir = get_settings().data_path / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / (SAFE_STEM.sub("_", path.stem) + ".wav")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-ar", "16000", "-ac", "1", str(out)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=300)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
        raise ValueError(f"{path.name} could not be converted to 16 kHz mono WAV ({type(exc).__name__}). "
                         "Convert it to WAV and drop it into the inbox again.") from exc
    return out


class InboxWatcher:
    def __init__(self, inbox: Path | None = None, poll_interval_s: float = POLL_INTERVAL_S) -> None:
        self.inbox = (inbox or get_settings().inbox_path).resolve()
        self.poll_interval_s = poll_interval_s
        self.queue: queue.Queue[Path] = queue.Queue()
        self.seen: set[str] = set()
        self.watching = False
        self._stop = threading.Event()
        self._observer: Observer | None = None
        self._threads: list[threading.Thread] = []

    # ----- intake -----
    def offer(self, path: Path) -> None:
        path = path.resolve()
        if path.parent != self.inbox or path.suffix.lower() not in AUDIO_EXT or path.name.startswith("."):
            return
        if str(path) in self.seen:
            return
        self.seen.add(str(path))
        self.queue.put(path)
        try:
            _state().file_seen()
        except Exception:
            pass

    def scan(self) -> None:
        for p in sorted(self.inbox.iterdir()):
            if p.is_file():
                self.offer(p)

    # ----- worker -----
    def _wait_stable(self, path: Path) -> bool:
        last = -1
        for i in range(60):
            if not path.exists():
                return False
            size = path.stat().st_size
            if size == last and (size > 0 or i >= 3):  # an empty file counts as stable after 3 checks
                return True
            last = size
            time.sleep(STABLE_S)
        return True

    def handle(self, path: Path) -> str:
        from app.pipeline.run import _set_status, process, register

        if not self._wait_stable(path):
            return "gone"
        audio = path
        if needs_conversion(path):
            try:
                audio = convert(path)
            except ValueError as exc:
                call, _ = register(path)  # visible as failed, with what to do
                _set_status(call.id, "failed", str(exc))
                return "failed"
        call, is_new = register(audio)
        if not is_new:
            log.info("Duplicate recording %s (same audio as call %s), skipped", path.name, call.id)
            return "duplicate"
        started = time.monotonic()
        summary = process([call.id])
        log.info("Processed %s in %.0f s: %s", call.id, time.monotonic() - started,
                 "done" if summary.done else "waiting_for_asr" if summary.waiting_for_asr else "failed")
        return "done" if summary.done else "waiting" if summary.waiting_for_asr else "failed"

    def _work(self) -> None:
        while not self._stop.is_set():
            try:
                path = self.queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self.handle(path)
            except Exception:
                log.exception("Watcher failed on %s", path.name)
            finally:
                self.queue.task_done()

    def _poll(self) -> None:
        while not self._stop.wait(self.poll_interval_s):
            if self.watching:
                self.scan()

    # ----- control -----
    def start(self) -> None:
        self.inbox.mkdir(parents=True, exist_ok=True)
        watcher = self

        class Handler(FileSystemEventHandler):
            def on_created(self, event: FileSystemEvent) -> None:
                if not event.is_directory and watcher.watching:
                    watcher.offer(Path(str(event.src_path)))

            def on_moved(self, event: FileSystemEvent) -> None:  # files moved or renamed into the folder
                if not event.is_directory and watcher.watching:
                    watcher.offer(Path(str(event.dest_path)))

        self._observer = Observer()
        self._observer.schedule(Handler(), str(self.inbox), recursive=False)
        self._observer.start()
        self._threads = [threading.Thread(target=self._work, name="inbox-worker", daemon=True),
                         threading.Thread(target=self._poll, name="inbox-poll", daemon=True)]
        for t in self._threads:
            t.start()
        self.set_watching(True)

    def set_watching(self, watching: bool) -> None:
        """Pause / resume. Files dropped while paused are picked up on resume (scan)."""
        self.watching = watching
        try:
            _state().set_watching(watching, self.poll_interval_s)
        except Exception:
            pass
        if watching:
            self.scan()

    def stop(self) -> None:
        self.set_watching(False)
        self._stop.set()
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)


_watcher: InboxWatcher | None = None


def get_watcher() -> InboxWatcher | None:
    """The running watcher, or None when it is not started (WATCHER_ENABLED=false, CLI scripts)."""
    return _watcher


def start_watcher() -> InboxWatcher | None:
    """App startup: a fresh watcher on the current INBOX_DIR (settings may differ between app instances)."""
    global _watcher
    if not get_settings().watcher_enabled:
        return None
    stop_watcher()
    _watcher = InboxWatcher()
    _watcher.start()
    return _watcher


def stop_watcher() -> None:
    global _watcher
    if _watcher is not None:
        _watcher.stop()
        _watcher = None


def set_watching(enabled: bool) -> bool:
    """For POST /pipeline/watch: pause (False) or resume (True). Returns the resulting state."""
    w = get_watcher()
    if w is None:
        return False
    w.set_watching(enabled)
    return w.watching
