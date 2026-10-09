"""SQLite engine and sessions. One file: DATA_DIR/klartext.db."""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy.engine import Engine
from sqlmodel import Session, create_engine

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    db_path = get_settings().db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
