"""B24: GET /eval/latest against frontend/src/fixtures/eval.json."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlmodel import Session

from app.models.tables import EvalRun
from tests.test_api_support import assert_shape, client, data_dir, engine, load_fixture, seeded  # noqa: F401


def write_run(data_dir, run: dict) -> None:
    folder = data_dir / "eval"
    folder.mkdir(exist_ok=True)
    (folder / f"{run['run_id']}.json").write_text(json.dumps(run | {"snapshot": {"model": "m", "unit": "recording"}}), encoding="utf-8")


def test_no_run_is_404(client):
    r = client.get("/api/eval/latest")
    assert r.status_code == 404 and "evaluation" in r.json()["detail"]


def test_latest_file_matches_fixture_without_snapshot(client, data_dir):
    fx = load_fixture("eval.json")
    write_run(data_dir, {**fx, "run_id": "eval-old", "created_at": "2026-10-09T10:00:00Z"})
    write_run(data_dir, fx)
    (data_dir / "eval" / "broken.json").write_text("{not json", encoding="utf-8")
    body = client.get("/api/eval/latest").json()
    assert_shape(body, fx)
    assert body == fx


def test_falls_back_to_eval_runs_table(client, seeded):
    fx = load_fixture("eval.json")
    snapshot = {**fx["config_versions"], "unit": "dialogue"}
    with Session(seeded) as s:
        s.add(EvalRun(split="dev", config_snapshot_json=json.dumps(snapshot), metrics_json=json.dumps(fx["metrics"]),
                      created_at=datetime(2026, 10, 10, 20, 14, tzinfo=timezone.utc)))
        s.commit()
    body = client.get("/api/eval/latest").json()
    assert_shape(body, fx)
    assert body["split"] == "dev" and body["source"] == "script" and body["created_at"] == "2026-10-10T20:14:00Z"
    assert body["config_versions"] == fx["config_versions"] and body["metrics"] == fx["metrics"]


def test_latest_by_split(client, data_dir):
    fx = load_fixture("eval.json")
    write_run(data_dir, {**fx, "run_id": "eval-holdout", "split": "holdout", "created_at": "2026-10-10T07:32:58Z"})
    write_run(data_dir, {**fx, "run_id": "eval-dev", "split": "dev", "created_at": "2026-10-10T09:00:00Z"})
    assert client.get("/api/eval/latest").json()["run_id"] == "eval-dev"
    assert client.get("/api/eval/latest", params={"split": "holdout"}).json()["run_id"] == "eval-holdout"
    r = client.get("/api/eval/latest", params={"split": "all"})
    assert r.status_code == 404 and r.json()["detail"] == "No evaluation run on the all split yet."
    assert client.get("/api/eval/latest", params={"split": "test"}).status_code == 422
