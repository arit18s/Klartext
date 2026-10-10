from fastapi import FastAPI

from app.api import calls, configs, evaluation, events, pipeline, scores, settings

app = FastAPI(title="Klartext", version="0.1.0")

for module in (calls, scores, configs, evaluation, pipeline, settings, events):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
