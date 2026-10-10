"""B24: GET /scores against frontend/src/fixtures/scores.json."""

from __future__ import annotations

from sqlmodel import Session

from app.models.tables import Call
from tests.test_api_support import assert_shape, client, data_dir, empty_client, engine, load_fixture, seeded  # noqa: F401


def test_scores_match_fixture(client):
    fx = load_fixture("scores.json")
    body = client.get("/api/scores").json()
    assert_shape(body, fx)
    assert body == fx


def test_scores_skip_undecided_calls(client, seeded):
    with Session(seeded) as s:
        s.add(Call(id="Queued-K1", file_path="/x.wav", file_hash="q", status="queued"))
        s.commit()
    assert "Queued-K1" not in [c["call_id"] for c in client.get("/api/scores").json()["calls"]]


def test_scores_without_config_is_404(empty_client):
    r = empty_client.get("/api/scores")
    assert r.status_code == 404 and "thresholds" in r.json()["detail"]
