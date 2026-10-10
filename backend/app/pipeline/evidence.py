"""Evidence rows and audio snippets (05_BACKEND_STRUCTURE.md section 6, plan B20).

For the decided family: every evidence item becomes a row with exact times from word timestamps.
Quotes are snapped to an exact substring of the segment text (API_CONTRACT: `quote` is a substring).
A no-alert call keeps only exclusion items. Snippets: the passage with SNIPPET_PAD_S before and after,
cut with ffmpeg into DATA_DIR/snippets/<call_id>_<seg_id>.wav (no shell, paths confined to DATA_DIR).
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from pydantic import BaseModel
from rapidfuzz import fuzz

from app.config import get_settings
from app.models.checks import EvidenceItem, FamilyResult
from app.models.transcript import Transcript, TranscriptSegment
from app.pipeline.decide import DecisionOutput

SNIPPET_PAD_S = 10.0
SNAP_MIN_RATIO = 80


class EvidenceRow(BaseModel):
    family: str
    seg_id: str
    role: str  # context / trigger / exclusion
    start_s: float
    end_s: float
    speaker_role: str | None
    quote: str
    note: str | None
    snippet_path: str | None = None  # relative to DATA_DIR; never returned by the API


def _expand(text: str, start: int, end: int) -> tuple[int, int]:
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    while end < len(text) and not text[end].isspace():
        end += 1
    return start, end


def snap_quote(quote: str, text: str) -> tuple[str, int, int] | None:
    """Best matching exact substring of `text` for `quote`, widened to whole words. None if no good match."""
    if not quote or not text:
        return None
    exact = text.find(quote)
    if exact != -1:
        return quote, exact, exact + len(quote)
    al = fuzz.partial_ratio_alignment(quote.casefold(), text.casefold(), score_cutoff=SNAP_MIN_RATIO)
    if al is None:
        return None
    s, e = _expand(text, al.dest_start, al.dest_end)
    snapped = text[s:e].strip(" ,;:")
    s = text.find(snapped, s)
    return snapped, s, s + len(snapped)


def _word_span(seg: TranscriptSegment, start_char: int, end_char: int) -> tuple[float, float]:
    """Times of the words that overlap the character span (words are found in order in the segment text)."""
    pos, first, last = 0, None, None
    for w in seg.words:
        token = w.w.strip()
        idx = seg.text.find(token, pos) if token else -1
        if idx == -1:
            continue
        pos = idx + len(token)
        if idx < end_char and pos > start_char:
            first = first or w
            last = w
    if first is None or last is None:
        return seg.start_s, seg.end_s
    return first.start, last.end


def build_rows(decision: DecisionOutput, families: dict[str, FamilyResult], t: Transcript) -> list[EvidenceRow]:
    fam = decision.family
    if fam is None or fam not in families or families[fam].failed:
        return []
    items: list[EvidenceItem] = families[fam].evidence
    if decision.verdict == "no_alert":
        items = [i for i in items if i.role == "exclusion"]
    segs = {s.seg_id: s for s in t.segments}
    rows = []
    for item in items:
        seg = segs.get(item.seg_id)
        if seg is None:
            continue
        snapped = snap_quote(item.quote, seg.text)
        if snapped is None:  # the guard already checked the quote; if snapping still fails, quote the segment
            quote, start, end = seg.text, seg.start_s, seg.end_s
        else:
            quote, cs, ce = snapped
            start, end = _word_span(seg, cs, ce)
        rows.append(EvidenceRow(family=fam, seg_id=seg.seg_id, role=item.role, start_s=round(start, 2), end_s=round(end, 2),
                                speaker_role=seg.role, quote=quote, note=item.note))
    return sorted(rows, key=lambda r: (r.start_s, r.seg_id))


def _safe(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if root.resolve() not in resolved.parents and resolved != root.resolve():
        raise ValueError(f"Path {path} is outside {root}")
    return resolved


def cut_snippet(audio: Path, call_id: str, row: EvidenceRow, duration_s: float | None) -> str:
    """Cut the passage +-SNIPPET_PAD_S. Returns the path relative to DATA_DIR."""
    data = get_settings().data_path
    out_dir = data / "snippets"
    out_dir.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^\w.-]", "_", f"{call_id}_{row.seg_id}") + ".wav"
    out = _safe(out_dir / name, data)
    start = max(0.0, row.start_s - SNIPPET_PAD_S)
    end = row.end_s + SNIPPET_PAD_S
    if duration_s:
        end = min(duration_s, end)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-t", f"{max(0.1, end - start):.2f}",
           "-i", str(audio), "-ar", "16000", "-ac", "1", str(out)]
    subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    return str(out.relative_to(data.resolve()))
