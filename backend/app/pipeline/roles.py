"""Role labelling: which diarized speaker is the advisor (05_BACKEND_STRUCTURE.md section 2, plan B16).

Rule first: the speaker whose opening lines carry an institution or service greeting is the advisor.
Without any cue, the first speaker is the advisor (the bank answers the call), with lower confidence.
The LLM fallback for unclear cases (B16) and advisor name extraction come later.
"""

from __future__ import annotations

import re

from pydantic import BaseModel

from app.models.transcript import Transcript

OPENING_SEGMENTS = 3  # per speaker
ADVISOR_CUES = [
    r"\bbank\b", r"beratung", r"kundendienst", r"kundenservice", r"service[- ]?team", r"\bteam\b",
    r"verbunden", r"was kann ich für sie tun", r"wie kann ich (ihnen|euch) helfen", r"wie chan ich",
    r"was chan ich", r"mein name ist", r"\bgrüezi\b.*\bsind\b", r"guten tag.*\bsind\b",
]
NAME_RE = re.compile(r"(?:mein name ist|(?:hier|da) ist|ich bin|ich heisse|ich heiße)\s+([A-ZÄÖÜ][\w-]+(?:\s+[A-ZÄÖÜ][\w-]+)?)")


class RoleResult(BaseModel):
    transcript: Transcript
    advisor_speaker: str | None
    role_confidence: float  # 0.9 cue-based, 0.6 first-speaker fallback, 0 unknown
    method: str  # cue / first_speaker / single_speaker / no_speakers


def _cue_score(texts: list[str]) -> int:
    joined = " ".join(texts).casefold()
    return sum(1 for cue in ADVISOR_CUES if re.search(cue, joined))


def label_roles(t: Transcript) -> RoleResult:
    speakers = list(dict.fromkeys(s.speaker for s in t.segments if s.speaker))
    if not speakers:
        return RoleResult(transcript=_with_roles(t, None), advisor_speaker=None, role_confidence=0.0, method="no_speakers")
    if len(speakers) == 1:
        return RoleResult(transcript=_with_roles(t, None), advisor_speaker=None, role_confidence=0.0, method="single_speaker")
    openings = {spk: [s.text for s in t.segments if s.speaker == spk][:OPENING_SEGMENTS] for spk in speakers}
    scores = {spk: _cue_score(txt) for spk, txt in openings.items()}
    ranked = sorted(speakers, key=lambda spk: -scores[spk])
    if scores[ranked[0]] > scores[ranked[1]]:
        advisor, conf, method = ranked[0], 0.9, "cue"
    else:
        advisor, conf, method = speakers[0], 0.6, "first_speaker"
    labelled = _with_roles(t, advisor)
    name = next((m.group(1) for txt in openings[advisor] if (m := NAME_RE.search(txt))), None)
    labelled = labelled.model_copy(update={"advisor_name": name or t.advisor_name})
    return RoleResult(transcript=labelled, advisor_speaker=advisor, role_confidence=conf, method=method)


def _with_roles(t: Transcript, advisor: str | None) -> Transcript:
    segs = [
        s.model_copy(update={"role": "unknown" if advisor is None or s.speaker is None else ("advisor" if s.speaker == advisor else "customer")})
        for s in t.segments
    ]
    return t.model_copy(update={"segments": segs})
