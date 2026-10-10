"""Script-turn to ASR-segment alignment (05_BACKEND_STRUCTURE.md section 10). EVALUATION ONLY.

Monotonic dynamic programming: every ASR segment is assigned to one script turn, never going back
in the script. Similarity is rapidfuzz token_set_ratio on normalised text with numbers as digits, so
digits, names and amounts anchor the alignment even though the script is Swiss German and the ASR
output is Standard German.
"""

from __future__ import annotations

import re

from pydantic import BaseModel
from rapidfuzz import fuzz

from app.eval.script_parser import ScriptTurn
from app.models.transcript import TranscriptSegment
from app.pipeline.normalise import tokenize, word_to_number

SKIP_PENALTY = 5.0  # per script turn skipped before the first segment


class Alignment(BaseModel):
    turn_index: list[int]  # per ASR segment: index into the script turns
    similarity: list[float]  # per ASR segment: similarity to its turn (0-100)

    @property
    def mean_similarity(self) -> float:
        return sum(self.similarity) / len(self.similarity) if self.similarity else 0.0


def norm_words(text: str) -> list[str]:
    out = []
    for tok in tokenize(text.casefold()):
        v = word_to_number(tok)
        out.append(str(v) if v is not None else re.sub(r"[^\w]", "", tok))
    return [w for w in out if w]


def align(segments: list[TranscriptSegment], turns: list[ScriptTurn]) -> Alignment:
    if not segments or not turns:
        return Alignment(turn_index=[], similarity=[])
    seg_txt = [" ".join(norm_words(s.text)) for s in segments]
    turn_txt = [" ".join(norm_words(t.text)) for t in turns]
    sim = [[fuzz.token_set_ratio(a, b) for b in turn_txt] for a in seg_txt]
    n, m = len(segments), len(turns)
    best = [[0.0] * m for _ in range(n)]
    back = [[0] * m for _ in range(n)]
    for j in range(m):
        best[0][j] = sim[0][j] - SKIP_PENALTY * j
    for i in range(1, n):
        run, arg = float("-inf"), 0
        for j in range(m):
            if best[i - 1][j] > run:
                run, arg = best[i - 1][j], j
            best[i][j] = run + sim[i][j]
            back[i][j] = arg
    j = max(range(m), key=lambda k: best[n - 1][k])
    path = [0] * n
    for i in range(n - 1, -1, -1):
        path[i] = j
        j = back[i][j]
    return Alignment(turn_index=path, similarity=[float(sim[i][path[i]]) for i in range(n)])
