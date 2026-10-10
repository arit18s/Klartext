"""B24: GET /settings against frontend/src/fixtures/settings.json."""

from __future__ import annotations

from tests.test_api_support import SECRET, assert_shape, client, data_dir, engine, load_fixture, seeded  # noqa: F401


def test_settings_match_fixture(client):
    fx = load_fixture("settings.json")
    r = client.get("/api/settings")
    assert_shape(r.json(), fx)
    assert r.json() == fx


def test_settings_never_contain_the_api_key(client):
    text = client.get("/api/settings").text
    assert SECRET not in text and "api_key" not in text
