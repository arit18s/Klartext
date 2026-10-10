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
    # Wrong speaker (the fallback's weakness), but the name follows that speaker's own "mein Name ist …", never "Kunde".
    assert r.transcript.advisor_name == "Peter Huber"


def test_names_never_role_words_and_only_from_the_advisors_lines(monkeypatch: pytest.MonkeyPatch):
    # The LLM names the customer: rejected, because the advisor never says it. "Ich bin" at a sentence start is no name
    # lead, so no name rather than a wrong one.
    monkeypatch.setattr(roles, "_llm_advisor", stub(RoleAnswer(advisor_speaker="SPEAKER_00", advisor_name="Peter Huber",
                                                               confidence="high", reason="x")))
    assert label_roles(transcript()).transcript.advisor_name is None
    for word in ("Kunde", "Kundin", "Inhaber", "Inhaberin", "Frau Kundin"):
        assert roles._clean_name(word, ["Ich bin Kunde, Kundin, Inhaber, Inhaberin"]) is None
    assert roles._clean_name("Sandra Keller", ["Ich bin Sandra Keller."]) == "Sandra Keller"


@pytest.mark.parametrize("line, name", [
    ("Mein Name ist Sandra Keller.", "Sandra Keller"),
    ("Grüezi, mein Name ist Sandra Keller, Kundenberatung.", "Sandra Keller"),
    ("Grüezi, hier ist Sandra Keller von der Beratung.", "Sandra Keller"),
    ("Da ist Twitter -Kund vom Technischen Service.", None),  # sentence-start "Da ist" is not a name lead (ASR noise)
    ("Ich heisse Sandra.", "Sandra"),
    ("ich bin unsicher, ob das stimmt.", None),  # the name itself must start upper case
    ("Ja, hier ist Ihr Konto.", None),  # formal pronoun, not a name
    ("Ich bin Kundin bei Ihnen.", None),  # role word
])
def test_fallback_name_pattern_any_case(line: str, name: str | None):
    m = roles.NAME_RE.search(line)
    assert roles._clean_name(m.group(1) if m else None, [line]) == name


def test_fallback_finds_a_capitalised_mein_name_ist(monkeypatch: pytest.MonkeyPatch):
    # The LLM fails; the greeting rule picks the speaker with "Mein Name ist …" and the name is found in any case.
    monkeypatch.setattr(roles, "_llm_advisor", stub(None))
    t = transcript().model_copy(update={"segments": [
        TranscriptSegment(seg_id="S001", start_s=0, end_s=3, speaker="SPEAKER_00", text="Grüezi, Kundenberatung der Bank, Mein Name ist Sandra Keller."),
        TranscriptSegment(seg_id="S002", start_s=4, end_s=7, speaker="SPEAKER_01", text="Grüezi, ich habe eine Frage."),
    ]})
    r = label_roles(t)
    assert (r.advisor_speaker, r.method, r.transcript.advisor_name) == ("SPEAKER_00", "cue", "Sandra Keller")
