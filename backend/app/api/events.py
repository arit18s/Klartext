"""GET /events: server-sent events `call_updated` and `pipeline_status`.

`publish()` is thread-safe, so the pipeline (worker threads) can call it; `notify_call_updated()` and
`notify_pipeline_status()` build the payloads from the DB. A new subscriber first gets the current pipeline status.
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.pipeline import build_status
from app.api.common import PlainErrorRoute
from app.db import get_engine
from app.models.tables import Call, Decision

router = APIRouter(prefix="/api", tags=["events"], route_class=PlainErrorRoute)
KEEPALIVE_S = 15.0
QUEUE_MAX = 100


class Broker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]] = set()

    def subscribe(self) -> tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]:
        sub = (asyncio.get_running_loop(), asyncio.Queue(maxsize=QUEUE_MAX))
        with self._lock:
            self._subscribers.add(sub)
        return sub

    def unsubscribe(self, sub: tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]) -> None:
        with self._lock:
            self._subscribers.discard(sub)

    def publish(self, event: str, data: dict[str, Any]) -> None:
        message = format_event(event, data)
        with self._lock:
            subs = list(self._subscribers)
        for loop, queue in subs:
            try:
                loop.call_soon_threadsafe(_offer, queue, message)
            except RuntimeError:  # loop closed: the client is gone
                self.unsubscribe((loop, queue))

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)


def _offer(queue: asyncio.Queue[str], message: str) -> None:
    if queue.full():  # a slow client loses the oldest event, never blocks the pipeline
        queue.get_nowait()
    queue.put_nowait(message)


def format_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


broker = Broker()


def publish(event: str, data: dict[str, Any]) -> None:
    broker.publish(event, data)


def pipeline_status_payload() -> dict[str, Any]:
    with Session(get_engine()) as session:
        return build_status(session).model_dump()


def notify_call_updated(call_id: str) -> None:
    with Session(get_engine()) as session:
        call = session.get(Call, call_id)
        d = session.get(Decision, call_id)
    if call is not None:
        publish("call_updated", {"call_id": call_id, "status": call.status, "verdict": d.verdict if d else None})


def notify_pipeline_status() -> None:
    publish("pipeline_status", pipeline_status_payload())


async def stream(request: Request) -> AsyncIterator[str]:
    sub = broker.subscribe()
    try:
        yield format_event("pipeline_status", await asyncio.to_thread(pipeline_status_payload))
        while not await request.is_disconnected():
            try:
                yield await asyncio.wait_for(sub[1].get(), timeout=KEEPALIVE_S)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        broker.unsubscribe(sub)


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    return StreamingResponse(stream(request), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
