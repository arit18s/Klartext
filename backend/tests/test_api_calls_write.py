"""B25: POST /calls/{id}/feedback, /recheck, /retry and GET /calls/{id}/history."""

from __future__ import annotations

import json

import pytest
from sqlmodel import Session, select

from app.api import jobs
from app.models.tables import AuditLog, Call, Feedback
from tests.test_api_support import client, data_dir, engine, seeded  # noqa: F401

LABELS = ["correct", "false_alarm", "missed", "escalated_to_alarm", "closed_no_alert", "note"]


@pytest.fixture
def ran(monkeypatch):
    """Background jobs run inline; the pipeline itself is replaced by a recorder."""
    calls = []
    monkeypatch.setattr(jobs, "submit", lambda name, fn: fn())
    monkeypatch.setattr("app.pipeline.run.process", lambda ids, from_stage="asr": calls.append((ids, from_stage)))
    return calls


def audit_rows(engine, target):
    with Session(engine) as s:
        return list(s.exec(select(AuditLog).where(AuditLog.target == target).order_by(AuditLog.id)))


# ---------- feedback ----------

@pytest.mark.parametrize("label", LABELS)
def test_feedback_all_labels(client, seeded, label):
    r = client.post("/api/calls/Stufe2_C09-K3/feedback", json={"label": label, "note": "  Checked with the advisor.  "})
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"id", "call_id", "label", "note", "created_at"}
    assert body["label"] == label and body["note"] == "Checked with the advisor." and body["created_at"].endswith("Z")
    (row,) = audit_rows(seeded, "call:Stufe2_C09-K3")[-1:]
    assert row.action == "feedback" and json.loads(row.details_json) == {"label": label, "note": "Checked with the advisor."}
    detail = client.get("/api/calls/Stufe2_C09-K3").json()
    assert detail["feedback"][-1]["id"] == body["id"] and detail["call"]["feedback_label"] == label


def test_feedback_note_optional_except_for_label_note(client):
    r = client.post("/api/calls/Stufe2_C09-K3/feedback", json={"label": "correct"})
    assert r.status_code == 201 and r.json()["note"] is None
    for note in (None, "", "   "):
        r = client.post("/api/calls/Stufe2_C09-K3/feedback", json={"label": "note", "note": note})
        assert r.status_code == 422 and r.json()["detail"] == "A note needs text. Write the note and save it again."


@pytest.mark.parametrize("body", [{"label": "wrong"}, {"label": "correct", "note": "x" * 2001}, {}])
def test_feedback_invalid_is_422_with_plain_detail(client, body):
    r = client.post("/api/calls/Stufe2_C09-K3/feedback", json=body)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_feedback_note_of_2000_chars_ok_and_unknown_call_404(client, seeded):
    assert client.post("/api/calls/Stufe2_C09-K3/feedback", json={"label": "note", "note": "x" * 2000}).status_code == 201
    assert client.post("/api/calls/Nope/feedback", json={"label": "correct"}).status_code == 404
    with Session(seeded) as s:
        assert len(s.exec(select(Feedback)).all()) == 1


# ---------- recheck / retry ----------

def test_recheck_runs_from_checks(client, seeded, data_dir, ran):
    (data_dir / "roles").mkdir()
    (data_dir / "roles" / "Stufe2_C09-K3.json").write_text("{}", encoding="utf-8")
    r = client.post("/api/calls/Stufe2_C09-K3/recheck")
    assert r.status_code == 202 and r.json() == {"call_id": "Stufe2_C09-K3", "status": "checking"}
    assert ran == [(["Stufe2_C09-K3"], "checks")]
    assert audit_rows(seeded, "call:Stufe2_C09-K3")[-1].action == "recheck"


def test_recheck_needs_a_transcript_and_a_finished_call(client, seeded, data_dir, ran):
    r = client.post("/api/calls/Stufe2_C09-K3/recheck")
    assert r.status_code == 409 and "no transcript" in r.json()["detail"]
    with Session(seeded) as s:
        s.add(Call(id="Busy-K1", file_path="/x.wav", file_hash="b", status="checking"))
        s.commit()
    assert client.post("/api/calls/Busy-K1/recheck").status_code == 409
    assert client.post("/api/calls/Nope/recheck").status_code == 404
    assert ran == []


def test_retry_failed_call(client, seeded, ran):
    with Session(seeded) as s:
        s.add(Call(id="Bad-K2", file_path="/x.wav", file_hash="b", status="failed", error="Transcription failed."))
        s.commit()
    r = client.post("/api/calls/Bad-K2/retry")
    assert r.status_code == 202 and r.json() == {"call_id": "Bad-K2", "status": "queued"}
    assert ran == [(["Bad-K2"], "asr")]
    with Session(seeded) as s:
        call = s.get(Call, "Bad-K2")
        assert call.status == "queued" and call.error is None
    row = audit_rows(seeded, "call:Bad-K2")[-1]
    assert row.action == "retry" and json.loads(row.details_json) == {"error": "Transcription failed."}


def test_retry_not_failed_is_409(client, ran):
    r = client.post("/api/calls/Stufe2_C09-K3/retry")
    assert r.status_code == 409 and r.json()["detail"] == "Stufe2_C09-K3 has not failed, so there is nothing to retry."
    assert ran == []


# ---------- history ----------

def test_history_newest_first(client, seeded):
    client.post("/api/calls/Stufe2_C09-K3/feedback", json={"label": "correct"})
    client.post("/api/calls/Stufe2_C09-K3/feedback", json={"label": "note", "note": "Second"})
    with Session(seeded) as s:
        s.add(AuditLog(actor="system", action="config_changed", target="thresholds:9"))
        s.commit()
    body = client.get("/api/calls/Stufe2_C09-K3/history").json()
    assert [h["details"]["label"] for h in body] == ["note", "correct"]
    assert set(body[0]) == {"id", "actor", "action", "target", "details", "created_at"}
    assert body[0]["actor"] == "Compliance officer" and body[0]["target"] == "call:Stufe2_C09-K3"
    assert client.get("/api/calls/Nope/history").status_code == 404
