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


import shutil
import subprocess

import pytest
import soundfile as sf

from app.services.watcher import convert, needs_conversion


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
@pytest.mark.parametrize("ext, video", [(".mp3", False), (".mp4", True), (".m4a", False)])
def test_convert_other_formats_to_16k_mono_wav(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, ext: str, video: bool):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.config import get_settings
    get_settings.cache_clear()
    src = tmp_path / f"take{ext}"
    tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=44100"]
    picture = ["-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-shortest"] if video else []
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *tone, *picture, "-ac", "2", str(src)], check=True)
    assert needs_conversion(src)
    out = convert(src)
    info = sf.info(str(out))
    assert (out.suffix, info.samplerate, info.channels) == (".wav", 16000, 1)
    assert 0.9 < info.duration < 1.2
    get_settings.cache_clear()
