"""B24: GET /events (SSE) and the in-process broker the pipeline publishes to."""

from __future__ import annotations

import asyncio
import json

from app.api import events
from tests.test_api_support import client, data_dir, engine, seeded  # noqa: F401
from tests.test_api_pipeline import CONTRACT_EXAMPLE
from tests.test_api_support import assert_shape


def parse(message: str) -> tuple[str, dict]:
    lines = dict(line.split(": ", 1) for line in message.strip().splitlines())
    return lines["event"], json.loads(lines["data"])


def test_format_event():
    msg = events.format_event("call_updated", {"call_id": "Stufe2_C09-K3", "status": "done", "verdict": "alarm"})
    assert msg == 'event: call_updated\ndata: {"call_id": "Stufe2_C09-K3", "status": "done", "verdict": "alarm"}\n\n'


def test_broker_delivers_from_another_thread_and_unsubscribes():
    async def run() -> list[str]:
        broker = events.Broker()
        sub = broker.subscribe()
        await asyncio.to_thread(broker.publish, "call_updated", {"call_id": "A", "status": "done", "verdict": None})
        got = [await asyncio.wait_for(sub[1].get(), 1)]
        broker.unsubscribe(sub)
        assert broker.subscriber_count == 0
        return got

    (msg,) = asyncio.run(run())
    assert parse(msg) == ("call_updated", {"call_id": "A", "status": "done", "verdict": None})


def test_slow_subscriber_drops_oldest():
    async def run() -> asyncio.Queue:
        broker = events.Broker()
        loop, queue = broker.subscribe()
        for i in range(events.QUEUE_MAX + 5):
            broker.publish("call_updated", {"call_id": str(i), "status": "done", "verdict": None})
        await asyncio.sleep(0)
        return queue

    queue = asyncio.run(run())
    assert queue.qsize() == events.QUEUE_MAX
    assert parse(queue.get_nowait())[1]["call_id"] == "5"


def test_call_updated_payload_from_db(seeded, monkeypatch):
    sent = []
    monkeypatch.setattr(events, "publish", lambda e, d: sent.append((e, d)))
    events.notify_call_updated("Stufe3_C17-K3")
    events.notify_call_updated("Unknown")
    assert sent == [("call_updated", {"call_id": "Stufe3_C17-K3", "status": "done", "verdict": "review"})]


class FakeRequest:
    """Connected for `polls` checks, then gone."""

    def __init__(self, polls: int) -> None:
        self.polls = polls

    async def is_disconnected(self) -> bool:
        self.polls -= 1
        return self.polls < 0


def test_stream_starts_with_pipeline_status_then_relays_events(client, monkeypatch):
    """Drives the SSE generator directly: TestClient buffers a response until it ends, and this one never does."""
    async def run() -> list[str]:
        gen = events.stream(FakeRequest(polls=1))
        first = await gen.__anext__()
        await asyncio.to_thread(events.publish, "call_updated", {"call_id": "Stufe2_C09-K3", "status": "done", "verdict": "alarm"})
        rest = [m async for m in gen]
        return [first, *rest]

    first, second = asyncio.run(run())
    event, data = parse(first)
    assert event == "pipeline_status"
    assert_shape(data, CONTRACT_EXAMPLE)
    assert [i["call_id"] for i in data["recent"]] == [i["call_id"] for i in client.get("/api/pipeline/status").json()["recent"]]
    assert parse(second) == ("call_updated", {"call_id": "Stufe2_C09-K3", "status": "done", "verdict": "alarm"})
    assert events.broker.subscriber_count == 0


def test_stream_sends_keepalive(seeded, monkeypatch):
    monkeypatch.setattr(events, "KEEPALIVE_S", 0.01)

    async def run() -> list[str]:
        return [m async for m in events.stream(FakeRequest(polls=1))]

    assert asyncio.run(run())[1] == ": keepalive\n\n"


def test_events_route_is_sse():
    from app.main import app

    assert "/api/events" in app.openapi()["paths"]
