"""R12: GET /advisors, patterns across calls per advisor."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session

from app.models.tables import Call, Decision
from tests.test_api_support import client, data_dir, empty_client, engine, seeded  # noqa: F401

T = lambda h, m=0: datetime(2026, 10, 10, h, m, tzinfo=timezone.utc)  # noqa: E731


def add(s, cid, advisor, verdict=None, family=None, processed=T(9), status="done"):
    s.add(Call(id=cid, file_path=f"/x/{cid}.wav", file_hash=cid, advisor_name=advisor, status=status,
               created_at=T(6), processed_at=processed if status == "done" else None))
    if verdict:
        s.add(Decision(call_id=cid, verdict=verdict, family=family, score=50))


def test_fixture_calls_one_row_per_advisor(client):
    body = client.get("/api/advisors").json()
    assert [r["advisor_name"] for r in body] == ["Advisor 04", "Advisor 01", "Advisor 02"]  # alarm, review, no alert
    assert body[0] == {"advisor_name": "Advisor 04", "calls": 1, "alarm": 1, "review": 0, "no_alert": 0, "families": ["access"],
                       "last_call_at": "2026-10-10T08:42:00Z", "last_call_id": "Stufe2_C09-K3"}
    assert body[2]["families"] == []  # no-alert calls involve no family


def test_counts_families_last_call_and_sort(client, seeded):
    with Session(seeded) as s:
        add(s, "A1", "Advisor 01", "review", "trade", T(10))
        add(s, "A2", "Advisor 01", "no_alert", "trade", T(11))
        add(s, "A3", "Advisor 01", status="checking")      # undecided: counts as a call, no verdict
        add(s, "B1", "  ", "alarm", "access")               # blank name: left out
        add(s, "B2", None, "alarm", "access")               # no name: left out
        s.commit()
    body = client.get("/api/advisors").json()
    a01 = next(r for r in body if r["advisor_name"] == "Advisor 01")
    assert (a01["calls"], a01["alarm"], a01["review"], a01["no_alert"]) == (4, 0, 2, 1)
    assert a01["families"] == ["trade", "access"]  # fixed family order
    assert a01["last_call_id"] == "A2" and a01["last_call_at"] == "2026-10-10T11:00:00Z"
    assert [r["advisor_name"] for r in body] == ["Advisor 04", "Advisor 01", "Advisor 02"]
    assert sum(r["calls"] for r in body) == 6


def test_since_filters_by_processed_time(client, seeded):
    body = client.get("/api/advisors", params={"since": "2026-10-10T08:40:00Z"}).json()
    assert [r["advisor_name"] for r in body] == ["Advisor 04"]
    assert client.get("/api/advisors", params={"since": "2030-01-01T00:00:00Z"}).json() == []
    r = client.get("/api/advisors", params={"since": "last week"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_empty(empty_client):
    assert empty_client.get("/api/advisors").json() == []
