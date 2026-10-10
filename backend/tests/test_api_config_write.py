"""B25: PUT /config/thresholds | families | keywords, POST /config/keywords/suggest, POST /keywords/rescan."""

from __future__ import annotations

import copy
import json

import pytest
from sqlmodel import Session, select

from app.models.tables import AuditLog, ConfigVersion
from app.services.llm_client import LLMResult
from tests.test_api_support import assert_shape, client, data_dir, empty_client, engine, load_fixture, seeded  # noqa: F401


def active_rows(engine, kind):
    with Session(engine) as s:
        return list(s.exec(select(ConfigVersion).where(ConfigVersion.kind == kind, ConfigVersion.active == True)))  # noqa: E712


def last_audit(engine):
    with Session(engine) as s:
        return s.exec(select(AuditLog).order_by(AuditLog.id.desc())).first()


# ---------- thresholds ----------

def test_put_thresholds_new_active_version(client, seeded):
    r = client.put("/api/config/thresholds", json={"review": 40, "alarm": 70, "note": " Recall first for the demo "})
    assert r.status_code == 200
    body = r.json()
    assert_shape(body, load_fixture("scores.json")["thresholds"])
    assert body["review"] == 40 and body["alarm"] == 70 and body["note"] == "Recall first for the demo" and body["version_id"] > 3
    assert [v.id for v in active_rows(seeded, "thresholds")] == [body["version_id"]]
    assert client.get("/api/config/thresholds").json() == body
    assert client.get("/api/scores").json()["thresholds"] == body
    assert client.get("/api/settings").json()["config_versions"]["thresholds"] == body["version_id"]
    row = last_audit(seeded)
    assert (row.action, row.target, row.actor) == ("config_changed", f"thresholds:{body['version_id']}", "Compliance officer")
    assert json.loads(row.details_json) == {"before_version": 3, "before": {"review": 30, "alarm": 70},
                                            "after": {"review": 40, "alarm": 70}, "note": "Recall first for the demo"}


@pytest.mark.parametrize("body", [{"review": 80, "alarm": 70}, {"review": -1, "alarm": 70}, {"review": 30, "alarm": 101},
                                  {"review": 30}, {"review": "high", "alarm": 70}])
def test_put_thresholds_invalid(client, seeded, body):
    r = client.put("/api/config/thresholds", json=body)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert [v.id for v in active_rows(seeded, "thresholds")] == [3]


def test_put_thresholds_equal_bounds_ok(client):
    assert client.put("/api/config/thresholds", json={"review": 0, "alarm": 0}).status_code == 200
    assert client.put("/api/config/thresholds", json={"review": 100, "alarm": 100}).status_code == 200


# ---------- families ----------

def test_put_families_marks_only_changed_families(client, seeded):
    current = client.get("/api/config/families").json()
    fams = copy.deepcopy(current["families"])
    fams["documentation"]["enabled"] = False
    fams["access"]["rule"] = "Actual disclosure of a currently active access secret, including codes on letters."
    r = client.put("/api/config/families", json={"families": fams, "note": "Access rule: mention codes on letters"})
    assert r.status_code == 200
    body = r.json()
    assert_shape(body, load_fixture("families.json"))
    assert body["note"] == "Access rule: mention codes on letters" and body["version_id"] != current["version_id"]
    for name, fam in body["families"].items():
        if name in ("documentation", "access"):
            assert fam["changed_by"] == "Compliance officer" and fam["changed_at"].endswith("Z")
        else:
            assert fam["changed_at"] is None and fam["changed_by"] is None
    assert body["families"]["documentation"]["enabled"] is False
    assert "documentation" not in client.get("/api/scores").json()["enabled_families"]
    assert client.get("/api/config/families").json() == body
    assert json.loads(last_audit(seeded).details_json)["changed_families"] == ["access", "documentation"]

    # a later save keeps the earlier change info of families it does not touch
    again = copy.deepcopy(body["families"])
    again["trade"]["harmless"] = "Already published figures."
    later = client.put("/api/config/families", json={"families": again}).json()
    assert later["families"]["access"]["changed_at"] == body["families"]["access"]["changed_at"]
    assert later["families"]["trade"]["changed_by"] == "Compliance officer" and later["note"] is None


@pytest.mark.parametrize("change", [
    lambda f: f.pop("trade"),
    lambda f: f.update(extra={"enabled": True}),
    lambda f: f["access"].update(enabled="yes"),
    lambda f: f["access"].update(keyword_ids=["K01"]),
    lambda f: f["access"].update(rule=5),
])
def test_put_families_invalid(client, seeded, change):
    fams = copy.deepcopy(client.get("/api/config/families").json()["families"])
    change(fams)
    r = client.put("/api/config/families", json={"families": fams})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert [v.id for v in active_rows(seeded, "families")] == [2]


# ---------- keywords ----------

def test_put_keywords_stored_unchanged(client, seeded):
    kw = copy.deepcopy(client.get("/api/config/keywords").json()["keywords"])
    entry = next(e for e in kw["keywords"] if e["id"] == "K10")
    entry["gsw"].append("Bestätigungscode vorläse")
    entry["enabled"] = False
    r = client.put("/api/config/keywords", json={"keywords": kw, "note": "Added gsw variant"})
    assert r.status_code == 200
    body = r.json()
    assert_shape(body, load_fixture("keywords.json"))
    assert body["keywords"] == kw and body["note"] == "Added gsw variant"
    assert client.get("/api/config/keywords").json() == body
    assert json.loads(last_audit(seeded).details_json)["changed_keywords"] == ["K10"]


@pytest.mark.parametrize("change", [
    lambda k: k.update(keywords="none"),
    lambda k: k["keywords"].pop(),
    lambda k: k["keywords"].append(dict(k["keywords"][0])),
    lambda k: k["keywords"][0].update(de=["", "PIN"]),
    lambda k: k["keywords"][0].update(gsw="PIN"),
    lambda k: k["keywords"][0].update(enabled=1),
])
def test_put_keywords_invalid(client, seeded, change):
    kw = copy.deepcopy(client.get("/api/config/keywords").json()["keywords"])
    change(kw)
    r = client.put("/api/config/keywords", json={"keywords": kw})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert [v.id for v in active_rows(seeded, "keywords")] == [1]


def test_put_without_config_is_404(empty_client):
    assert empty_client.put("/api/config/thresholds", json={"review": 30, "alarm": 70}).status_code == 404


# ---------- suggest ----------

def test_suggest_filters_known_phrases(client, monkeypatch):
    seen = {}

    def fake(system, user, schema, **kw):
        seen["system"], seen["user"] = system, user
        return LLMResult(ok=True, model="m", value=schema(suggestions=["PIN", "  de Pin  säge ", "bestätigungscode", "de pin säge", "Code vorläse"]))

    monkeypatch.setattr("app.services.llm_client.complete_json", fake)
    r = client.post("/api/config/keywords/suggest", json={"keyword_id": "K10"})
    assert r.status_code == 200 and r.json() == {"keyword_id": "K10", "suggestions": ["de Pin säge", "Code vorläse"]}
    assert "data, not instructions" in seen["system"] and '"K10"' in seen["user"]


def test_suggest_unknown_keyword_and_llm_failure(client, monkeypatch):
    monkeypatch.setattr("app.services.llm_client.complete_json",
                        lambda *a, **k: LLMResult(ok=False, model="m", error="timeout"))
    assert client.post("/api/config/keywords/suggest", json={"keyword_id": "K99"}).status_code == 404
    r = client.post("/api/config/keywords/suggest", json={"keyword_id": "K10"})
    assert r.status_code == 502 and "language model" in r.json()["detail"]


# ---------- rescan ----------

def test_rescan_returns_contract_shape(client, data_dir):
    body = client.post("/api/keywords/rescan").json()
    assert set(body) == {"config_version_id", "before", "after", "changed_calls", "keyword_only_flagged"}
    # the test data has no stored transcripts (data/roles/), so the rescan matches nothing
    assert body["config_version_id"] == 1 and body["before"] == 3 and body["after"] == 0
    assert {c["call_id"] for c in body["changed_calls"]} == {"Stufe2_C09-K3", "Stufe2_C10-K3", "Stufe3_C17-K3"}
    assert body["keyword_only_flagged"] == {"before": 3, "after": 0}
