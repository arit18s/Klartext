"""Transcript JSON schema (05_BACKEND_STRUCTURE.md section 2). Written to data/transcripts/<call_id>.json."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Word(BaseModel):
    w: str
    start: float
    end: float
    p: float | None = None  # ASR word probability


class TranscriptSegment(BaseModel):
    seg_id: str  # S001
    start_s: float
    end_s: float
    speaker: str | None = None  # SPEAKER_00 / SPEAKER_01
    role: Literal["advisor", "customer", "unknown"] | None = None
    text: str
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    low_confidence: bool = False
    words: list[Word] = Field(default_factory=list)


class Transcript(BaseModel):
    call_id: str
    source: Literal["asr", "script"] = "asr"  # "script" = development only, never in the final pipeline
    asr_model: str | None = None
    duration_s: float
    advisor_name: str | None = None
    segments: list[TranscriptSegment]
