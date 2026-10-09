"""Family check schemas (05_BACKEND_STRUCTURE.md section 4).

LLM output models have only required fields (nullable where optional) so they work with strict
structured output. Code, not the model, computes scores and verdicts.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Event = Literal["present", "absent", "undetermined", "not_applicable"]
EVENT_VALUE = {"present": 1.0, "undetermined": 0.5, "absent": 0.0, "not_applicable": 0.0}


class EvidenceItem(BaseModel):
    seg_id: str
    role: Literal["context", "trigger", "exclusion"]
    quote: str


class KeywordJudgement(BaseModel):
    keyword_id: str
    seg_id: str
    label: Literal["relevant", "benign"]


class CheckSample(BaseModel):
    """One LLM answer for one family in one call."""

    event: Event
    needs_human: bool
    open_question: str | None
    benign_explanation: str
    reason: str
    reason_de: str
    evidence: list[EvidenceItem]
    keyword_judgements: list[KeywordJudgement]


class SampleRecord(BaseModel):
    """A sample after the hallucination guard, plus its cost."""

    sample_idx: int
    valid: bool  # False = failed (no usable answer)
    sample: CheckSample | None
    guard_notes: list[str]
    error: str | None
    cached: bool
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    reasoning_tokens: int


class FamilyResult(BaseModel):
    """Aggregate of k samples for one family (table check_results)."""

    family: str
    score: float | None  # 0-100, None when failed
    event_majority: str  # event, or "failed"
    agreement: float | None  # share of valid samples with the majority event
    agreement_text: str  # "3 of 3"
    needs_human_votes: int
    valid_samples: int
    open_question: str | None
    reason: str | None
    reason_de: str | None
    benign_explanation: str | None
    evidence: list[EvidenceItem]
    samples: list[SampleRecord]

    @property
    def failed(self) -> bool:
        return self.event_majority == "failed"


NumberKind = Literal[
    "login_code", "one_time_password", "pin", "password", "card_number", "iban", "account_number",
    "invoice_reference", "tracking_number", "amount", "date_or_time", "phone_number", "other",
]
NumberStatus = Literal["active", "expired", "sample", "unclear", "not_applicable"]


class NumberObject(BaseModel):
    seg_id: str
    value: str  # digits as spoken, normalised to digits where possible
    kind: NumberKind
    status: NumberStatus  # for secrets: is it currently valid?
    note: str


class NumbersOutput(BaseModel):
    """Numbers helper: classifies number objects. Never produces a verdict."""

    numbers: list[NumberObject]
