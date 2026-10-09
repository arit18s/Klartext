"""SQLModel tables, as in 05_BACKEND_STRUCTURE.md section 8.

JSON payloads are stored as text columns; large artifacts live on disk under DATA_DIR.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Call(SQLModel, table=True):
    __tablename__ = "calls"
    id: str = Field(primary_key=True)  # file stem, e.g. Stufe2_C09-K3
    file_path: str
    file_hash: str = Field(unique=True, index=True)
    dialogue_id: str | None = None  # null for unknown file names
    variant: str | None = None  # clean / noisy / null
    level: int | None = None
    duration_s: float | None = None
    advisor_name: str | None = None
    status: str = "queued"  # queued / transcribing / checking / done / failed / waiting_for_asr
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    processed_at: datetime | None = None


class Segment(SQLModel, table=True):
    __tablename__ = "segments"
    id: int | None = Field(default=None, primary_key=True)
    call_id: str = Field(foreign_key="calls.id", index=True)
    seg_id: str
    start_s: float
    end_s: float
    role: str | None = None  # advisor / customer
    text: str
    low_confidence: bool = False


class ConfigVersion(SQLModel, table=True):
    __tablename__ = "config_versions"
    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True)  # keywords / families / thresholds / model
    json_data: str = Field(sa_column=Column("json", Text, nullable=False))
    note: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    active: bool = False


class KeywordHit(SQLModel, table=True):
    __tablename__ = "keyword_hits"
    id: int | None = Field(default=None, primary_key=True)
    call_id: str = Field(index=True)
    config_version_id: int
    keyword_id: str
    family: str
    phrase: str
    seg_id: str
    start_s: float
    end_s: float


class CheckRun(SQLModel, table=True):
    __tablename__ = "check_runs"
    id: int | None = Field(default=None, primary_key=True)
    call_id: str = Field(index=True)
    family: str
    sample_idx: int
    model: str
    config_version_id: int
    output_json: str = Field(sa_column=Column(Text))
    valid: bool
    latency_ms: int | None = None
    created_at: datetime = Field(default_factory=utcnow)


class CheckResult(SQLModel, table=True):
    __tablename__ = "check_results"
    call_id: str = Field(primary_key=True)
    family: str = Field(primary_key=True)
    score: float | None = None  # null when the family failed
    event_majority: str  # present / absent / undetermined / not_applicable / failed
    agreement: float | None = None
    needs_human_votes: int = 0
    open_question: str | None = None
    reason: str | None = None
    reason_de: str | None = None
    benign_explanation: str | None = None


class Decision(SQLModel, table=True):
    __tablename__ = "decisions"
    call_id: str = Field(primary_key=True)
    verdict: str  # alarm / review / no_alert
    family: str | None = None
    score: float | None = None
    reason: str | None = None
    reason_de: str | None = None
    open_question: str | None = None
    asr_uncertain: bool = False
    twin_call_id: str | None = None
    twin_note: str | None = None
    thresholds_version_id: int | None = None
    decided_at: datetime = Field(default_factory=utcnow)


class Evidence(SQLModel, table=True):
    __tablename__ = "evidence"
    id: int | None = Field(default=None, primary_key=True)
    call_id: str = Field(index=True)
    family: str
    seg_id: str
    role: str  # context / trigger / exclusion
    start_s: float
    end_s: float
    speaker_role: str | None = None
    quote: str
    note: str | None = None
    snippet_path: str | None = None


class Feedback(SQLModel, table=True):
    __tablename__ = "feedback"
    id: int | None = Field(default=None, primary_key=True)
    call_id: str = Field(index=True)
    label: str  # correct / false_alarm / missed / escalated_to_alarm / closed_no_alert / note
    note: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class TriggerSent(SQLModel, table=True):
    __tablename__ = "triggers_sent"
    id: int | None = Field(default=None, primary_key=True)
    call_id: str = Field(index=True)
    remote_id: str | None = None
    url: str
    status_code: int | None = None
    created_at: datetime = Field(default_factory=utcnow)


class EvalRun(SQLModel, table=True):
    __tablename__ = "eval_runs"
    id: int | None = Field(default=None, primary_key=True)
    split: str
    config_snapshot_json: str = Field(sa_column=Column(Text))
    metrics_json: str = Field(sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utcnow)


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"
    id: int | None = Field(default=None, primary_key=True)
    actor: str
    action: str
    target: str | None = None
    details_json: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utcnow)
