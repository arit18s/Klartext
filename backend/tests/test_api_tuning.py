"""R11: GET /scores/suggestion, thresholds suggested from feedback. Seeded calls (k = 3):
C09-K3 alarm, access 91 · C17-K3 review, access 58 with 2 of 3 runs asking for a human · C10-K3 no alert, access 12."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.models.tables import ConfigVersion, Feedback
from tests.test_api_support import client, data_dir, empty_client, engine, seeded  # noqa: F401

T0 = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)


def label(engine, *pairs):
    with Session(engine) as s:
        for i, (cid, lab) in enumerate(pairs):
            s.add(Feedback(call_id=cid, label=lab, note="x" if lab == "note" else None, created_at=T0 + timedelta(minutes=i)))
        s.commit()


def test_no_feedback(client):
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["labelled_calls"] == 0 and body["suggested_effect"] is None
    assert body["current"] == {"review": 30, "alarm": 70} and body["thresholds_version_id"] == 3
    assert body["summary"].startswith("No feedback on calls yet")


def test_false_alarm_suggests_stricter_thresholds(client, seeded):
    label(seeded, ("Stufe2_C09-K3", "false_alarm"), ("Stufe3_C17-K3", "correct"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] == {"review": 95, "alarm": 95}
    assert body["current_effect"] == {"missed": 0, "false_alarms": 1, "extra_reviews": 0, "unmet_escalations": 0,
                                      "changed_confirmed": 0, "flagged": 2}
    assert body["suggested_effect"]["false_alarms"] == 0 and body["suggested_effect"]["flagged"] == 1
    assert body["summary"] == "Would avoid 1 false alarm, misses nothing."
    assert body["labels"] == {"false_alarm": 1, "correct": 1} and body["labelled_calls"] == 2


def test_escalation_lowers_the_alarm_threshold(client, seeded):
    label(seeded, ("Stufe3_C17-K3", "escalated_to_alarm"), ("Stufe2_C09-K3", "correct"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] == {"review": 30, "alarm": 55}
    assert body["summary"] == "Would raise 1 escalated call to alarm, misses nothing."


def test_missed_lowers_the_review_threshold(client, seeded):
    label(seeded, ("Stufe2_C10-K3", "missed"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] == {"review": 10, "alarm": 70}
    assert body["current_effect"]["missed"] == 1 and body["suggested_effect"]["missed"] == 0
    assert body["summary"] == "Would catch 1 missed call, misses nothing."


def test_nothing_to_gain_and_notes_ignored(client, seeded):
    # C17 stays review at any review threshold: 2 of 3 runs ask for a human, so the extra review cannot be avoided
    label(seeded, ("Stufe3_C17-K3", "closed_no_alert"), ("Stufe3_C17-K3", "note"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["labels"] == {"closed_no_alert": 1}
    assert body["current_effect"]["extra_reviews"] == 1
    assert body["summary"] == "The active thresholds already fit the feedback best. No change suggested."


def test_latest_verdict_label_wins_and_nothing_is_saved(client, seeded):
    label(seeded, ("Stufe2_C10-K3", "missed"), ("Stufe2_C10-K3", "correct"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["labels"] == {"correct": 1}
    with Session(seeded) as s:
        assert len(s.exec(select(ConfigVersion).where(ConfigVersion.kind == "thresholds")).all()) == 1


def test_without_config_is_404(empty_client):
    assert empty_client.get("/api/scores/suggestion").status_code == 404
