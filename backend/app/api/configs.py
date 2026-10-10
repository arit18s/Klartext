"""GET /config/thresholds | families | keywords: the active config versions (writes are B25)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.common import active_config, iso

router = APIRouter(prefix="/api/config", tags=["config"])


class ThresholdsOut(BaseModel):
    version_id: int
    review: float
    alarm: float
    note: str | None
    created_at: str | None


class FamiliesOut(BaseModel):
    version_id: int
    note: str | None
    created_at: str | None
    families: dict[str, dict[str, Any]]


class KeywordsOut(BaseModel):
    version_id: int
    note: str | None
    created_at: str | None
    keywords: dict[str, Any]


@router.get("/thresholds", response_model=ThresholdsOut)
def get_thresholds() -> ThresholdsOut:
    cfg, row = active_config("thresholds")
    return ThresholdsOut(version_id=cfg.version_id, review=cfg.data["review"], alarm=cfg.data["alarm"], note=row.note,
                         created_at=iso(row.created_at))


@router.get("/families", response_model=FamiliesOut)
def get_families() -> FamiliesOut:
    """As seeded by db/init.py; `changed_at` / `changed_by` are null until a PUT (B25) sets them."""
    cfg, row = active_config("families")
    families = {name: {**fam, "changed_at": fam.get("changed_at"), "changed_by": fam.get("changed_by")}
                for name, fam in cfg.data.items()}
    return FamiliesOut(version_id=cfg.version_id, note=row.note, created_at=iso(row.created_at), families=families)


@router.get("/keywords", response_model=KeywordsOut)
def get_keywords() -> KeywordsOut:
    """Stichwortliste.json as stored, unchanged."""
    cfg, row = active_config("keywords")
    return KeywordsOut(version_id=cfg.version_id, note=row.note, created_at=iso(row.created_at), keywords=cfg.data)
