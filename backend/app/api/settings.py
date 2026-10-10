"""GET /settings: read-only app settings (D29). Never contains the API key."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from app.api.common import config_versions
from app.config import get_settings
from app.db import get_session

router = APIRouter(prefix="/api", tags=["settings"])
SessionDep = Annotated[Session, Depends(get_session)]


class SettingsOut(BaseModel):
    llm_model: str
    llm_base_url: str
    asr_model: str
    trigger_api_url: str
    trigger_api_enabled: bool
    config_versions: dict[str, int | None]


@router.get("/settings", response_model=SettingsOut)
def get_app_settings(session: SessionDep) -> SettingsOut:
    s = get_settings()
    return SettingsOut(llm_model=s.llm_model, llm_base_url=s.llm_base_url, asr_model=s.asr_model,
                       trigger_api_url=s.trigger_api_url, trigger_api_enabled=s.trigger_api_enabled,
                       config_versions=config_versions(session))
