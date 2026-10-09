"""Create the database and seed the initial config versions.

Run from backend/: python -m app.db.init
Idempotent: a config kind that already has an active version is left alone.
"""

from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, SQLModel, select

from app.config import get_settings
from app.db import get_engine
from app.models import tables  # noqa: F401  (registers tables on SQLModel.metadata)
from app.models.tables import AuditLog, ConfigVersion

VERDICT_FAMILIES = ["trade", "splitting", "access", "disclosure", "documentation"]
HELPER_FAMILIES = ["numbers"]
DEFAULT_THRESHOLDS = {"review": 30, "alarm": 70}


def load_keyword_list() -> dict[str, Any]:
    path = get_settings().case_data_path / "Stichwortliste.json"
    return json.loads(path.read_text(encoding="utf-8"))


def build_families(kw: dict[str, Any]) -> dict[str, Any]:
    """Rule text from `policy_examples`; harmless text joined from the family's keyword `harmless` fields."""
    by_id = {k["id"]: k for k in kw["keywords"]}
    families: dict[str, Any] = {}
    for fam in VERDICT_FAMILIES + HELPER_FAMILIES:
        meta = kw["families"].get(fam, {})
        harmless = [by_id[k]["harmless"] for k in meta.get("keywords", []) if by_id.get(k, {}).get("harmless")]
        families[fam] = {
            "enabled": True,
            "helper": fam in HELPER_FAMILIES,
            "label_de": meta.get("label"),
            "task": meta.get("task"),
            "keyword_ids": meta.get("keywords", []),
            "rule": kw["policy_examples"].get(fam, ""),
            "harmless": " ".join(harmless),
        }
    return families


def seed_config(session: Session, kind: str, data: dict[str, Any], note: str) -> bool:
    active = session.exec(
        select(ConfigVersion).where(ConfigVersion.kind == kind, ConfigVersion.active == True)  # noqa: E712
    ).first()
    if active:
        return False
    version = ConfigVersion(kind=kind, json_data=json.dumps(data, ensure_ascii=False), note=note, active=True)
    session.add(version)
    session.flush()
    session.add(
        AuditLog(
            actor="system",
            action="config_seeded",
            target=f"{kind}:{version.id}",
            details_json=json.dumps({"note": note}),
        )
    )
    return True


def init_db() -> None:
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    kw = load_keyword_list()
    with Session(engine) as session:
        seeded = {
            "keywords": seed_config(session, "keywords", kw, "Seeded from case-data/Stichwortliste.json"),
            "families": seed_config(session, "families", build_families(kw), "Seeded from policy_examples and keyword harmless texts"),
            "thresholds": seed_config(session, "thresholds", DEFAULT_THRESHOLDS, "Default thresholds"),
        }
        session.commit()
    print(f"Database: {get_settings().db_path}")
    for kind, done in seeded.items():
        print(f"  {kind:<11} {'seeded' if done else 'already active, unchanged'}")


if __name__ == "__main__":
    init_db()
