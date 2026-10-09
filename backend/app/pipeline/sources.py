"""Transcript sources.

!!! DEVELOPMENT ONLY: ScriptTranscriptSource !!!
It turns a case script (Transkript/) into the transcript format so the family checks can be
built before ASR exists. Scripts are evaluation data: the final pipeline must use ASR transcripts.
Output is marked `source: "script"`. Timestamps are fake (10 s per turn, words spread evenly).

Run from backend/: python -m app.pipeline.sources [--out data/transcripts_script]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from app.config import get_settings
from app.eval.script_parser import parse_script
from app.models.transcript import Transcript, TranscriptSegment, Word

SECONDS_PER_TURN = 10.0


class ScriptTranscriptSource:
    """DEVELOPMENT ONLY. Never use in the final pipeline or for the hidden test set."""

    source = "script"

    def __init__(self, folder: Path | None = None) -> None:
        self.folder = folder or get_settings().case_data_path / "Transkript"

    def dialogue_ids(self) -> list[str]:
        return sorted(p.stem for p in self.folder.glob("*.txt"))

    def load(self, dialogue_id: str, call_id: str | None = None) -> Transcript:
        script = parse_script(self.folder / f"{dialogue_id}.txt")
        segments = []
        for i, turn in enumerate(script.turns):
            start = i * SECONDS_PER_TURN
            end = start + SECONDS_PER_TURN
            segments.append(
                TranscriptSegment(
                    seg_id=f"S{i + 1:03d}",
                    start_s=start,
                    end_s=end,
                    speaker=turn.speaker,
                    role=turn.role,
                    text=turn.text,
                    words=_spread_words(turn.text, start, end),
                )
            )
        return Transcript(
            call_id=call_id or dialogue_id,
            source="script",
            asr_model=None,
            duration_s=len(segments) * SECONDS_PER_TURN,
            segments=segments,
        )


def _spread_words(text: str, start: float, end: float) -> list[Word]:
    tokens = text.split()
    if not tokens:
        return []
    step = (end - start) / len(tokens)
    return [Word(w=t, start=round(start + i * step, 2), end=round(start + (i + 1) * step, 2)) for i, t in enumerate(tokens)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Write script transcripts (development only)")
    parser.add_argument("--out", type=Path, default=get_settings().data_path / "transcripts_script")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    src = ScriptTranscriptSource()
    total = 0
    for did in src.dialogue_ids():
        t = src.load(did)
        path = args.out / f"{t.call_id}.json"
        path.write_text(t.model_dump_json(indent=2))
        Transcript.model_validate_json(path.read_text())  # round-trip validation
        total += len(t.segments)
    print(f"Wrote {len(src.dialogue_ids())} script transcripts ({total} segments) to {args.out}, all valid")


if __name__ == "__main__":
    main()
