"""B25: POST /pipeline/watch, /pipeline/inbox, /pipeline/process-folder and GET /pipeline/export."""

from __future__ import annotations

import csv
import io
import json

import pytest
from sqlmodel import Session, select

from app.api import jobs
from app.api.pipeline import MAX_UPLOAD, safe_stem
from app.models.tables import AuditLog, Call
from tests.test_api_support import client, data_dir, engine, seeded, write_wav  # noqa: F401


@pytest.fixture
def ran(monkeypatch):
    calls = []
    monkeypatch.setattr(jobs, "submit", lambda name, fn: fn())
    monkeypatch.setattr("app.pipeline.run.process", lambda ids, from_stage="asr": calls.append(list(ids)))
    return calls


def wav_bytes(tmp_path, seconds=0.2, name="x.wav") -> bytes:
    return write_wav(tmp_path / "src" / name, seconds).read_bytes()


# ---------- watch ----------

def test_watch_without_watcher_reports_false(client, seeded):
    r = client.post("/api/pipeline/watch", json={"enabled": True})
    assert r.status_code == 200 and r.json() == {"watching": False}  # WATCHER_ENABLED=false in tests
    with Session(seeded) as s:
        row = s.exec(select(AuditLog).where(AuditLog.action == "watch")).one()
    assert json.loads(row.details_json) == {"requested": True, "watching": False}


def test_watch_passes_through_to_watcher(client, monkeypatch):
    monkeypatch.setattr("app.services.watcher.set_watching", lambda enabled: enabled)
    assert client.post("/api/pipeline/watch", json={"enabled": False}).json() == {"watching": False}
    assert client.post("/api/pipeline/watch", json={"enabled": True}).json() == {"watching": True}
    assert client.post("/api/pipeline/watch", json={"enabled": "maybe"}).status_code == 422


# ---------- inbox ----------

def test_inbox_writes_safe_name(client, data_dir, tmp_path):
    data = wav_bytes(tmp_path)
    r = client.post("/api/pipeline/inbox", files={"file": ("../../etc/Stufe2 C09-K4.wav", data, "audio/wav")})
    assert r.status_code == 202 and r.json() == {"file_name": "Stufe2_C09-K4.wav", "queued": True, "duplicate": False}
    inbox = tmp_path / "inbox"
    assert sorted(p.name for p in inbox.iterdir()) == ["Stufe2_C09-K4.wav"]
    assert (inbox / "Stufe2_C09-K4.wav").read_bytes() == data


def test_inbox_name_clash_gets_suffix(client, tmp_path):
    first = client.post("/api/pipeline/inbox", files={"file": ("Stufe2_C09-K3.wav", wav_bytes(tmp_path, 0.3), "audio/wav")})
    # Stufe2_C09-K3 is already a call ID in the seeded DB
    assert first.json()["file_name"] == "Stufe2_C09-K3_2.wav"
    second = client.post("/api/pipeline/inbox", files={"file": ("Stufe2_C09-K3.wav", wav_bytes(tmp_path, 0.4), "audio/wav")})
    assert second.json()["file_name"] == "Stufe2_C09-K3_3.wav"


def test_inbox_duplicate_of_known_call(client, seeded, tmp_path):
    with Session(seeded) as s:
        known = s.get(Call, "Stufe2_C09-K3")
        data = open(known.file_path, "rb").read()
        import hashlib
        known.file_hash = hashlib.sha256(data).hexdigest()
        s.add(known)
        s.commit()
    r = client.post("/api/pipeline/inbox", files={"file": ("copy.wav", data, "audio/wav")})
    assert r.status_code == 202 and r.json() == {"file_name": "copy.wav", "queued": False, "duplicate": True}
    assert list((tmp_path / "inbox").iterdir()) == []


@pytest.mark.parametrize("name, data, ctype", [
    ("notes.txt", b"hello", "text/plain"),
    ("fake.wav", b"ID3\x03not a wav at all", "audio/wav"),
    ("empty.wav", b"", "audio/wav"),
])
def test_inbox_rejects_non_wav(client, tmp_path, name, data, ctype):
    r = client.post("/api/pipeline/inbox", files={"file": (name, data, ctype)})
    assert r.status_code == 415 and r.json()["detail"] == f"{name} is not a WAV file. Convert it to WAV and drop it again."
    assert [p for p in (tmp_path / "inbox").iterdir()] == [] if (tmp_path / "inbox").exists() else True


def test_inbox_too_large(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.pipeline.MAX_UPLOAD", 1000)
    r = client.post("/api/pipeline/inbox", files={"file": ("big.wav", wav_bytes(tmp_path, 1.0), "audio/wav")})
    assert r.status_code == 413 and "larger than 200 MB" in r.json()["detail"]
    assert list((tmp_path / "inbox").iterdir()) == []
    assert MAX_UPLOAD == 200 * 1024 * 1024


def test_inbox_missing_file_field(client):
    r = client.post("/api/pipeline/inbox", data={"other": "x"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


@pytest.mark.parametrize("raw, stem", [("a/b/c.wav", "c"), ("C:\\\\x\\\\y.WAV", "y"), ("..wav", "recording"),
                                       ("name with spaces & ;.wav", "name_with_spaces"), ("x.mp3", "x")])
def test_safe_stem(raw, stem):
    assert safe_stem(raw) == stem


# ---------- process-folder ----------

def test_process_folder_registers_and_processes_new(client, data_dir, ran):
    folder = data_dir / "hidden-test-set"
    write_wav(folder / "A1.wav", 0.2)
    write_wav(folder / "B2.wav", 0.3)
    (folder / "notes.txt").write_text("x")
    (folder / ".hidden.wav").write_text("x")
    r = client.post("/api/pipeline/process-folder", json={"path": str(folder)})
    assert r.status_code == 202
    assert r.json() == {"path": str(folder), "enqueued": 2, "skipped_duplicates": 0,
                        "rejected": [{"file_name": "notes.txt", "error": "Not an audio file."}]}
    assert ran == [["A1", "B2"]]
    again = client.post("/api/pipeline/process-folder", json={"path": "hidden-test-set"}).json()  # relative to DATA_DIR
    assert again["enqueued"] == 0 and again["skipped_duplicates"] == 2 and ran == [["A1", "B2"]]


def test_process_folder_confined(client, tmp_path, ran):
    (tmp_path / "outside").mkdir()
    r = client.post("/api/pipeline/process-folder", json={"path": str(tmp_path / "outside")})
    assert r.status_code == 422 and "outside the allowed folders" in r.json()["detail"]
    assert client.post("/api/pipeline/process-folder", json={"path": "../../"}).status_code == 422
    assert client.post("/api/pipeline/process-folder", json={"path": "missing"}).status_code == 404
    assert ran == []


# ---------- export ----------

def test_export_json(client, seeded):
    r = client.get("/api/pipeline/export?format=json")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    rows = r.json()
    assert [x["call_id"] for x in rows] == ["Stufe2_C09-K3", "Stufe2_C10-K3", "Stufe3_C17-K3"]
    c09 = rows[0]
    assert set(c09) == {"call_id", "file_name", "verdict", "family", "score", "reason", "open_question", "evidence"}
    assert (c09["verdict"], c09["family"], c09["score"]) == ("alarm", "access", 91)
    assert c09["evidence"] == [{"role": "context", "start_s": 31.0, "end_s": 45.0}, {"role": "context", "start_s": 96.0, "end_s": 100.0},
                               {"role": "trigger", "start_s": 101.0, "end_s": 108.0}]
    assert client.get("/api/pipeline/export").json() == rows


def test_export_csv(client, seeded):
    with Session(seeded) as s:
        s.add(Call(id="New-K1", file_path="/x/New-K1.wav", file_hash="n", status="queued"))
        s.commit()
    r = client.get("/api/pipeline/export?format=csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert list(rows[0]) == ["call_id", "file_name", "verdict", "family", "score", "reason", "open_question", "evidence"]
    c09 = next(x for x in rows if x["call_id"] == "Stufe2_C09-K3")
    assert c09["evidence"] == "context:31-45;context:96-100;trigger:101-108" and c09["score"] == "91"
    new = next(x for x in rows if x["call_id"] == "New-K1")
    assert new["verdict"] == "" and new["evidence"] == ""
    assert client.get("/api/pipeline/export?format=xml").status_code == 422
