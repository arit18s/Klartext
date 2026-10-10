"""Role labelling (D46): the LLM decides on every call; greeting cues only when it fails; names never role words.
Invented two-speaker openings, no case data. The LLM is replaced by a stub, so no network call."""

from __future__ import annotations

import pytest

from app.models.transcript import Transcript, TranscriptSegment
from app.pipeline import roles
from app.pipeline.roles import RoleAnswer, label_roles

# SPEAKER_00 = advisor who only answers "Ja, hallo?"; SPEAKER_01 = customer whose opening is full of bank words.
LINES = [
    ("SPEAKER_00", "Ja, hallo?"),
    ("SPEAKER_01", "Grüezi, mein Name ist Peter Huber, ich bin Kunde bei Ihrer Bank und habe ein Problem."),
    ("SPEAKER_00", "Okay. Können Sie mir Ihr Geburtsdatum sagen? Ich bin Sandra Keller."),
    ("SPEAKER_01", "3. Mai 1970."),
]


def transcript() -> Transcript:
    segs = [TranscriptSegment(seg_id=f"S{i:03d}", start_s=i * 4.0, end_s=i * 4.0 + 3.0, speaker=spk, text=txt)
            for i, (spk, txt) in enumerate(LINES, start=1)]
    return Transcript(call_id="probe", duration_s=20.0, segments=segs)


def stub(answer: RoleAnswer | None):
    return lambda t, speakers: answer


def test_llm_decides_even_when_customer_has_more_greeting_words(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(roles, "_llm_advisor", stub(RoleAnswer(advisor_speaker="SPEAKER_00", advisor_name="Sandra Keller",
                                                               confidence="high", reason="asks for the birth date")))
    r = label_roles(transcript())
    assert (r.advisor_speaker, r.method, r.role_confidence) == ("SPEAKER_00", "llm", 0.85)
    assert [s.role for s in r.transcript.segments] == ["advisor", "customer", "advisor", "customer"]
    assert r.transcript.advisor_name == "Sandra Keller"


def test_greeting_cues_only_when_the_llm_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(roles, "_llm_advisor", stub(None))
    r = label_roles(transcript())
    assert (r.advisor_speaker, r.method) == ("SPEAKER_01", "cue")  # the known weakness of the fallback
    # The name pattern only matches "ich bin Kunde" here ("mein Name ist" is capitalised in German and not matched);
    # the role word is rejected, so no name instead of "Kunde".
    assert r.transcript.advisor_name is None


def test_names_never_role_words_and_only_from_the_advisors_lines(monkeypatch: pytest.MonkeyPatch):
    # The LLM names the customer: rejected, because the advisor never says it; no role word from "ich bin Kunde".
    monkeypatch.setattr(roles, "_llm_advisor", stub(RoleAnswer(advisor_speaker="SPEAKER_00", advisor_name="Peter Huber",
                                                               confidence="high", reason="x")))
    assert label_roles(transcript()).transcript.advisor_name is None
    for word in ("Kunde", "Kundin", "Inhaber", "Inhaberin", "Frau Kundin"):
        assert roles._clean_name(word, ["Ich bin Kunde, Kundin, Inhaber, Inhaberin"]) is None
    assert roles._clean_name("Sandra Keller", ["Ich bin Sandra Keller."]) == "Sandra Keller"
