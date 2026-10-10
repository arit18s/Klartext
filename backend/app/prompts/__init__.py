"""Prompt templates. `$name` placeholders (string.Template), so JSON braces in prompts stay literal."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from string import Template

PROMPT_DIR = Path(__file__).parent

FAMILY_NAMES = {
    "trade": "Trading on non-public information",
    "splitting": "Splitting to avoid approval",
    "access": "Access code shared",
    "disclosure": "Information given to a third party",
    "documentation": "Relevant information left out",
    "numbers": "Number type",
}


@lru_cache
def load(name: str) -> str:
    return (PROMPT_DIR / name).read_text(encoding="utf-8").strip()


def render(name: str, **values: str) -> str:
    return Template(load(name)).substitute(**values)


def family_guidance(family: str) -> str:
    path = PROMPT_DIR / "families" / f"{family}.md"
    return load(f"families/{family}.md") if path.exists() else ""


CHECK_PROMPTS = ["system.md", "check_user.md", "numbers_system.md", "families/*.md"]


@lru_cache
def prompt_version() -> str:
    """Hash of the prompt files the family checks use: stored with every check result so decisions are
    traceable. Other prompts (roles, twin) do not change check results, so they are not part of it."""
    h = hashlib.sha256()
    files = sorted({p for pattern in CHECK_PROMPTS for p in PROMPT_DIR.glob(pattern)})
    for p in files:
        h.update(p.relative_to(PROMPT_DIR).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]
