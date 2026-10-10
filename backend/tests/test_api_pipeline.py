"""B24: GET /pipeline/status. No frontend fixture file exists for it, so the shape is the API_CONTRACT.md example."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlmodel import Session

from app.api import pipeline_state
from app.models.tables import Call
from tests.test_api_support import assert_shape, client, data_dir, empty_client, engine, seeded  # noqa: F401

ITEM = {"call_id": "Stufe2_C11-K4", "file_name": "Stufe2_C11-K4.wav", "stage": "checking", "progress": 0.7,
        "progress_note": "4 of 6 checks", "duration_s": 322.0, "elapsed_s": 41.0, "verdict": None, "score": None,
        "trigger_sent": False, "error": None, "updated_at": "2026-10-10T08:44:30Z"}
CONTRACT_EXAMPLE = {
    "watching": True, "inbox_dir": "/data/klartext/inbox", "poll_interval_s": 5, "last_file_at": "2026-10-10T08:40:00Z",
    "queue": [ITEM], "recent": [{**ITEM, "stage": "done", "verdict": "alarm", "score": 91, "trigger_sent": True}],
    "last_batch": {"files": 60, "failed": 0, "duration_s": 3480.0, "finished_at": "2026-10-10T06:58:00Z"},
}


def test_status_shape_from_db(client, seeded, data_dir):
    now = datetime.now(timezone.utc)
    with Session(seeded) as s:
        s.add(Call(id="New-K1", file_path=str(data_dir / "New-K1.wav"), file_hash="n", status="transcribing", created_at=now))
        s.add(Call(id="Bad-K2", file_path=str(data_dir / "Bad-K2.wav"), file_hash="b", status="failed",
                   error="Transcription failed for Bad-K2. The file is not 16 kHz mono.", created_at=now - timedelta(minutes=1)))
        s.commit()
    body = client.get("/api/pipeline/status").json()
    assert_shape(body, CONTRACT_EXAMPLE)
    assert body["watching"] is False and body["last_batch"] is None  # no watcher until B26
    assert body["inbox_dir"].endswith("inbox") and body["last_file_at"] is not None
    assert [i["call_id"] for i in body["queue"]] == ["Bad-K2", "New-K1"]
    bad, new = body["queue"]
    assert bad["stage"] == "failed" and bad["error"].startswith("Transcription failed") and bad["file_name"] == "Bad-K2.wav"
    assert new["stage"] == "transcribing" and 0 < new["progress"] < 1 and new["verdict"] is None
    recent = body["recent"]
    assert [i["call_id"] for i in recent] == ["Stufe2_C09-K3", "Stufe2_C10-K3", "Stufe3_C17-K3"]  # newest first
    assert recent[0] | {"elapsed_s": None} == {
        "call_id": "Stufe2_C09-K3", "file_name": "Stufe2_C09-K3.wav", "stage": "done", "progress": 1.0, "progress_note": None,
        "duration_s": 192.0, "elapsed_s": None, "verdict": "alarm", "score": 91, "trigger_sent": True, "error": None,
        "updated_at": "2026-10-10T08:42:00Z"}


def test_status_uses_reported_progress_and_watcher_state(client, seeded):
    with Session(seeded) as s:
        s.add(Call(id="Run-K3", file_path="/x/Run-K3.wav", file_hash="r", status="checking"))
        s.commit()
    pipeline_state.set_watching(True, poll_interval_s=2)
    pipeline_state.file_seen(datetime(2026, 10, 10, 8, 40, tzinfo=timezone.utc))
    pipeline_state.report_progress("Run-K3", "deciding", 0.9, "Deciding")
    pipeline_state.batch_finished(files=60, failed=1, duration_s=3480.0)
    body = client.get("/api/pipeline/status").json()
    assert_shape(body, CONTRACT_EXAMPLE)
    assert body["watching"] is True and body["poll_interval_s"] == 2 and body["last_file_at"] == "2026-10-10T08:40:00Z"
    item = body["queue"][0]
    assert (item["stage"], item["progress"], item["progress_note"]) == ("deciding", 0.9, "Deciding")
    assert body["last_batch"]["files"] == 60 and body["last_batch"]["failed"] == 1


def test_recent_keeps_last_20(client, seeded):
    base = datetime(2026, 10, 11, tzinfo=timezone.utc)
    with Session(seeded) as s:
        for i in range(25):
            s.add(Call(id=f"Done-{i:02d}", file_path=f"/x/Done-{i:02d}.wav", file_hash=f"d{i}", status="done",
                       processed_at=base + timedelta(minutes=i)))
        s.commit()
    recent = client.get("/api/pipeline/status").json()["recent"]
    assert len(recent) == 20 and recent[0]["call_id"] == "Done-24" and recent[0]["verdict"] is None


def test_empty_db(empty_client):
    body = empty_client.get("/api/pipeline/status").json()
    assert body["queue"] == [] and body["recent"] == [] and body["last_file_at"] is None
