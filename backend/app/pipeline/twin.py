"""Twin call (05_BACKEND_STRUCTURE.md section 6, plan B21).

Pairs each flagged call (alarm / review) with the most similar call that was NOT flagged, and back.
Similarity: best rapidfuzz token_set_ratio between the flagged call's trigger passage and any segment of
the other call. Below MIN_SIMILARITY there is no twin. Flagged vs not flagged (not just "different
verdict") so a call's own clean and noisy recordings never become twins without looking at file names.
One LLM sentence per pair says what differs; it is stored on both decisions.
"""

from __future__ import annotations

import json

from pydantic import BaseModel
from rapidfuzz import fuzz

from app.models.transcript import Transcript
from app.prompts import load
from app.services.llm_client import complete_json

MIN_SIMILARITY = 60
CONTEXT_SEGMENTS = 2  # segments shown before and after B's best match


class TwinNote(BaseModel):
    note: str


class CallView(BaseModel):
    call_id: str
    verdict: str
    family: str | None
    reason: str | None
    transcript: Transcript
    triggers: list[str]  # trigger quotes of the decided family (flagged calls)
    evidence: list[str]  # all evidence quotes with roles, for the note
    benign: dict[str, str | None]  # family -> benign explanation


class Twin(BaseModel):
    call_id: str
    twin_call_id: str
    similarity: float
    note: str | None


def _flagged(v: CallView) -> bool:
    return v.verdict in ("alarm", "review")


def _best_segment(text: str, t: Transcript) -> tuple[float, int]:
    best, idx = 0.0, -1
    for i, s in enumerate(t.segments):
        r = fuzz.token_set_ratio(text.casefold(), s.text.casefold())
        if r > best:
            best, idx = r, i
    return best, idx


def similarity(a: CallView, b: CallView) -> tuple[float, int]:
    """a is flagged: its triggers against every segment of b."""
    scores = [_best_segment(q, b.transcript) for q in a.triggers]
    return max(scores, default=(0.0, -1))


def note_for(a: CallView, b: CallView, b_idx: int) -> str | None:
    segs = b.transcript.segments
    window = segs[max(0, b_idx - CONTEXT_SEGMENTS): b_idx + CONTEXT_SEGMENTS + 1]
    b_lines = "\n".join(f"[{s.role or 'unknown'}] {s.text}" for s in window)
    user = (
        f"Call A was flagged: {a.verdict}, family {a.family}. Reason: {a.reason}\n"
        f"<call_a>\n" + "\n".join(a.evidence) + "\n</call_a>\n\n"
        f"Call B was not flagged. Its harmless reading for this family: {b.benign.get(a.family or '', None) or 'none given'}\n"
        f"<call_b>\n{b_lines}\n</call_b>"
    )
    r = complete_json(load("twin_system.md"), user, TwinNote, temperature=0.0)
    return r.value.note.strip() if r.ok and r.value else None


def find_twins(views: list[CallView], with_notes: bool = True) -> list[Twin]:
    flagged = [v for v in views if _flagged(v) and v.triggers]
    clear = [v for v in views if not _flagged(v)]
    best_for: dict[str, tuple[float, str, int, str, str]] = {}  # call -> (sim, twin, b_idx, flagged_id, clear_id)
    for a in flagged:
        for b in clear:
            sim, idx = similarity(a, b)
            if sim < MIN_SIMILARITY:
                continue
            for me, other in ((a.call_id, b.call_id), (b.call_id, a.call_id)):
                if sim > best_for.get(me, (0.0,))[0]:
                    best_for[me] = (sim, other, idx, a.call_id, b.call_id)
    by_id = {v.call_id: v for v in views}
    notes: dict[tuple[str, str], str | None] = {}
    twins = []
    for me, (sim, other, idx, fa, cb) in sorted(best_for.items()):
        if with_notes and (fa, cb) not in notes:
            notes[(fa, cb)] = note_for(by_id[fa], by_id[cb], idx)
        twins.append(Twin(call_id=me, twin_call_id=other, similarity=round(sim, 1), note=notes.get((fa, cb))))
    return twins


def load_view(call_id: str, data_path, decision: dict) -> CallView | None:
    roles = data_path / "roles" / f"{call_id}.json"
    if not roles.exists():
        return None
    t = Transcript.model_validate(json.loads(roles.read_text(encoding="utf-8"))["transcript"])
    ev_path = data_path / "evidence" / f"{call_id}.json"
    rows = json.loads(ev_path.read_text(encoding="utf-8")) if ev_path.exists() else []
    checks_path = data_path / "checks" / f"{call_id}.json"
    benign: dict[str, str | None] = {}
    if checks_path.exists():
        fams = json.loads(checks_path.read_text(encoding="utf-8"))["checks"]["families"]
        benign = {f: r.get("benign_explanation") for f, r in fams.items()}
    return CallView(
        call_id=call_id, verdict=decision["verdict"], family=decision.get("family"), reason=decision.get("reason"),
        transcript=t, triggers=[r["quote"] for r in rows if r["role"] == "trigger"],
        evidence=[f"[{r['role']}, {r.get('speaker_role') or 'unknown'}] {r['quote']}" for r in rows], benign=benign,
    )

