"""Role labelling: which diarized speaker is the advisor (05_BACKEND_STRUCTURE.md section 2, plan B16).

One short LLM call decides on every call (open-weight model, temperature 0, cached): who acts for the bank
(identifies the caller, sees the account, explains processes). Greeting words alone are not reliable: a customer
who says "mein Name ist …, ich bin Kunde bei Ihrer Bank" outscores an advisor who answers "Ja, hallo?" (D46).
Only if the LLM call fails: the speaker whose opening lines carry an institution or service greeting, and if
that does not decide either, the first speaker (the bank answers the call), with low confidence.
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
# Role words that "ich bin …" / "hier ist …" put where a name would be ("ich bin Kunde bei Ihrer Bank").
ROLE_WORDS = {
    "kunde", "kundin", "inhaber", "inhaberin", "berater", "beraterin", "kundenberater", "kundenberaterin",
    "mitarbeiter", "mitarbeiterin", "vertreter", "vertreterin", "bevollmächtigter", "bevollmächtigte",
    "tochter", "sohn", "mutter", "vater", "bank", "team", "kundendienst", "kundenservice", "beratung",
    # formal pronouns are capitalised in German: "hier ist Ihr Konto", "da ist Ihre Zahlung"
    "ihr", "ihre", "ihren", "ihrem", "ihrer", "sie",
}
# "mein Name ist" / "ich heisse" in any case ("Mein Name ist", "mein Name ist"). "hier ist" / "da ist" / "ich bin" stay
# lower case only: at a sentence start they precede too much that is no name (ASR: "Da ist Twitter -Kund vom Service").
# The name itself must start upper case.
NAME_RE = re.compile(r"(?:(?i:mein name ist|ich heisse|ich heiße)|(?:hier|da) ist|ich bin)\s+([A-ZÄÖÜ][\w-]+(?:\s+[A-ZÄÖÜ][\w-]+)?)")


class RoleResult(BaseModel):
    transcript: Transcript
    advisor_speaker: str | None
    role_confidence: float  # 0.9 cue, 0.85 / 0.6 LLM high / low, 0.5 first-speaker fallback, 0 unknown
    method: str  # llm / cue / first_speaker (both only when the LLM fails) / single_speaker / no_speakers


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


def _clean_name(name: str | None, advisor_texts: list[str]) -> str | None:
    """A name only if it is no role word and the advisor said it in their own lines (never the customer's name)."""
    if not name or not name.strip():
        return None
    tokens = name.strip().split()
    if any(tok.casefold().strip(".,") in ROLE_WORDS for tok in tokens):
        return None
    said = " ".join(advisor_texts).casefold()
    return name.strip() if any(len(tok) >= 3 and tok.casefold() in said for tok in tokens) else None


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
    llm_name = None
    if use_llm and (answer := _llm_advisor(t, speakers)):
        advisor, conf, method, llm_name = answer.advisor_speaker, 0.85 if answer.confidence == "high" else 0.6, "llm", answer.advisor_name
    else:  # fallback only: greeting cues, then the first speaker
        scores = {spk: _cue_score(txt) for spk, txt in openings.items()}
        ranked = sorted(speakers, key=lambda spk: -scores[spk])
        if scores[ranked[0]] > scores[ranked[1]]:
            advisor, conf, method = ranked[0], 0.9, "cue"
        else:
            advisor, conf, method = speakers[0], 0.5, "first_speaker"
    labelled = _with_roles(t, advisor)
    advisor_texts = [s.text for s in t.segments if s.speaker == advisor]
    regex_names = (m.group(1) for txt in openings[advisor] if (m := NAME_RE.search(txt)))
    name = _clean_name(llm_name, advisor_texts) or next((n for n in map(lambda x: _clean_name(x, advisor_texts), regex_names) if n), None)
    labelled = labelled.model_copy(update={"advisor_name": name or t.advisor_name})
    return RoleResult(transcript=labelled, advisor_speaker=advisor, role_confidence=conf, method=method)


def _with_roles(t: Transcript, advisor: str | None) -> Transcript:
    segs = [
        s.model_copy(update={"role": "unknown" if advisor is None or s.speaker is None else ("advisor" if s.speaker == advisor else "customer")})
        for s in t.segments
    ]
    return t.model_copy(update={"segments": segs})
