"""Inbox watcher intake: a file that left the inbox is forgotten, so the same name can be dropped again (demo retakes)."""

from __future__ import annotations

from pathlib import Path

from app.services.watcher import InboxWatcher


def test_same_name_dropped_again_after_removal_is_offered_again(tmp_path: Path):
    w = InboxWatcher(inbox=tmp_path)
    wav = tmp_path / "demo_call.wav"
    wav.write_bytes(b"RIFF0000")
    w.scan()
    w.scan()  # still there: offered once only
    assert w.queue.qsize() == 1
    wav.unlink()
    w.scan()
    assert str(wav.resolve()) not in w.seen
    wav.write_bytes(b"RIFF0000")  # the retake: same name, new copy
    w.scan()
    assert w.queue.qsize() == 2
