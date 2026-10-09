"""Read the active config versions (keywords / families / thresholds / model)."""

from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, select

from app.db import get_engine
from app.models.tables import ConfigVersion


class ActiveConfig:
    def __init__(self, kind: str, version_id: int, data: dict[str, Any]) -> None:
        self.kind, self.version_id, self.data = kind, version_id, data


def get_active_config(kind: str) -> ActiveConfig:
    with Session(get_engine()) as session:
        row = session.exec(
            select(ConfigVersion).where(ConfigVersion.kind == kind, ConfigVersion.active == True)  # noqa: E712
            .order_by(ConfigVersion.id.desc())
        ).first()
    if row is None or row.id is None:
        raise LookupError(f"No active '{kind}' config. Run: python -m app.db.init")
    return ActiveConfig(kind, row.id, json.loads(row.json_data))
