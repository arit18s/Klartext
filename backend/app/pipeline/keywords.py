"""Keyword stage core (05_BACKEND_STRUCTURE.md section 3).

Fuzzy phrase matching (de + gsw) on normalised segment text, word-boundary aware.
Keyword hits are hints for the family checks and the keyword-only baseline. They never decide a verdict.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel
from rapidfuzz import fuzz

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
