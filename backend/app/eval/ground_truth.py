"""Ground truth loader for Skript_mit_Sollbewertung/ (06_IMPLEMENTATION_PLAN.md B6).

EVALUATION ONLY. Nothing here may feed the pipeline.
Run from backend/: python -m app.eval.ground_truth
"""

from __future__ import annotations

import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from app.config import get_settings
from app.eval.script_parser import ScriptTurn, parse_script

VERDICTS = {"alarm": "alarm", "alert": "alarm", "review": "review", "no_alert": "no_alert", "no alert": "no_alert", "kein_alarm": "no_alert"}
NO_OPEN_QUESTION = "keine Voraussetzung"
KEYWORD_RE = re.compile(r"(K\d{2}) '([^']+)' (T\d{3}) ([KB]) (relevant|benign)")
SPEAKER_LETTER = {"K": "customer", "B": "advisor"}


class KeywordAnnotation(BaseModel):
    keyword_id: str
    phrase: str
    turn_id: str
    speaker_role: str  # advisor / customer
    label: str  # relevant / benign


class GroundTruth(BaseModel):
    dialogue_id: str
    level: int | None
    title: str
    family: str  # Testziel
    event: str  # Ereignis
    verdict: str  # alarm / review / no_alert
    reason: str  # Begründung
    open_question: str | None  # Offen, None when not needed
    check_prefix_until: str | None  # Prüfpräfix bis
    evidence_turns: list[str]  # Belege
    keyword_annotations: list[KeywordAnnotation]
    turns: list[ScriptTurn]

    @property
    def is_positive(self) -> bool:
        """Scored as a case: alarm or review expected."""
        return self.verdict in ("alarm", "review")


def normalise_verdict(raw: str) -> str:
    key = raw.strip().lower()
    if key not in VERDICTS:
        raise ValueError(f"Unknown verdict {raw!r}")
    return VERDICTS[key]


def parse_ground_truth(path: Path) -> GroundTruth:
    script = parse_script(path)
    h = script.header
    open_q = h.get("Offen", "").strip()
    level = re.match(r"Stufe(\d)", script.dialogue_id)
    return GroundTruth(
        dialogue_id=script.dialogue_id,
        level=int(level.group(1)) if level else None,
        title=script.title,
        family=h["Testziel"].strip(),
        event=h["Ereignis"].strip(),
        verdict=normalise_verdict(h["Bearbeitung"]),
        reason=h.get("Begründung", "").strip(),
        open_question=None if not open_q or open_q.startswith(NO_OPEN_QUESTION) else open_q,
        check_prefix_until=h.get("Prüfpräfix bis"),
        evidence_turns=re.findall(r"T\d{3}", h.get("Belege", "")),
        keyword_annotations=[
            KeywordAnnotation(keyword_id=k, phrase=p, turn_id=t, speaker_role=SPEAKER_LETTER[s], label=lbl)
            for k, p, t, s, lbl in KEYWORD_RE.findall(h.get("Keywordstellen", ""))
        ],
        turns=script.turns,
    )


@lru_cache
def load_ground_truth(folder: Path | None = None) -> dict[str, GroundTruth]:
    folder = folder or get_settings().case_data_path / "Skript_mit_Sollbewertung"
    return {p.stem: parse_ground_truth(p) for p in sorted(folder.glob("*.txt"))}


def main() -> None:
    gt = load_ground_truth()
    print(f"{'dialogue':<12} {'family':<14} {'event':<15} {'verdict':<9} {'evidence':<16} {'kw':>3} {'turns':>5}  open question")
    for g in gt.values():
        print(
            f"{g.dialogue_id:<12} {g.family:<14} {g.event:<15} {g.verdict:<9} {','.join(g.evidence_turns):<16} "
            f"{len(g.keyword_annotations):>3} {len(g.turns):>5}  {(g.open_question or '-')[:60]}"
        )
    counts = Counter(g.verdict for g in gt.values())
    print(f"\n{len(gt)} dialogues: " + " / ".join(f"{counts[v]} {v}" for v in ("alarm", "no_alert", "review")))
    print(f"Recordings (x2): " + " / ".join(f"{2 * counts[v]} {v}" for v in ("alarm", "no_alert", "review")))
    print("Families: " + ", ".join(f"{k}: {v}" for k, v in sorted(Counter(g.family for g in gt.values()).items())))
    kw = Counter(a.label for g in gt.values() for a in g.keyword_annotations)
    print(f"Keyword annotations: {sum(kw.values())} ({kw['relevant']} relevant, {kw['benign']} benign)")


if __name__ == "__main__":
    main()
