"""ASR batch job for the GPU box (plan B14). Standalone: needs faster-whisper, soundfile, numpy
(and pyannote.audio + torch for --diarize), not the Klartext app.

For every WAV: faster-whisper transcription with word timestamps (05_BACKEND_STRUCTURE.md section 2),
optional pyannote community-1 diarization, written as transcript JSON <out>/<call_id>.json.

Speakers are assigned per word from output.exclusive_speaker_diarization (maximum overlap), and ASR
segments are split where the speaker changes, so a quick exchange inside one Whisper segment still
gets the right speaker per line. Roles (advisor / customer) are labelled later on the laptop (B16).

Usage on the GPU box (after setup_gpu.sh and `source env.sh`):
  python run_asr.py --in ~/case-data/Audio --out ~/out/large-v3 --model large-v3 --diarize --limit 1
  python run_asr.py --in ~/case-data/Audio --out ~/out/flix --model ~/models/flix-swissgerman-full --diarize
Existing outputs are skipped (idempotent); --overwrite redoes them. HF_TOKEN comes from the environment.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

LANGUAGE = "de"
BEAM_SIZE = 5
LOW_LOGPROB = -1.0
HIGH_NO_SPEECH = 0.5
DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"  # runs locally; never precision-2 (pyannoteAI cloud)
MIN_RUN_WORDS = 2  # a speaker run shorter than this (one word) is merged into its neighbours


def load_whisper(model: str, compute_type: str):
    from faster_whisper import WhisperModel

    return WhisperModel(model, device="cuda", compute_type=compute_type)


def load_diarizer():
    import torch
    from pyannote.audio import Pipeline

    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN is not set (needed for the gated pyannote model).")
    pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL, token=token)
    pipeline.to(torch.device("cuda"))
    return pipeline


def read_audio(path: Path) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)  # downmix to mono
    return audio, sr


def transcribe(model, audio: np.ndarray) -> tuple[list[dict], float]:
    segments, info = model.transcribe(
        audio,  # 16 kHz mono float32 (the case audio); faster-whisper resamples only file inputs
        language=LANGUAGE,
        task="transcribe",
        beam_size=BEAM_SIZE,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=False,
    )
    out = []
    for seg in segments:  # generator: transcription happens while iterating
        out.append({
            "start": seg.start, "end": seg.end, "text": seg.text.strip(),
            "avg_logprob": seg.avg_logprob, "no_speech_prob": seg.no_speech_prob,
            "words": [{"w": w.word.strip(), "start": w.start, "end": w.end, "p": w.probability} for w in (seg.words or [])],
        })
    return out, info.duration


def diarize(pipeline, audio: np.ndarray, sr: int) -> list[tuple[float, float, str]]:
    import torch

    waveform = torch.from_numpy(audio).unsqueeze(0)  # (channel, time)
    output = pipeline({"waveform": waveform, "sample_rate": sr}, num_speakers=2)
    exclusive = output.exclusive_speaker_diarization  # no overlapping turns: made for matching ASR timestamps
    if hasattr(exclusive, "itertracks"):  # pyannote Annotation, in every version
        return [(seg.start, seg.end, label) for seg, _, label in exclusive.itertracks(yield_label=True)]
    return [(turn.start, turn.end, speaker) for turn, speaker in exclusive]


def speaker_at(start: float, end: float, turns: list[tuple[float, float, str]]) -> str | None:
    """Speaker with the largest overlap; if none overlaps, the nearest turn."""
    best, best_ov = None, 0.0
    for t0, t1, spk in turns:
        ov = min(end, t1) - max(start, t0)
        if ov > best_ov:
            best, best_ov = spk, ov
    if best is None and turns:
        mid = (start + end) / 2
        best = min(turns, key=lambda t: min(abs(mid - t[0]), abs(mid - t[1])))[2]
    return best


def _smooth(labels: list[str | None]) -> list[str | None]:
    """Merge one-word speaker islands into the surrounding speaker (diarization flicker at boundaries)."""
    out = labels[:]
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and out[j] == out[i]:
            j += 1
        if j - i < MIN_RUN_WORDS and len(out) > MIN_RUN_WORDS:
            prev = out[i - 1] if i > 0 else None
            nxt = out[j] if j < len(out) else None
            fill = prev if prev is not None else nxt
            if fill is not None:
                out[i:j] = [fill] * (j - i)
        i = j
    return out


def split_by_speaker(segments: list[dict], turns: list[tuple[float, float, str]] | None) -> list[dict]:
    if not turns:
        return [s | {"speaker": None} for s in segments]
    result = []
    for seg in segments:
        words = seg["words"]
        if not words:
            result.append(seg | {"speaker": speaker_at(seg["start"], seg["end"], turns)})
            continue
        labels = _smooth([speaker_at(w["start"], w["end"], turns) for w in words])
        run = [words[0]]
        for w, prev_lbl, lbl in zip(words[1:], labels, labels[1:]):
            if lbl != prev_lbl:
                result.append(_piece(seg, run, prev_lbl))
                run = []
            run.append(w)
        result.append(_piece(seg, run, labels[-1]))
    return result


def _piece(seg: dict, words: list[dict], speaker: str | None) -> dict:
    return seg | {"start": words[0]["start"], "end": words[-1]["end"], "text": " ".join(w["w"] for w in words).strip(),
                  "words": words, "speaker": speaker}


def to_transcript(call_id: str, model_name: str, duration: float, segments: list[dict]) -> dict:
    """Same shape as app.models.transcript.Transcript (validated on the laptop)."""
    out = []
    for i, s in enumerate(segments, 1):
        out.append({
            "seg_id": f"S{i:03d}",
            "start_s": round(s["start"], 2), "end_s": round(s["end"], 2),
            "speaker": s.get("speaker"), "role": None,  # role labelling: B16 on the laptop
            "text": s["text"],
            "avg_logprob": round(s["avg_logprob"], 4), "no_speech_prob": round(s["no_speech_prob"], 4),
            "low_confidence": s["avg_logprob"] < LOW_LOGPROB or s["no_speech_prob"] > HIGH_NO_SPEECH,
            "words": [{"w": w["w"], "start": round(w["start"], 2), "end": round(w["end"], 2), "p": round(w["p"], 3)} for w in s["words"]],
        })
    return {"call_id": call_id, "source": "asr", "asr_model": model_name, "duration_s": round(duration, 2), "advisor_name": None, "segments": out}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", type=Path, required=True, help="Folder with WAV files")
    ap.add_argument("--out", type=Path, required=True, help="Output folder for transcript JSON")
    ap.add_argument("--model", required=True, help="faster-whisper model name (large-v3) or path to a CTranslate2 model")
    ap.add_argument("--model-tag", help="Name stored as asr_model (default: last part of --model)")
    ap.add_argument("--compute-type", default="float16", help="float16 (default), int8_float16 if memory is tight")
    ap.add_argument("--diarize", action="store_true", help="Speaker separation with pyannote community-1 (num_speakers=2)")
    ap.add_argument("--limit", type=int, help="Only the first N files (smoke test)")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    files = sorted(args.inp.glob("*.wav"))[: args.limit]
    if not files:
        sys.exit(f"No WAV files in {args.inp}")
    args.out.mkdir(parents=True, exist_ok=True)
    tag = args.model_tag or Path(args.model.rstrip("/")).name

    t0 = time.monotonic()
    whisper = load_whisper(args.model, args.compute_type)
    diarizer = load_diarizer() if args.diarize else None
    print(f"Loaded {tag}{' + ' + DIARIZATION_MODEL if diarizer else ''} in {time.monotonic() - t0:.0f} s; {len(files)} files", flush=True)

    done = failed = 0
    for path in files:
        target = args.out / f"{path.stem}.json"
        if target.exists() and not args.overwrite:
            continue
        started = time.monotonic()
        try:
            audio, sr = read_audio(path)
            if sr != 16000:
                raise ValueError(f"{sr} Hz, expected 16 kHz (convert with ffmpeg -ar 16000 -ac 1)")
            segments, duration = transcribe(whisper, audio)
            turns = diarize(diarizer, audio, sr) if diarizer else None
            transcript = to_transcript(path.stem, tag, duration, split_by_speaker(segments, turns))
            tmp = target.with_suffix(".tmp")
            tmp.write_text(json.dumps(transcript, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(target)
            done += 1
            speakers = sorted({s["speaker"] for s in transcript["segments"] if s["speaker"]})
            print(f"{path.stem}: {duration:.0f} s audio, {len(transcript['segments'])} segments, speakers {speakers or '-'}, "
                  f"{time.monotonic() - started:.1f} s", flush=True)
        except Exception as exc:  # one bad file must not stop the batch
            failed += 1
            print(f"{path.stem}: FAILED {type(exc).__name__}: {exc}", flush=True)

    print(f"Done: {done} written, {failed} failed, {time.monotonic() - t0:.0f} s total. Output: {args.out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
