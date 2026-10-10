"""Keyword stage core (05_BACKEND_STRUCTURE.md section 3).

Fuzzy phrase matching (de + gsw) on normalised segment text, word-boundary aware.
Keyword hits are hints for the family checks and the keyword-only baseline. They never decide a verdict.
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel
from rapidfuzz import fuzz
from sqlmodel import Session, delete, select

from app.config import get_settings
from app.db import get_engine
from app.db.config_store import get_active_config
from app.models.tables import KeywordHit as KeywordHitRow
from app.models.transcript import Transcript

MIN_RATIO = 88
SHORT_PHRASE = 4  # phrases this short (PIN, TAN) must match a whole token exactly


class KeywordHit(BaseModel):
    keyword_id: str
    family: str | None
    phrase: str
    seg_id: str
    start_s: float
    end_s: float


def normalise(text: str) -> str:
    text = text.casefold().replace("ß", "ss")
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def keyword_families(keyword_list: dict[str, Any]) -> dict[str, str]:
    """keyword_id -> family key (a keyword's family is the families entry that lists it)."""
    return {kid: fam for fam, meta in keyword_list.get("families", {}).items() for kid in meta.get("keywords", [])}


def _expand_to_words(text: str, start: int, end: int) -> tuple[int, int]:
    while start > 0 and text[start - 1] != " ":
        start -= 1
    while end < len(text) and text[end] != " ":
        end += 1
    return start, end


def phrase_in(phrase: str, text: str) -> bool:
    p = normalise(phrase)
    if not p or not text:
        return False
    if len(p) <= SHORT_PHRASE:
        return f" {p} " in f" {text} "
    al = fuzz.partial_ratio_alignment(p, text, score_cutoff=MIN_RATIO)
    if al is None:
        return False
    s, e = _expand_to_words(text, al.dest_start, al.dest_end)
    return fuzz.ratio(p, text[s:e]) >= MIN_RATIO


def _word_times(seg, phrase: str) -> tuple[float, float]:
    """Start/end of the phrase from word timestamps; falls back to the segment."""
    words = [normalise(w.w) for w in seg.words]
    target = normalise(phrase).split()
    if words and target:
        n = len(target)
        for i in range(len(words) - n + 1):
            if fuzz.ratio(" ".join(words[i : i + n]), " ".join(target)) >= MIN_RATIO:
                return seg.words[i].start, seg.words[i + n - 1].end
    return seg.start_s, seg.end_s


def match_keywords(t: Transcript, keyword_list: dict[str, Any]) -> list[KeywordHit]:
    fams = keyword_families(keyword_list)
    hits: list[KeywordHit] = []
    for seg in t.segments:
        text = normalise(seg.text)
        for kw in keyword_list.get("keywords", []):
            if not kw.get("enabled", True):
                continue
            for phrase in dict.fromkeys(kw.get("de", []) + kw.get("gsw", [])):  # dedupe, keep order
                if phrase_in(phrase, text):
                    start, end = _word_times(seg, phrase)
                    hits.append(KeywordHit(keyword_id=kw["id"], family=fams.get(kw["id"]), phrase=phrase, seg_id=seg.seg_id, start_s=start, end_s=end))
                    break  # one hit per keyword per segment
    return hits


def format_hints(hits: list[KeywordHit]) -> str:
    """Keyword hints for the check prompt."""
    if not hits:
        return "none"
    return "; ".join(f"{h.keyword_id} '{h.phrase}' in {h.seg_id} ({h.family or 'no family'})" for h in hits)


# ---------- rescan (POST /keywords/rescan, API_CONTRACT.md) ----------

class ChangedCall(BaseModel):
    call_id: str
    hits_before: int
    hits_after: int


class FlaggedCounts(BaseModel):
    before: int
    after: int


class RescanResult(BaseModel):
    """Response body of POST /keywords/rescan. Verdicts do not change: keywords are hints; a recheck changes verdicts."""

    config_version_id: int | None
    before: int
    after: int
    changed_calls: list[ChangedCall]
    keyword_only_flagged: FlaggedCounts


def rescan(keyword_list: dict[str, Any] | None = None, dry_run: bool = False) -> RescanResult:
    """Re-run the keyword stage on every call with a labelled transcript (data/roles/), compare with the
    stored hits, and (unless dry_run) replace them. Default config: the active keywords version.
    Runs in milliseconds per call; no LLM."""
    version_id = None
    if keyword_list is None:
        active = get_active_config("keywords")
        keyword_list, version_id = active.data, active.version_id
    roles_dir = get_settings().data_path / "roles"
    with Session(get_engine()) as session:
        before_rows = session.exec(select(KeywordHitRow)).all()
        before: dict[str, int] = {}
        for row in before_rows:
            before[row.call_id] = before.get(row.call_id, 0) + 1
        after: dict[str, list[KeywordHit]] = {}
        for path in sorted(roles_dir.glob("*.json")):
            t = Transcript.model_validate(json.loads(path.read_text(encoding="utf-8"))["transcript"])
            after[t.call_id] = match_keywords(t, keyword_list)
        if not dry_run:
            for call_id, hits in after.items():
                session.exec(delete(KeywordHitRow).where(KeywordHitRow.call_id == call_id))
                for h in hits:
                    session.add(KeywordHitRow(call_id=call_id, config_version_id=version_id or 0, keyword_id=h.keyword_id,
                                              family=h.family or "", phrase=h.phrase, seg_id=h.seg_id, start_s=h.start_s, end_s=h.end_s))
            session.commit()
    ids = sorted(set(before) | set(after))
    changed = [ChangedCall(call_id=c, hits_before=before.get(c, 0), hits_after=len(after.get(c, [])))
               for c in ids if before.get(c, 0) != len(after.get(c, []))]
    return RescanResult(
        config_version_id=version_id,
        before=sum(before.values()),
        after=sum(len(h) for h in after.values()),
        changed_calls=changed,
        keyword_only_flagged=FlaggedCounts(before=sum(1 for c in ids if before.get(c, 0) > 0),
                                           after=sum(1 for c in ids if after.get(c))),
    )
