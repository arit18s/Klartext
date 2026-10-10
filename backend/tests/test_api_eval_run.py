"""B25: POST /eval/run runs scripts/evaluate.py on the stored pipeline results and returns GET /eval/latest."""

from __future__ import annotations

import json
import subprocess

import pytest

from app.api import evaluation
from tests.test_api_support import assert_shape, client, data_dir, engine, load_fixture, seeded  # noqa: F401


@pytest.fixture
def script(monkeypatch, data_dir):
    """Stands in for scripts/evaluate.py: records the command line and writes a run like the real script."""
    seen = []

    def fake(split):
        seen.append(split)
        fx = load_fixture("eval.json")
        run = {**fx, "run_id": f"eval-test-{len(seen)}-{split}", "split": split, "created_at": f"2026-10-11T0{len(seen)}:00:00Z"}
        (data_dir / "eval").mkdir(exist_ok=True)
        (data_dir / "eval" / f"{run['run_id']}.json").write_text(json.dumps(run), encoding="utf-8")
        return subprocess.CompletedProcess([], 0, "ok", "")

    monkeypatch.setattr(evaluation, "run_evaluate_script", fake)
    return seen


@pytest.mark.parametrize("split", ["dev", "holdout", "all"])
def test_run_returns_latest(client, script, split):
    r = client.post("/api/eval/run", json={"split": split})
    assert r.status_code == 200
    body = r.json()
    assert_shape(body, load_fixture("eval.json"))
    assert body["run_id"] == f"eval-test-1-{split}" and body["split"] == split and script == [split]
    assert client.get("/api/eval/latest").json() == body


def test_run_invalid_split(client, script):
    r = client.post("/api/eval/run", json={"split": "test"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str) and script == []


def test_run_failure_is_409_with_reason(client, monkeypatch):
    msg = "No pipeline decision for 60 recordings (e.g. Stufe1_A01-K1). Run scripts/process_all.py first."
    monkeypatch.setattr(evaluation, "run_evaluate_script", lambda split: subprocess.CompletedProcess([], 1, "", msg + "\n"))
    r = client.post("/api/eval/run", json={"split": "dev"})
    assert r.status_code == 409 and r.json()["detail"] == msg


def test_command_line(monkeypatch):
    seen = []
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: seen.append((cmd[1:], kw["cwd"].name)) or subprocess.CompletedProcess(cmd, 0))
    evaluation.run_evaluate_script("dev")
    evaluation.run_evaluate_script("holdout")
    assert seen == [(["scripts/evaluate.py", "--split", "dev", "--source", "asr"], "backend"),
                    (["scripts/evaluate.py", "--split", "holdout", "--source", "asr", "--holdout"], "backend")]
