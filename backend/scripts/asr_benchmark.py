"""ASR bake-off (plan B15). EVALUATION ONLY: scripts and annotations are compared, never fed to the pipeline.

Per model (folder data/transcripts_<model>/) and per clean / noisy:
  - digit recall: critical number sequences in the script (codes read digit by digit, amounts >= 100),
    normalised to digits on both sides (Swiss German script vs Standard German ASR), found in the ASR text
  - keyword recall: annotated keyword passages (Keywordstellen) whose keyword the keyword stage finds in the ASR text
  - rough WER against the script (high by design: dialect script vs Standard German output)
  - speaker agreement: ASR speaker vs script role on aligned turns (after a majority speaker->role mapping)
The model is chosen on DEV recordings by critical token recall (digits + keywords), WER only breaks ties.
Names are not measured: in German every noun is capitalised, so names cannot be told apart automatically.

Holdout recordings are skipped unless --include-holdout (B29 reporting only).

Usage (from backend/): python scripts/asr_benchmark.py [--models large-v3 flix gcoli-turbo]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rapidfuzz.distance import Levenshtein  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db.config_store import get_active_config  # noqa: E402
from app.eval.align import align, norm_words  # noqa: E402
from app.eval.ground_truth import load_ground_truth  # noqa: E402
from app.eval.script_parser import parse_script  # noqa: E402
from app.models.transcript import Transcript  # noqa: E402
from app.pipeline.keywords import match_keywords  # noqa: E402
from app.pipeline.normalise import DigitSequence, digit_sequences, tokenize  # noqa: E402

SPLITS = Path(__file__).resolve().parents[1] / "app/eval/splits.json"


def recording_index() -> dict[str, tuple[str, str, str]]:
    """recording -> (dialogue, variant, split), from the fixed split file."""
    out = {}
    for g in json.loads(SPLITS.read_text())["groups"].values():
        for rec in g["recordings"]:
            dlg, k = rec.rsplit("-", 1)
            out[rec] = (dlg, "clean" if k in ("K1", "K3") else "noisy", g["split"])
    return out


def _same_number(a: str, b: str) -> bool:
    """Run boundaries can be off by one word on either side ("the last four: four, two, four, two" or a
    filler), so one sequence may contain the other with at most one extra digit."""
    short, long_ = sorted((a, b), key=len)
    return len(short) >= 3 and short in long_ and len(long_) - len(short) <= 1


def digits_found(script_seqs: list[DigitSequence], asr_seqs: list[DigitSequence]) -> int:
    """Amounts must match exactly. Codes read digit by digit may be split by a pause (adjacent runs
    joined) or carry one extra digit at an edge."""
    values = {a.digits for a in asr_seqs}
    spelled = [a.digits for a in asr_seqs]
    pool = spelled + [a + b for a, b in zip(spelled, spelled[1:])]
    found = 0
    for d in script_seqs:
        if d.kind == "number":
            found += d.digits in values
        else:
            found += any(d.digits == p or d.digits in p or _same_number(d.digits, p) for p in pool)
    return found


def measure(t: Transcript, script, annotated_kw: set[str], keywords: dict) -> dict:
    asr_text = " ".join(s.text for s in t.segments)
    script_text = " ".join(tr.text for tr in script.turns)
    script_digits = digit_sequences(tokenize(script_text))
    asr_digits = digit_sequences(tokenize(asr_text))
    found_kw = {h.keyword_id for h in match_keywords(t, keywords)}
    ref, hyp = norm_words(script_text), norm_words(asr_text)
    al = align(t.segments, script.turns)
    votes: dict[str, Counter] = defaultdict(Counter)
    for seg, ti in zip(t.segments, al.turn_index):
        if seg.speaker:
            votes[seg.speaker][script.turns[ti].role] += 1
    mapping = {spk: c.most_common(1)[0][0] for spk, c in votes.items()}
    spk_ok = sum(1 for seg, ti in zip(t.segments, al.turn_index) if seg.speaker and mapping.get(seg.speaker) == script.turns[ti].role)
    roles_distinct = len(set(mapping.values())) == 2  # both roles found, not one speaker for everything
    return {
        "digits_total": len(script_digits), "digits_found": digits_found(script_digits, asr_digits),
        "kw_total": len(annotated_kw), "kw_found": len(annotated_kw & found_kw),
        "wer_edits": Levenshtein.distance(ref, hyp), "ref_words": len(ref), "hyp_words": len(hyp),
        "segments": len(t.segments), "speaker_ok": spk_ok if roles_distinct else 0,
        "speaker_total": sum(1 for s in t.segments if s.speaker),
        "low_conf": sum(s.low_confidence for s in t.segments), "align_sim": round(al.mean_similarity, 1),
    }


def summarise(rows: list[dict]) -> dict:
    s = lambda k: sum(r[k] for r in rows)  # noqa: E731
    pct = lambda a, b: round(100 * a / b, 1) if b else None  # noqa: E731
    return {
        "n": len(rows),
        "digit_recall": pct(s("digits_found"), s("digits_total")), "digits": f"{s('digits_found')}/{s('digits_total')}",
        "keyword_recall": pct(s("kw_found"), s("kw_total")), "keywords": f"{s('kw_found')}/{s('kw_total')}",
        "critical_recall": pct(s("digits_found") + s("kw_found"), s("digits_total") + s("kw_total")),
        "wer": pct(s("wer_edits"), s("ref_words")), "word_ratio": round(s("hyp_words") / s("ref_words"), 2) if s("ref_words") else None,
        "speaker_agreement": pct(s("speaker_ok"), s("speaker_total")), "low_conf_pct": pct(s("low_conf"), s("segments")),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", nargs="*", help="Model folder suffixes (default: every data/transcripts_* folder)")
    ap.add_argument("--include-holdout", action="store_true", help="Also measure holdout recordings (B29 only)")
    args = ap.parse_args()
    s = get_settings()
    folders = [s.data_path / f"transcripts_{m}" for m in args.models] if args.models else sorted(s.data_path.glob("transcripts_*"))
    folders = [f for f in folders if f.is_dir() and f.name != "transcripts_script"]
    rec_index, gt, keywords = recording_index(), load_ground_truth(), get_active_config("keywords").data
    script_dir = s.case_data_path / "Transkript"

    report: dict = {}
    for folder in folders:
        model = folder.name.removeprefix("transcripts_")
        rows = defaultdict(list)
        for f in sorted(folder.glob("*.json")):
            if f.stem not in rec_index:
                continue
            dlg, variant, split = rec_index[f.stem]
            if split == "holdout" and not args.include_holdout:
                continue
            t = Transcript.model_validate_json(f.read_text(encoding="utf-8"))
            m = measure(t, parse_script(script_dir / f"{dlg}.txt"), {a.keyword_id for a in gt[dlg].keyword_annotations}, keywords)
            for key in (("all", "all"), (split, "all"), ("all", variant), (split, variant)):
                rows[key].append(m)
        report[model] = {f"{sp}/{va}": summarise(r) for (sp, va), r in sorted(rows.items())}

    hdr = f"{'model':<14} {'set':<14} {'n':>3} {'digits':>12} {'keywords':>12} {'critical':>9} {'WER':>6} {'words':>6} {'speaker':>8} {'lowconf':>8}"
    print(hdr)
    for model, sets in report.items():
        for name in ("dev/all", "dev/clean", "dev/noisy") + (("all/all",) if args.include_holdout else ()):
            if name in sets:
                r = sets[name]
                print(f"{model:<14} {name:<14} {r['n']:>3} {r['digits']:>7} {r['digit_recall'] or 0:>4.0f}% {r['keywords']:>7} {r['keyword_recall'] or 0:>4.0f}% "
                      f"{r['critical_recall'] or 0:>8.0f}% {r['wer'] or 0:>5.0f}% {r['word_ratio'] or 0:>6} {r['speaker_agreement'] or 0:>7.0f}% {r['low_conf_pct'] or 0:>7.0f}%")
    ranked = sorted((m for m in report if "dev/all" in report[m]),
                    key=lambda m: (-(report[m]["dev/all"]["critical_recall"] or 0), report[m]["dev/all"]["wer"] or 999))
    if ranked:
        print(f"\nChosen on dev by critical token recall (digits + keywords), WER as tie-break: {ranked[0]}")
    out = s.data_path / "eval" / "asr_benchmark.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"ranking_dev": ranked, "models": report}, indent=2), encoding="utf-8")
    print(f"Saved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
