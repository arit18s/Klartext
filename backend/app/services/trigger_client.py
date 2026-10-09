"""Client for the Outcept trigger API (05_BACKEND_STRUCTURE.md section 7).

Failures are logged and retried once. They never raise: notifying must not block processing.
"""

from __future__ import annotations

import logging

import httpx
from pydantic import BaseModel

from app.config import get_settings

log = logging.getLogger(__name__)

TITLE_MAX = 200
DESCRIPTION_MAX = 2000
TIMEOUT_S = 5.0


class TriggerResult(BaseModel):
    ok: bool
    status_code: int | None = None
    remote_id: str | None = None
    error: str | None = None


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _post_once(endpoint: str, payload: dict[str, str]) -> TriggerResult:
    try:
        resp = httpx.post(endpoint, json=payload, timeout=TIMEOUT_S)
    except httpx.HTTPError as exc:
        return TriggerResult(ok=False, error=f"{type(exc).__name__}: {exc}")
    if resp.status_code == 201:
        remote_id = resp.json().get("id")
        return TriggerResult(ok=True, status_code=201, remote_id=None if remote_id is None else str(remote_id))
    return TriggerResult(ok=False, status_code=resp.status_code, error=resp.text[:500])


def send_trigger(url: str, title: str, description: str = "") -> TriggerResult:
    settings = get_settings()
    if not settings.trigger_api_enabled:
        return TriggerResult(ok=False, error="Trigger API disabled (TRIGGER_API_ENABLED=false)")

    endpoint = settings.trigger_api_url.rstrip("/") + "/triggers"
    payload = {
        "url": url,
        "title": _truncate(title, TITLE_MAX),
        "description": _truncate(description, DESCRIPTION_MAX),
    }
    result = _post_once(endpoint, payload)
    if not result.ok and (result.status_code is None or result.status_code >= 500):
        log.warning("Trigger post failed (%s), retrying once", result.error)
        result = _post_once(endpoint, payload)
    if result.ok:
        log.info("Trigger sent: id=%s title=%r", result.remote_id, payload["title"])
    else:
        log.error("Trigger not sent: status=%s error=%s", result.status_code, result.error)
    return result


if __name__ == "__main__":
    # Smoke test: python -m app.services.trigger_client
    logging.basicConfig(level=logging.INFO)
    base = get_settings().public_base_url.rstrip("/")
    print(
        send_trigger(
            url=f"{base}/calls/Stufe2_C09-K3?t=91",
            title="Test: Access code shared (Stufe2_C09-K3)",
            description="Test trigger from Klartext setup (B5). Evidence 01:41–01:48.",
        )
    )
