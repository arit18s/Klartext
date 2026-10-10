"""B24: GET /calls, /calls/{id}, /calls/{id}/audio, /calls/{id}/snippets/{seg_id} against API_CONTRACT.md."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlmodel import Session

from app.models.tables import Call, Evidence, Feedback, Segment
from tests.test_api_support import assert_shape, client, data_dir, details, engine, load_fixture, seeded, write_wav  # noqa: F401


# ---------- GET /calls ----------

def test_list_matches_fixture(client):
    fx = load_fixture("calls.json")
    body = client.get("/api/calls").json()
    assert_shape(body, fx)
    assert body["items"] == fx["items"]
    assert {k: v for k, v in body["counts"].items() if k != "checked_today"} == {k: v for k, v in fx["counts"].items() if k != "checked_today"}


def test_list_sorted_by_verdict_then_score(client, seeded):
    with Session(seeded) as s:
        s.add(Call(id="Unknown_file", file_path="/nowhere/x.wav", file_hash="u", status="queued"))
        s.commit()
    ids = [i["call_id"] for i in client.get("/api/calls").json()["items"]]
    assert ids == ["Stufe2_C09-K3", "Stufe3_C17-K3", "Stufe2_C10-K3", "Unknown_file"]


def test_undecided_call_has_null_decision_fields(client, seeded):
    with Session(seeded) as s:
        s.add(Call(id="Unknown_file", file_path="/nowhere/x.wav", file_hash="u", status="failed", error="Transcription failed."))
        s.commit()
    item = client.get("/api/calls").json()["items"][-1]
    assert item["dialogue_id"] is item["variant"] is item["level"] is None
    assert all(item[k] is None for k in ("verdict", "family", "score", "reason", "open_question", "expected_verdict"))
    assert item["file_name"] == "x.wav" and item["error"] == "Transcription failed." and item["trigger_sent"] is False


@pytest.mark.parametrize("query, expected", [
    ("verdict=alarm,review", ["Stufe2_C09-K3", "Stufe3_C17-K3"]),
    ("flagged_only=true", ["Stufe2_C09-K3", "Stufe3_C17-K3"]),
    ("family=access", ["Stufe2_C09-K3", "Stufe3_C17-K3", "Stufe2_C10-K3"]),
    ("level=3", ["Stufe3_C17-K3"]),
    ("variant=noisy", []),
    ("q=c10", ["Stufe2_C10-K3"]),
    ("since=2026-10-10T08:40:00Z", ["Stufe2_C09-K3"]),
    ("since=2026-10-10T08:37:00Z", ["Stufe2_C09-K3", "Stufe2_C10-K3"]),
])
def test_list_filters(client, query, expected):
    body = client.get(f"/api/calls?{query}").json()
    assert [i["call_id"] for i in body["items"]] == expected
    assert body["counts"]["total"] == 3  # counts ignore the filters


def test_list_filters_by_advisor_and_transcript_text(client):
    advisor = details()["Stufe3_C17-K3"]["call"]["advisor_name"]
    assert [i["call_id"] for i in client.get("/api/calls", params={"advisor": advisor}).json()["items"]] == ["Stufe3_C17-K3"]
    word = details()["Stufe3_C17-K3"]["segments"][-1]["text"].split()[0]
    ids = [i["call_id"] for i in client.get("/api/calls", params={"q": word}).json()["items"]]
    assert "Stufe3_C17-K3" in ids


@pytest.mark.parametrize("query", ["verdict=maybe", "family=numbers", "level=4", "since=yesterday"])
def test_list_rejects_invalid_filters(client, query):
    r = client.get(f"/api/calls?{query}")
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_checked_today_counts_calls_processed_today(client, seeded):
    with Session(seeded) as s:
        call = s.get(Call, "Stufe2_C10-K3")
        call.processed_at = datetime.now(timezone.utc)
        s.add(call)
        s.commit()
    assert client.get("/api/calls").json()["counts"]["checked_today"] >= 1


# ---------- GET /calls/{id} ----------

@pytest.mark.parametrize("call_id", ["Stufe2_C09-K3", "Stufe2_C10-K3", "Stufe3_C17-K3"])
def test_detail_matches_fixture(client, call_id):
    fx = details()[call_id]
    body = client.get(f"/api/calls/{call_id}").json()
    assert_shape(body, fx)
    ids = [e.pop("id") for e in body["evidence"]]
    assert len(set(ids)) == len(ids)
    for e in fx["evidence"]:
        e.pop("id")
    assert body == fx


def test_detail_never_exposes_paths(client):
    text = client.get("/api/calls/Stufe2_C09-K3").text
    assert "file_path" not in text and "snippet_path" not in text and "Audio/" not in text


def test_detail_unknown_call_is_404(client):
    r = client.get("/api/calls/Nope-K1")
    assert r.status_code == 404 and "Nope-K1" in r.json()["detail"]


def test_detail_feedback_oldest_first_and_latest_label_in_summary(client, seeded):
    with Session(seeded) as s:
        s.add(Feedback(call_id="Stufe2_C09-K3", label="correct", created_at=datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)))
        s.add(Feedback(call_id="Stufe2_C09-K3", label="note", note="Checked with the advisor.", created_at=datetime(2026, 10, 10, 9, 5, tzinfo=timezone.utc)))
        s.commit()
    body = client.get("/api/calls/Stufe2_C09-K3").json()
    assert [f["label"] for f in body["feedback"]] == ["correct", "note"]
    assert body["feedback"][1]["created_at"] == "2026-10-10T09:05:00Z"
    assert body["call"]["feedback_label"] == "note"
    assert client.get("/api/calls").json()["items"][0]["feedback_label"] == "note"


def test_detail_evidence_falls_back_to_check_stage_output(client, seeded, data_dir):
    """Before B20 fills the evidence table, evidence comes from data/checks/<call_id>.json, placed on its segment."""
    with Session(seeded) as s:
        for e in s.exec(Evidence.__table__.select().where(Evidence.call_id == "Stufe2_C09-K3")).all():  # type: ignore[attr-defined]
            s.delete(s.get(Evidence, e.id))
        seg = s.exec(Segment.__table__.select().where(Segment.call_id == "Stufe2_C09-K3", Segment.seg_id == "S004")).first()  # type: ignore[attr-defined]
        s.commit()
    import json
    (data_dir / "checks").mkdir()
    quote = seg.text[:20]
    (data_dir / "checks" / "Stufe2_C09-K3.json").write_text(json.dumps({"checks": {"families": {"access": {"evidence": [
        {"seg_id": "S004", "role": "trigger", "quote": quote, "note": "Why it matters."},
        {"seg_id": "S999", "role": "context", "quote": "not in the call", "note": ""},
    ]}}}}), encoding="utf-8")
    ev = client.get("/api/calls/Stufe2_C09-K3").json()["evidence"]
    assert ev == [{"id": 1, "family": "access", "seg_id": "S004", "role": "trigger", "start_s": seg.start_s, "end_s": seg.end_s,
                   "speaker_role": seg.role, "quote": quote, "note": "Why it matters.",
                   "snippet_url": "/api/calls/Stufe2_C09-K3/snippets/S004"}]


# ---------- audio ----------

def test_audio_full_and_range(client):
    full = client.get("/api/calls/Stufe2_C09-K3/audio")
    assert full.status_code == 200 and full.headers["content-type"] == "audio/wav"
    assert full.content[:4] == b"RIFF" and full.headers.get("accept-ranges") == "bytes"
    part = client.get("/api/calls/Stufe2_C09-K3/audio", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert part.headers["content-range"] == f"bytes 0-99/{len(full.content)}"
    tail = client.get("/api/calls/Stufe2_C09-K3/audio", headers={"Range": "bytes=-10"})
    assert tail.status_code == 206 and tail.content == full.content[-10:]


def test_audio_missing_file_or_outside_allowed_folders_is_404(client, seeded, tmp_path):
    outside = write_wav(tmp_path / "elsewhere" / "x.wav")
    with Session(seeded) as s:
        s.add(Call(id="Outside", file_path=str(outside), file_hash="o", status="done"))
        s.add(Call(id="Gone", file_path=str(tmp_path / "data" / "gone.wav"), file_hash="g", status="done"))
        s.commit()
    assert client.get("/api/calls/Outside/audio").status_code == 404
    assert client.get("/api/calls/Gone/audio").status_code == 404
    assert client.get("/api/calls/Nope/audio").status_code == 404


# ---------- snippets ----------

def test_snippet_served_from_data_dir(client, seeded, data_dir):
    snippet = write_wav(data_dir / "snippets" / "Stufe2_C09-K3_S009.wav", 0.5)
    with Session(seeded) as s:
        e = s.exec(Evidence.__table__.select().where(Evidence.call_id == "Stufe2_C09-K3", Evidence.seg_id == "S009")).first()  # type: ignore[attr-defined]
        row = s.get(Evidence, e.id)
        row.snippet_path = str(snippet)
        s.add(row)
        s.commit()
    r = client.get("/api/calls/Stufe2_C09-K3/snippets/S009")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content == snippet.read_bytes()


def test_snippet_missing_is_404(client, seeded, tmp_path):
    outside = write_wav(tmp_path / "elsewhere" / "s.wav")
    with Session(seeded) as s:
        s.add(Evidence(call_id="Stufe2_C09-K3", family="access", seg_id="S001", role="context", start_s=0, end_s=1, quote="x",
                       snippet_path=str(outside)))
        s.commit()
    assert client.get("/api/calls/Stufe2_C09-K3/snippets/S009").status_code == 404  # no snippet cut yet
    assert client.get("/api/calls/Stufe2_C09-K3/snippets/S001").status_code == 404  # outside DATA_DIR
    assert client.get("/api/calls/Stufe2_C09-K3/snippets/..%2F..%2Fetc").status_code == 404
    assert client.get("/api/calls/Nope/snippets/S001").status_code == 404
