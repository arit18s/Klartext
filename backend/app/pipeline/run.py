"""Pipeline orchestrator (05_BACKEND_STRUCTURE.md section 1, plan B18).

Stage-major batches: each stage runs for every call before the next, so the LLM checks of all calls
share one bounded pool. Each stage is idempotent, writes data/<stage>/<call_id>.json and its DB rows,
and can be re-run from any point (`from_stage`). Statuses on the call row: queued, transcribing,
checking, done, failed, waiting_for_asr. Nothing here depends on file names.

Fail safe (CLAUDE.md rule 8): a stage error marks the call failed with a message (visible, retryable);
an empty transcript is decided as review; failed checks go to review via the decision rule.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

import soundfile as sf
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from app.config import get_settings
from app.db import get_engine
from app.db.config_store import get_active_config
from app.models.tables import AuditLog, Call, CheckResult, CheckRun, Decision, Evidence, KeywordHit, Segment
from app.models.transcript import Transcript
from app.pipeline.check_stage import CheckOutcome, decision_for, run_check_stage
from app.pipeline.decide import DecisionOutput
from app.pipeline.evidence import build_rows, cut_snippet
from app.pipeline.keywords import match_keywords
from app.pipeline.normalise import digit_sequences_from_words
from app.pipeline.notify import notify
from app.pipeline.roles import canonical_name, label_roles
from app.pipeline.twin import find_twins, load_view

log = logging.getLogger(__name__)

STAGES = ["asr", "roles", "normalise", "keywords", "checks", "decide", "evidence", "twin", "notify"]
PENDING_STAGES: list[str] = []
MIN_WORDS = 5  # fewer recognised words than this: "No speech recognised"
NO_SPEECH_REASON = "No speech recognised. Needs a human."
NO_SPEECH_REASON_DE = "Keine Sprache erkannt. Braucht einen Menschen."

# Pipeline status stages of API_CONTRACT.md (GET /pipeline/status)
STATUS_STAGE = {"asr": "transcribing", "roles": "diarizing", "normalise": "checking", "keywords": "checking",
                "checks": "checking", "decide": "deciding", "evidence": "deciding", "twin": "deciding", "notify": "deciding"}

_NAME_RE = re.compile(r"^(Stufe([123])_[A-Z]\d{2})-(K[1-4])$")


class StageError(Exception):
    """Expected failure with a plain-language message for the officer."""


class RunSummary(BaseModel):
    done: list[str] = []
    waiting_for_asr: list[str] = []
    failed: dict[str, str] = {}
    notified: dict[str, int] = {}  # sent / skipped / failed


# ---------- helpers ----------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dir(stage: str) -> Path:
    d = get_settings().data_path / stage
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write(stage: str, call_id: str, payload: BaseModel | dict | list) -> None:
    data = payload.model_dump() if isinstance(payload, BaseModel) else payload
    path = _dir(stage) / f"{call_id}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(path)


def _read(stage: str, call_id: str) -> dict:
    path = _dir(stage) / f"{call_id}.json"
    if not path.exists():
        raise StageError(f"Stage '{stage}' has no output for {call_id}. Run from an earlier stage.")
    return json.loads(path.read_text(encoding="utf-8"))


def display_fields(stem: str) -> tuple[str | None, str | None, int | None]:
    """dialogue_id / variant / level for DISPLAY and evaluation only; null for unknown names. Never used for logic."""
    m = _NAME_RE.match(stem)
    if not m:
        return None, None, None
    return m.group(1), "clean" if m.group(3) in ("K1", "K3") else "noisy", int(m.group(2))


def _live(call_id: str | None = None, stage: str | None = None, queue_changed: bool = False) -> None:
    """Report to the API's live state (SSE + /pipeline/status). Thread-safe on the API side; never raises here."""
    try:
        from app.api import events, pipeline_state

        if call_id and stage:
            pipeline_state.report_progress(call_id, STATUS_STAGE.get(stage, stage), (STAGES.index(stage) + 1) / len(STAGES),
                                           f"{stage} ({STAGES.index(stage) + 1} of {len(STAGES)})")
        if call_id:
            events.notify_call_updated(call_id)
        if queue_changed:
            events.notify_pipeline_status()
    except Exception:
        log.debug("Live update failed", exc_info=True)


def _set_status(call_id: str, status: str, error: str | None = None) -> None:
    with Session(get_engine()) as session:
        call = session.get(Call, call_id)
        if call:
            call.status, call.error = status, error
            if status == "done":
                call.processed_at = _now()
            session.add(call)
            session.commit()
    _live(call_id, queue_changed=True)


# ---------- registration ----------

def register(path: Path) -> tuple[Call, bool]:
    """Create (or find) the call row for a WAV. Returns (call, is_new). Dedup by file hash."""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    dialogue_id, variant, level = display_fields(path.stem)
    with Session(get_engine()) as session:
        existing = session.exec(select(Call).where(Call.file_hash == digest)).first()
        if existing:
            return existing, False
        try:
            duration = round(sf.info(str(path)).duration, 2)
        except RuntimeError:
            duration = None
        call_id = path.stem
        if session.get(Call, call_id) is not None:  # same name, different audio: keep both
            call_id = f"{path.stem}-{digest[:6]}"
        call = Call(id=call_id, file_path=str(path.resolve()), file_hash=digest, dialogue_id=dialogue_id,
                    variant=variant, level=level, duration_s=duration, status="queued")
        session.add(call)
        session.commit()
        session.refresh(call)
    _live(call.id, queue_changed=True)
    return call, True


# ---------- stages ----------

def stage_asr(call_id: str) -> Transcript | None:
    """Import the cached ASR transcript (data/transcripts/). The live ASR service is B17."""
    _set_status(call_id, "transcribing")
    path = get_settings().data_path / "transcripts" / f"{call_id}.json"
    if not path.exists():
        return None
    try:
        t = Transcript.model_validate_json(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise StageError(f"The transcript for {call_id} is not valid ({type(exc).__name__}). Transcribe the call again.") from exc
    if t.source != "asr":
        raise StageError(f"The transcript for {call_id} is not from speech recognition. The pipeline only accepts ASR transcripts.")
    _write("asr", call_id, t)
    return t


def _known_advisor_names(exclude: str) -> dict[str, int]:
    with Session(get_engine()) as session:
        rows = session.exec(select(Call.advisor_name).where(Call.id != exclude, Call.advisor_name.is_not(None))).all()
    known: dict[str, int] = {}
    for n in rows:
        known[n] = known.get(n, 0) + 1
    return known


def stage_roles(call_id: str) -> None:
    t = Transcript.model_validate(_read("asr", call_id))
    r = label_roles(t)
    name = canonical_name(r.transcript.advisor_name, _known_advisor_names(call_id))
    r = r.model_copy(update={"transcript": r.transcript.model_copy(update={"advisor_name": name})})
    _write("roles", call_id, {"transcript": r.transcript.model_dump(), "advisor_speaker": r.advisor_speaker,
                              "role_confidence": r.role_confidence, "method": r.method})
    with Session(get_engine()) as session:
        session.exec(delete(Segment).where(Segment.call_id == call_id))
        for s in r.transcript.segments:
            session.add(Segment(call_id=call_id, seg_id=s.seg_id, start_s=s.start_s, end_s=s.end_s, role=s.role,
                                text=s.text, low_confidence=s.low_confidence))
        call = session.get(Call, call_id)
        if call:
            call.advisor_name = r.transcript.advisor_name
            session.add(call)
        session.commit()


def _labelled(call_id: str) -> Transcript:
    return Transcript.model_validate(_read("roles", call_id)["transcript"])


def stage_normalise(call_id: str) -> None:
    """Digit sequences per segment with word timestamps (codes read out, amounts)."""
    out = []
    for s in _labelled(call_id).segments:
        words = [w.w for w in s.words]
        for d in digit_sequences_from_words(words):
            out.append({"seg_id": s.seg_id, "digits": d.digits, "kind": d.kind,
                        "start_s": s.words[d.start_word].start, "end_s": s.words[d.end_word].end})
    _write("normalise", call_id, out)


def stage_keywords(call_id: str) -> None:
    kw = get_active_config("keywords")
    hits = match_keywords(_labelled(call_id), kw.data)
    _write("keywords", call_id, {"config_version_id": kw.version_id, "hits": [h.model_dump() for h in hits]})
    with Session(get_engine()) as session:
        session.exec(delete(KeywordHit).where(KeywordHit.call_id == call_id))
        for h in hits:
            session.add(KeywordHit(call_id=call_id, config_version_id=kw.version_id, keyword_id=h.keyword_id,
                                   family=h.family or "", phrase=h.phrase, seg_id=h.seg_id, start_s=h.start_s, end_s=h.end_s))
        session.commit()


def stage_checks(call_ids: list[str]) -> dict[str, CheckOutcome]:
    s = get_settings()
    transcripts = []
    for cid in call_ids:
        t = _labelled(cid)
        if sum(len(seg.text.split()) for seg in t.segments) >= MIN_WORDS:
            transcripts.append(t)
            _set_status(cid, "checking")
    if not transcripts:
        return {}
    # Keyword hints are not passed to the check prompts yet: prompts were tuned without them (decide in B19).
    return run_check_stage(transcripts, _dir("checks"), get_active_config("families"), get_active_config("thresholds").data,
                           s.llm_model, s.llm_samples, s.llm_reasoning == "on", s.llm_concurrency)


def _asr_uncertain(t: Transcript, outcome: CheckOutcome) -> bool:
    """Any evidence segment of the top-scoring family has low ASR confidence (section 5)."""
    scored = [fr for fr in outcome.checks.families.values() if fr.score is not None]
    if not scored:
        return False
    top = max(scored, key=lambda fr: fr.score)
    low = {seg.seg_id for seg in t.segments if seg.low_confidence}
    return any(ev.seg_id in low for ev in top.evidence)


def stage_decide(call_id: str) -> DecisionOutput:
    t = _labelled(call_id)
    thresholds = get_active_config("thresholds")
    if sum(len(seg.text.split()) for seg in t.segments) < MIN_WORDS:
        d = DecisionOutput(verdict="review", family=None, score=0.0, reason=NO_SPEECH_REASON, reason_de=NO_SPEECH_REASON_DE,
                           open_question=None, rule="no_speech")
        _save_decision(call_id, d, thresholds.version_id, None)
        return d
    payload = _read("checks", call_id)
    outcome = CheckOutcome.model_validate(payload)
    s = get_settings()
    d = decision_for(outcome.checks, thresholds.data, s.llm_samples, asr_uncertain=_asr_uncertain(t, outcome))
    _save_decision(call_id, d, thresholds.version_id, outcome)
    return d


def _save_decision(call_id: str, d: DecisionOutput, thresholds_version: int | None, outcome: CheckOutcome | None) -> None:
    _write("decide", call_id, d.model_dump() | {"thresholds_version_id": thresholds_version})
    with Session(get_engine()) as session:
        if outcome:
            session.exec(delete(CheckRun).where(CheckRun.call_id == call_id))
            session.exec(delete(CheckResult).where(CheckResult.call_id == call_id))
            cc = outcome.checks
            for fam, fr in cc.families.items():
                session.add(CheckResult(call_id=call_id, family=fam, score=fr.score, event_majority=fr.event_majority,
                                        agreement=fr.agreement, needs_human_votes=fr.needs_human_votes,
                                        open_question=fr.open_question, reason=fr.reason, reason_de=fr.reason_de,
                                        benign_explanation=fr.benign_explanation))
                for r in fr.samples:
                    session.add(CheckRun(call_id=call_id, family=fam, sample_idx=r.sample_idx, model=cc.model,
                                         config_version_id=cc.families_version_id or 0,
                                         output_json=json.dumps(r.model_dump(), ensure_ascii=False), valid=r.valid,
                                         latency_ms=r.latency_ms))
        row = session.get(Decision, call_id) or Decision(call_id=call_id, verdict=d.verdict)
        row.verdict, row.family, row.score, row.reason, row.reason_de = d.verdict, d.family, d.score, d.reason, d.reason_de
        row.open_question, row.thresholds_version_id, row.decided_at = d.open_question, thresholds_version, _now()
        row.asr_uncertain = d.rule == "asr_uncertain"
        session.add(row)
        session.add(AuditLog(actor="system", action="decided", target=f"call:{call_id}",
                             details_json=json.dumps({"verdict": d.verdict, "family": d.family, "score": d.score,
                                                      "rule": d.rule, "thresholds_version_id": thresholds_version})))
        session.commit()


def stage_evidence(call_id: str) -> None:
    d = DecisionOutput.model_validate(_read("decide", call_id))
    checks_path = _dir("checks") / f"{call_id}.json"
    families = CheckOutcome.model_validate_json(checks_path.read_text(encoding="utf-8")).checks.families if checks_path.exists() else {}
    rows = build_rows(d, families, _labelled(call_id))
    with Session(get_engine()) as session:
        call = session.get(Call, call_id)
        audio, duration = (Path(call.file_path), call.duration_s) if call else (None, None)
    for row in rows:
        if audio and audio.exists():
            try:
                row.snippet_path = cut_snippet(audio, call_id, row, duration)
            except Exception as exc:  # a missing snippet must not block the decision
                log.warning("Snippet failed for %s %s: %s", call_id, row.seg_id, type(exc).__name__)
    _write("evidence", call_id, [r.model_dump() for r in rows])
    with Session(get_engine()) as session:
        session.exec(delete(Evidence).where(Evidence.call_id == call_id))
        for r in rows:
            session.add(Evidence(call_id=call_id, **r.model_dump()))
        session.commit()


def stage_twin_all() -> int:
    """Global: twins over every decided call (a new call can be the better twin of an old one)."""
    data = get_settings().data_path
    with Session(get_engine()) as session:
        decisions = {d.call_id: d for d in session.exec(select(Decision)).all()}
        views = [v for cid, d in decisions.items() if (v := load_view(cid, data, {"verdict": d.verdict, "family": d.family, "reason": d.reason}))]
        twins = {t.call_id: t for t in find_twins(views)}
        for cid, d in decisions.items():
            t = twins.get(cid)
            d.twin_call_id, d.twin_note = (t.twin_call_id, t.note) if t else (None, None)
            session.add(d)
        session.commit()
    _write("twin", "twins", [t.model_dump() for t in twins.values()])
    return len(twins)


# ---------- orchestration ----------

def _guard(call_id: str, summary: RunSummary, fn: Callable[[], object]) -> bool:
    try:
        fn()
        return True
    except StageError as exc:
        summary.failed[call_id] = str(exc)
    except Exception as exc:  # unexpected: still visible on the call, never a silent no-alert
        log.exception("Stage failed for %s", call_id)
        summary.failed[call_id] = f"Processing failed for {call_id} ({type(exc).__name__}). Retry the call; if it fails again, check the logs."
    _set_status(call_id, "failed", summary.failed[call_id])
    return False


def process(call_ids: list[str], from_stage: str = "asr") -> RunSummary:
    if from_stage not in STAGES:
        raise ValueError(f"Unknown stage '{from_stage}'. Stages: {', '.join(STAGES)}")
    start = STAGES.index(from_stage)
    started = time.monotonic()
    summary = RunSummary()
    active = list(call_ids)

    def run_each(stage: str, fn: Callable[[str], object]) -> None:
        nonlocal active
        if STAGES.index(stage) < start:
            return
        kept = []
        for cid in active:
            _live(cid, stage)
            if _guard(cid, summary, lambda cid=cid: fn(cid)):
                kept.append(cid)
        active = kept

    if start == 0:
        ready = []
        for cid in active:
            ok = _guard(cid, summary, lambda cid=cid: ready.append(cid) if stage_asr(cid) else summary.waiting_for_asr.append(cid))
            if ok and cid in summary.waiting_for_asr:
                _set_status(cid, "waiting_for_asr")
        active = ready
    run_each("roles", stage_roles)
    run_each("normalise", stage_normalise)
    run_each("keywords", stage_keywords)
    if STAGES.index("checks") >= start and active:
        for cid in active:
            _live(cid, "checks")
        try:
            stage_checks(active)
        except Exception as exc:
            log.exception("Check stage failed")
            for cid in active:
                summary.failed[cid] = f"The checks could not run ({type(exc).__name__}). Retry; the call stays queued."
                _set_status(cid, "failed", summary.failed[cid])
            active = []
    run_each("decide", stage_decide)
    run_each("evidence", stage_evidence)
    if active or start == STAGES.index("twin"):
        try:
            stage_twin_all()
        except Exception:  # twins are an explanation aid; never block decisions
            log.exception("Twin stage failed")
    if STAGES.index("notify") >= start:
        for cid in active:
            try:
                outcome = notify(cid)
                summary.notified[outcome] = summary.notified.get(outcome, 0) + 1
            except Exception:
                log.exception("Notify failed for %s", cid)
    for cid in active:
        _set_status(cid, "done")
        summary.done.append(cid)
    try:
        from app.api import pipeline_state

        pipeline_state.batch_finished(files=len(call_ids), failed=len(summary.failed), duration_s=round(time.monotonic() - started, 1))
    except Exception:
        log.debug("Batch report failed", exc_info=True)
    _live(queue_changed=True)
    return summary
