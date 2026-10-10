from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import calls, configs, evaluation, events, pipeline, scores, settings
from app.services.watcher import start_watcher, stop_watcher


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    start_watcher()  # inbox watcher (B26); WATCHER_ENABLED=false skips it
    yield
    stop_watcher()


app = FastAPI(title="Klartext", version="0.1.0", lifespan=lifespan)

for module in (calls, scores, configs, evaluation, pipeline, settings, events):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
