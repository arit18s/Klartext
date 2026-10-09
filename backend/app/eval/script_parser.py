"""Parser for the case scripts (Transkript/ and Skript_mit_Sollbewertung/).

EVALUATION / DEVELOPMENT ONLY. Scripts are never pipeline input.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel

TURN_RE = re.compile(r"^(T\d{3}) · (\S+)\s*$")
SPEAKER_ROLES = {"Beratung": "advisor", "Kundin": "customer", "Kunde": "customer"}


class ScriptTurn(BaseModel):
    turn_id: str  # T001
    speaker: str  # Beratung / Kundin as written in the script
    role: str  # advisor / customer
    text: str


class ScriptFile(BaseModel):
    dialogue_id: str  # file stem, e.g. Stufe2_C09
    title: str
    summary: str
    header: dict[str, str]  # "Key: value" lines before the first turn
    turns: list[ScriptTurn]


def parse_script(path: Path) -> ScriptFile:
    lines = path.read_text(encoding="utf-8").splitlines()
    first_turn = next((i for i, l in enumerate(lines) if TURN_RE.match(l)), len(lines))
    head = [l for l in lines[:first_turn] if l.strip()]

    title = head[0].split(" · ", 1)[-1].strip() if head else ""
    summary = head[1].strip() if len(head) > 1 and ":" not in head[1][:30] else ""
    header: dict[str, str] = {}
    for line in head[1:]:
        for part in line.split("; ") if line.startswith("Prüfpräfix") else [line]:
            key, sep, value = part.partition(":")
            if sep:
                header[key.strip()] = value.strip()
    # "Prüfpräfix bis T010" has no colon: keep it as its own key
    m = re.search(r"Prüfpräfix bis (T\d{3})", "\n".join(head))
    if m:
        header["Prüfpräfix bis"] = m.group(1)

    turns: list[ScriptTurn] = []
    for i in range(first_turn, len(lines)):
        m = TURN_RE.match(lines[i])
        if not m:
            continue
        text = lines[i + 1].strip() if i + 1 < len(lines) else ""
        turn_id, speaker = m.groups()
        turns.append(ScriptTurn(turn_id=turn_id, speaker=speaker, role=SPEAKER_ROLES.get(speaker, "unknown"), text=text))

    return ScriptFile(dialogue_id=path.stem, title=title, summary=summary, header=header, turns=turns)
