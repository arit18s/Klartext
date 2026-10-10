"""R11: GET /scores/suggestion, thresholds suggested from feedback. Seeded calls (k = 3):
C09-K3 alarm, access 91 · C17-K3 review, access 58 with 2 of 3 runs asking for a human · C10-K3 no alert, access 12.
Dev run: frontend/src/fixtures/eval.json, recall 1.0 up to review 90, 0.5 from 95 (D44)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from sqlmodel import Session, select

from app.models.tables import ConfigVersion, Feedback
from tests.test_api_support import client, data_dir, empty_client, engine, load_fixture, seeded  # noqa: F401

T0 = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)


def label(engine, *pairs):
    with Session(engine) as s:
        for i, (cid, lab) in enumerate(pairs):
            s.add(Feedback(call_id=cid, label=lab, note="x" if lab == "note" else None, created_at=T0 + timedelta(minutes=i)))
        s.commit()


def write_run(data_dir, **changes) -> dict:
    run = {**load_fixture("eval.json"), **changes}
    folder = data_dir / "eval"
    folder.mkdir(exist_ok=True)
    (folder / f"{run['run_id']}.json").write_text(json.dumps(run), encoding="utf-8")
    return run


@pytest.fixture(autouse=True)
def dev_run(data_dir):
    return write_run(data_dir)


def test_no_feedback(client):
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["labelled_calls"] == 0 and body["suggested_effect"] is None
    assert body["current"] == {"review": 30, "alarm": 70} and body["thresholds_version_id"] == 3
    assert body["summary"].startswith("No feedback on calls yet")


def test_single_false_alarm_on_c09_has_no_safe_suggestion(client, seeded, dev_run):
    # C09 (91) becomes no alert only from review 95, where dev recall drops 1.0 -> 0.5. Alarm 95 alone would make it
    # a review: one false alarm traded for one extra review, which is not an improvement either.
    label(seeded, ("Stufe2_C09-K3", "false_alarm"), ("Stufe3_C17-K3", "correct"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["suggested_effect"] is None
    assert body["summary"] == "No safe suggestion: every change would miss real cases."
    assert body["current_effect"] == {"missed": 0, "false_alarms": 1, "extra_reviews": 0, "unmet_escalations": 0,
                                      "changed_confirmed": 0, "flagged": 2}
    assert body["dev_recall"] == {"run_id": dev_run["run_id"], "current": 1.0, "suggested": None}
    assert body["labels"] == {"false_alarm": 1, "correct": 1} and body["labelled_calls"] == 2


def test_false_alarm_suggested_when_dev_recall_holds(client, seeded, data_dir, dev_run):
    curve = [{**p, "recall": 1.0} for p in dev_run["metrics"]["pr_curve"]]
    write_run(data_dir, run_id="eval-newer-dev", created_at="2026-10-10T23:00:00Z",
              metrics={**dev_run["metrics"], "pr_curve": curve})
    label(seeded, ("Stufe2_C09-K3", "false_alarm"), ("Stufe3_C17-K3", "correct"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] == {"review": 95, "alarm": 95}
    assert body["summary"] == "Would avoid 1 false alarm, misses nothing."
    assert body["dev_recall"] == {"run_id": "eval-newer-dev", "current": 1.0, "suggested": 1.0}


def test_holdout_run_is_never_read(client, seeded, data_dir, dev_run):
    curve = [{**p, "recall": 1.0} for p in dev_run["metrics"]["pr_curve"]]
    write_run(data_dir, run_id="eval-holdout", split="holdout", created_at="2026-10-10T23:00:00Z",
              metrics={**dev_run["metrics"], "pr_curve": curve})
    label(seeded, ("Stufe2_C09-K3", "false_alarm"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["dev_recall"]["run_id"] == dev_run["run_id"]


def test_score_100_false_alarm_cannot_be_fixed_by_thresholds(client, seeded):
    from app.models.tables import CheckResult
    with Session(seeded) as s:
        r = s.exec(select(CheckResult).where(CheckResult.call_id == "Stufe2_C09-K3", CheckResult.family == "access")).one()
        r.score = 100  # every run agrees: no review threshold up to 100 clears it, safe or not
        s.add(r)
        s.commit()
    label(seeded, ("Stufe2_C09-K3", "false_alarm"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None
    assert body["summary"] == "No threshold change would fit the feedback better. No change suggested."


def test_without_dev_run_no_suggestion(client, seeded, data_dir):
    (data_dir / "eval" / f"{load_fixture('eval.json')['run_id']}.json").unlink()
    label(seeded, ("Stufe2_C10-K3", "missed"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["dev_recall"] is None
    assert body["summary"].startswith("No Dev evaluation run yet")


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
    assert body["dev_recall"]["suggested"] == 1.0


def test_nothing_to_gain_and_notes_ignored(client, seeded):
    # C17 stays review at any review threshold: 2 of 3 runs ask for a human, so the extra review cannot be avoided
    label(seeded, ("Stufe3_C17-K3", "closed_no_alert"), ("Stufe3_C17-K3", "note"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["labels"] == {"closed_no_alert": 1}
    assert body["current_effect"]["extra_reviews"] == 1
    assert body["summary"] == "No threshold change would fit the feedback better. No change suggested."


def test_latest_verdict_label_wins_and_nothing_is_saved(client, seeded):
    label(seeded, ("Stufe2_C10-K3", "missed"), ("Stufe2_C10-K3", "correct"))
    body = client.get("/api/scores/suggestion").json()
    assert body["suggestion"] is None and body["labels"] == {"correct": 1}
    with Session(seeded) as s:
        assert len(s.exec(select(ConfigVersion).where(ConfigVersion.kind == "thresholds")).all()) == 1


def test_without_config_is_404(empty_client):
    assert empty_client.get("/api/scores/suggestion").status_code == 404
