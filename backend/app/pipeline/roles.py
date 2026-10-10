"""Role labelling: which diarized speaker is the advisor (05_BACKEND_STRUCTURE.md section 2, plan B16).

Rule first: the speaker whose opening lines carry an institution or service greeting is the advisor.
If the cues do not decide, one short LLM call does (open-weight model, temperature 0, cached).
If that fails too, the first speaker is the advisor (the bank answers the call), with low confidence.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel
from rapidfuzz import fuzz

from app.models.transcript import Transcript
from app.prompts import load
from app.services.llm_client import complete_json

OPENING_SEGMENTS = 3  # per speaker, for the cue rule
LLM_SEGMENTS = 20  # opening lines shown to the LLM
ADVISOR_CUES = [
    r"\bbank\b", r"beratung", r"kundendienst", r"kundenservice", r"service[- ]?team", r"\bteam\b",
    r"verbunden", r"was kann ich für sie tun", r"wie kann ich (ihnen|euch) helfen", r"wie chan ich",
    r"was chan ich", r"mein name ist", r"\bgrüezi\b.*\bsind\b", r"guten tag.*\bsind\b",
]
NAME_RE = re.compile(r"(?:mein name ist|(?:hier|da) ist|ich bin|ich heisse|ich heiße)\s+([A-ZÄÖÜ][\w-]+(?:\s+[A-ZÄÖÜ][\w-]+)?)")


class RoleResult(BaseModel):
    transcript: Transcript
    advisor_speaker: str | None
    role_confidence: float  # 0.9 cue, 0.85 / 0.6 LLM high / low, 0.5 first-speaker fallback, 0 unknown
    method: str  # cue / llm / first_speaker / single_speaker / no_speakers


class RoleAnswer(BaseModel):
    advisor_speaker: str
    advisor_name: str | None
    confidence: Literal["high", "low"]
    reason: str


def _llm_advisor(t: Transcript, speakers: list[str]) -> RoleAnswer | None:
    lines = "\n".join(f"[{s.seg_id} {s.start_s:6.1f}s {s.speaker or 'unknown'}] {s.text}" for s in t.segments[:LLM_SEGMENTS])
    user = f"Speaker labels: {', '.join(speakers)}\n\nTranscript (first {LLM_SEGMENTS} lines):\n<transcript>\n{lines}\n</transcript>"
    r = complete_json(load("roles_system.md"), user, RoleAnswer, temperature=0.0)
    if not r.ok or r.value is None or r.value.advisor_speaker not in speakers:
        return None
    return r.value


NAME_SNAP_RATIO = 85


def canonical_name(name: str | None, known: dict[str, int]) -> str | None:
    """Snap an ASR-spelled advisor name to an already known one (>= NAME_SNAP_RATIO % similar, case-insensitive),
    so "Simone Wenger" and "Simone Wenga" count as one advisor. known: name -> number of calls with it.
    Most frequent wins among qualifying names. In production the advisor ID comes from telephony metadata."""
    if not name:
        return None
    matches = [(n, c) for n, c in known.items() if fuzz.ratio(name.casefold(), n.casefold()) >= NAME_SNAP_RATIO]
    if not matches:
        return name
    return max(matches, key=lambda nc: (nc[1], fuzz.ratio(name.casefold(), nc[0].casefold())))[0]


def _cue_score(texts: list[str]) -> int:
    joined = " ".join(texts).casefold()
    return sum(1 for cue in ADVISOR_CUES if re.search(cue, joined))


def label_roles(t: Transcript, use_llm: bool = True) -> RoleResult:
    speakers = list(dict.fromkeys(s.speaker for s in t.segments if s.speaker))
    if not speakers:
        return RoleResult(transcript=_with_roles(t, None), advisor_speaker=None, role_confidence=0.0, method="no_speakers")
    if len(speakers) == 1:
        return RoleResult(transcript=_with_roles(t, None), advisor_speaker=None, role_confidence=0.0, method="single_speaker")
    openings = {spk: [s.text for s in t.segments if s.speaker == spk][:OPENING_SEGMENTS] for spk in speakers}
    scores = {spk: _cue_score(txt) for spk, txt in openings.items()}
    ranked = sorted(speakers, key=lambda spk: -scores[spk])
    llm_name = None
    if scores[ranked[0]] > scores[ranked[1]]:
        advisor, conf, method = ranked[0], 0.9, "cue"
    elif use_llm and (answer := _llm_advisor(t, speakers)):
        advisor, conf, method, llm_name = answer.advisor_speaker, 0.85 if answer.confidence == "high" else 0.6, "llm", answer.advisor_name
    else:
        advisor, conf, method = speakers[0], 0.5, "first_speaker"
    labelled = _with_roles(t, advisor)
    name = llm_name or next((m.group(1) for txt in openings[advisor] if (m := NAME_RE.search(txt))), None)
    labelled = labelled.model_copy(update={"advisor_name": name or t.advisor_name})
    return RoleResult(transcript=labelled, advisor_speaker=advisor, role_confidence=conf, method=method)


def _with_roles(t: Transcript, advisor: str | None) -> Transcript:
    segs = [
        s.model_copy(update={"role": "unknown" if advisor is None or s.speaker is None else ("advisor" if s.speaker == advisor else "customer")})
        for s in t.segments
    ]
    return t.model_copy(update={"segments": segs})
