"""Shared pytest fixtures for the read API tests (B24). Holds no tests itself.

The test DB is seeded from the frontend fixtures (`frontend/src/fixtures/*.json`), so a response can be compared
with the fixture it was built from: same shape, and the same values wherever they come straight from the DB.
Every test runs on a fresh temporary DATA_DIR; the real data is never touched.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.models.tables import (
    Call, CheckResult, CheckRun, ConfigVersion, Decision, Evidence, KeywordHit, Segment, TriggerSent,
)

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "src" / "fixtures"
DETAIL_FILES = ["call_detail_Stufe2_C09-K3.json", "call_detail_Stufe2_C10-K3.json", "call_detail_Stufe3_C17-K3.json"]
SECRET = "sk-test-not-a-real-key-123"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def details() -> dict[str, dict[str, Any]]:
    return {d["call"]["call_id"]: d for d in map(load_fixture, DETAIL_FILES)}


def ts(value: str | None) -> datetime | None:
    return None if value is None else datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def assert_shape(actual: Any, expected: Any, path: str = "$", open_keys: tuple[str, ...] = ()) -> None:
    """Same keys at every level, compatible JSON types; null fits any type. Dicts under `open_keys` may differ in keys."""
    if expected is None or actual is None:
        return
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected an object, got {type(actual).__name__}"
        if path.rsplit(".", 1)[-1] not in open_keys:
            assert set(actual) == set(expected), f"{path}: keys differ: missing {set(expected) - set(actual)}, extra {set(actual) - set(expected)}"
        for key in set(actual) & set(expected):
            assert_shape(actual[key], expected[key], f"{path}.{key}", open_keys)
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected a list, got {type(actual).__name__}"
        if expected:
            for i, item in enumerate(actual):
                assert_shape(item, expected[min(i, len(expected) - 1)], f"{path}[{i}]", open_keys)
    elif isinstance(expected, bool):
        assert isinstance(actual, bool), f"{path}: expected a boolean, got {actual!r}"
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), f"{path}: expected a number, got {actual!r}"
    elif isinstance(expected, str):
        assert isinstance(actual, str), f"{path}: expected a string, got {actual!r}"


def write_wav(path: Path, seconds: float = 1.0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.zeros(int(16000 * seconds), dtype="float32"), 16000, subtype="PCM_16")
    return path


def seed_configs(session: Session) -> None:
    families = {name: {k: v for k, v in fam.items() if k not in ("changed_at", "changed_by")}
                for name, fam in load_fixture("families.json")["families"].items()}
    keywords = load_fixture("keywords.json")
    scores = load_fixture("scores.json")["thresholds"]
    fam_fx = load_fixture("families.json")
    session.add(ConfigVersion(id=1, kind="keywords", json_data=json.dumps(keywords["keywords"], ensure_ascii=False),
                              note=keywords["note"], created_at=ts(keywords["created_at"]), active=True))
    session.add(ConfigVersion(id=2, kind="families", json_data=json.dumps(families, ensure_ascii=False),
                              note=fam_fx["note"], created_at=ts(fam_fx["created_at"]), active=True))
    session.add(ConfigVersion(id=3, kind="thresholds", json_data=json.dumps({"review": scores["review"], "alarm": scores["alarm"]}),
                              note=scores["note"], created_at=ts(scores["created_at"]), active=True))


def seed_call(session: Session, detail: dict[str, Any], audio_dir: Path, id_offset: int = 0) -> None:
    """Fixture evidence IDs restart at 1 per call; `id_offset` keeps them unique in one DB."""
    c, d = detail["call"], detail["decision"]
    call_id = c["call_id"]
    wav = write_wav(audio_dir / c["file_name"])
    session.add(Call(id=call_id, file_path=str(wav), file_hash=call_id, dialogue_id=c["dialogue_id"], variant=c["variant"],
                     level=c["level"], duration_s=c["duration_s"], advisor_name=c["advisor_name"], status=c["status"],
                     error=c["error"], created_at=ts(c["created_at"]), processed_at=ts(c["processed_at"])))
    for s in detail["segments"]:
        session.add(Segment(call_id=call_id, **s))
    if d:
        twin = detail["twin"] or {}
        session.add(Decision(call_id=call_id, verdict=d["verdict"], family=d["family"], score=d["score"], reason=d["reason"],
                             reason_de=d["reason_de"], open_question=d["open_question"], asr_uncertain=d["asr_uncertain"],
                             twin_call_id=twin.get("call_id"), twin_note=twin.get("note"),
                             thresholds_version_id=d["thresholds_version_id"], decided_at=ts(d["decided_at"])))
    hits_by_family: dict[str, list[dict]] = {}
    for h in detail["keyword_hits"]:
        session.add(KeywordHit(call_id=call_id, config_version_id=1, keyword_id=h["keyword_id"], family=h["family"] or "",
                               phrase=h["phrase"], seg_id=h["seg_id"], start_s=h["start_s"], end_s=h["end_s"]))
        if h["label"]:
            hits_by_family.setdefault(h["family"], []).append(
                {"keyword_id": h["keyword_id"], "seg_id": h["seg_id"], "label": h["label"]})
    for ch in detail["checks"]:
        session.add(CheckResult(call_id=call_id, **{k: v for k, v in ch.items() if k != "samples"}))
        judgements = hits_by_family.get(ch["family"], [])
        for i in range(ch["samples"]):
            sample = {"event": "absent", "keyword_judgements": judgements}
            session.add(CheckRun(call_id=call_id, family=ch["family"], sample_idx=i, model="test-model", config_version_id=2,
                                 output_json=json.dumps({"sample_idx": i, "valid": True, "sample": sample}), valid=True))
        # one failed sample per family: it must not count towards `samples`
        session.add(CheckRun(call_id=call_id, family=ch["family"], sample_idx=99, model="test-model", config_version_id=2,
                             output_json=json.dumps({"sample_idx": 99, "valid": False, "sample": None}), valid=False))
    for e in detail["evidence"]:
        row = {k: v for k, v in e.items() if k != "snippet_url"}
        session.add(Evidence(call_id=call_id, snippet_path=None, **{**row, "id": row["id"] + id_offset}))
    for t in detail["triggers"]:
        session.add(TriggerSent(**{**t, "created_at": ts(t["created_at"])}))


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    from app.api import common, pipeline_state
    from app.config import get_settings
    from app.db import get_engine

    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("INBOX_DIR", str(tmp_path / "inbox"))
    monkeypatch.setenv("CASE_DATA_DIR", str(tmp_path / "case-data"))
    monkeypatch.setenv("LLM_SAMPLES", "3")  # the fixtures were made with k = 3
    monkeypatch.setenv("LLM_MODEL", "")
    monkeypatch.setenv("ASR_MODEL", "")
    monkeypatch.setenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("TRIGGER_API_URL", "http://localhost:8080")
    monkeypatch.setenv("TRIGGER_API_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", SECRET)
    get_settings.cache_clear()
    get_engine.cache_clear()
    pipeline_state.reset()
    expected = {d["call"]["dialogue_id"]: d["call"]["expected_verdict"] for d in details().values()}
    monkeypatch.setattr(common, "expected_verdicts", lambda: dict(expected))
    for module in ("calls", "scores"):
        monkeypatch.setattr(f"app.api.{module}.expected_verdicts", lambda: dict(expected))
    yield data
    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    pipeline_state.reset()


@pytest.fixture
def engine(data_dir: Path):
    from app.db import get_engine

    eng = get_engine()
    SQLModel.metadata.create_all(eng)
    return eng


@pytest.fixture
def seeded(engine, data_dir: Path):
    """Configs plus the three demo calls from the frontend fixtures; audio under CASE_DATA_DIR/Audio."""
    audio_dir = data_dir.parent / "case-data" / "Audio"
    with Session(engine) as session:
        seed_configs(session)
        for i, detail in enumerate(details().values()):
            seed_call(session, detail, audio_dir, id_offset=100 * i)
        session.commit()
    return engine


@pytest.fixture
def client(seeded) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def empty_client(engine) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c
