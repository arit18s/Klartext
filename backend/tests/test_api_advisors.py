"""R12: GET /advisors, patterns across calls per advisor."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session

from app.models.tables import Call, Decision, Evidence
from tests.test_api_support import client, data_dir, empty_client, engine, seeded  # noqa: F401

T = lambda h, m=0: datetime(2026, 10, 10, h, m, tzinfo=timezone.utc)  # noqa: E731


def add(s, cid, advisor, verdict=None, family=None, processed=T(9), status="done", triggers=()):
    s.add(Call(id=cid, file_path=f"/x/{cid}.wav", file_hash=cid, advisor_name=advisor, status=status,
               created_at=T(6), processed_at=processed if status == "done" else None))
    if verdict:
        s.add(Decision(call_id=cid, verdict=verdict, family=family, score=50))
    for i, speaker in enumerate(triggers):  # trigger evidence in the decided family, spoken by `speaker`
        s.add(Evidence(call_id=cid, family=family, seg_id=f"S{i:03d}", role="trigger", start_s=i, end_s=i + 1,
                       speaker_role=speaker, quote="x"))


def test_fixture_calls_one_row_per_advisor(client):
    body = client.get("/api/advisors").json()
    assert [r["advisor_name"] for r in body] == ["Advisor 04", "Advisor 01", "Advisor 02"]  # alarm, review, no alert
    # C09's trigger (the digits) is spoken by the customer: a customer request, not the advisor's own behaviour
    assert body[0] == {"advisor_name": "Advisor 04", "calls": 1, "alarm": 1, "review": 0, "no_alert": 0,
                       "advisor_alarm": 0, "advisor_review": 0, "customer_alarm": 1, "customer_review": 0,
                       "families": ["access"], "last_call_at": "2026-10-10T08:42:00Z", "last_call_id": "Stufe2_C09-K3"}
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
    # A1 has no trigger evidence (unclear, counted as advisor-raised), so Advisor 01 sorts before Advisor 04,
    # whose only alarm is customer-raised
    assert [r["advisor_name"] for r in body] == ["Advisor 01", "Advisor 04", "Advisor 02"]
    assert sum(r["calls"] for r in body) == 6


def test_split_by_who_raised_it(client, seeded):
    with Session(seeded) as s:
        add(s, "X1", "Advisor 07", "alarm", "trade", triggers=["customer", "customer"])   # customer
        add(s, "X2", "Advisor 07", "review", "trade", triggers=["customer", "advisor"])   # mixed: advisor
        add(s, "X3", "Advisor 07", "review", "access", triggers=[])                       # no trigger: unclear
        add(s, "X4", "Advisor 07", "review", "access", triggers=["customer", None])       # unknown speaker: unclear
        add(s, "Y1", "Advisor 08", "alarm", "trade", triggers=["advisor"])
        s.add(Evidence(call_id="X1", family="access", seg_id="S100", role="trigger", start_s=0, end_s=1,
                       speaker_role="advisor", quote="x"))  # another family's trigger does not count
        s.commit()
    body = client.get("/api/advisors").json()
    a07 = next(r for r in body if r["advisor_name"] == "Advisor 07")
    assert (a07["alarm"], a07["review"]) == (1, 3)
    assert (a07["advisor_alarm"], a07["advisor_review"], a07["customer_alarm"], a07["customer_review"]) == (0, 3, 1, 0)
    # advisor-raised alarms sort first, ahead of Advisor 04's customer-raised alarm
    assert [r["advisor_name"] for r in body][:3] == ["Advisor 08", "Advisor 07", "Advisor 04"]
    raised = {c["call_id"]: c["raised_by"] for c in client.get("/api/calls").json()["items"]}
    assert {k: raised[k] for k in ("X1", "X2", "X3", "X4", "Y1")} == {
        "X1": "customer", "X2": "advisor", "X3": "unclear", "X4": "unclear", "Y1": "advisor"}
    assert client.get("/api/calls/X1").json()["call"]["raised_by"] == "customer"


def test_since_filters_by_processed_time(client, seeded):
    body = client.get("/api/advisors", params={"since": "2026-10-10T08:40:00Z"}).json()
    assert [r["advisor_name"] for r in body] == ["Advisor 04"]
    assert client.get("/api/advisors", params={"since": "2030-01-01T00:00:00Z"}).json() == []
    r = client.get("/api/advisors", params={"since": "last week"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_empty(empty_client):
    assert empty_client.get("/api/advisors").json() == []
