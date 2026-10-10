"""B24: GET /config/thresholds | families | keywords against the frontend fixtures."""

from __future__ import annotations

import pytest

from tests.test_api_support import assert_shape, client, data_dir, empty_client, engine, load_fixture, seeded  # noqa: F401


def test_thresholds(client):
    fx = load_fixture("scores.json")["thresholds"]
    body = client.get("/api/config/thresholds").json()
    assert_shape(body, fx)
    assert body == fx


def test_families_shape_and_null_change_info(client):
    fx = load_fixture("families.json")
    body = client.get("/api/config/families").json()
    assert_shape(body, fx)
    assert set(body["families"]) == set(fx["families"])
    for name, fam in body["families"].items():
        # changed_at / changed_by are not in the seeded config yet: null until a PUT (B25) records them
        assert fam["changed_at"] is None and fam["changed_by"] is None
        expected = {k: v for k, v in fx["families"][name].items() if k not in ("changed_at", "changed_by")}
        assert {k: v for k, v in fam.items() if k not in ("changed_at", "changed_by")} == expected


def test_keywords_returned_unchanged(client):
    fx = load_fixture("keywords.json")
    body = client.get("/api/config/keywords").json()
    assert_shape(body, fx)
    assert body == fx


@pytest.mark.parametrize("kind", ["thresholds", "families", "keywords"])
def test_missing_config_is_404(empty_client, kind):
    r = empty_client.get(f"/api/config/{kind}")
    assert r.status_code == 404 and kind in r.json()["detail"]
