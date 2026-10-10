"""Number normaliser (05_BACKEND_STRUCTURE.md section 1 stage 3, plan B16).

German and common Swiss German number words to digits, including compounds
("viertausendfünfhundert", "viertuusigfüüfhundert", "sibeundzwänzg"), plus digit strings with
thousands separators ("4'500", "4.500"). Digit sequence detection works on word lists so the
caller can attach word timestamps.
"""

from __future__ import annotations

import re

from pydantic import BaseModel

UNITS = {
    0: ["null"],
    1: ["eins", "eis", "ein", "eine", "einen"],
    2: ["zwei", "zwöi", "zwo", "zwee", "zwoi"],
    3: ["drei", "drü", "drii"],
    4: ["vier"],
    5: ["fünf", "füf", "foif", "füüf", "füünf", "fümf"],
    6: ["sechs", "sächs"],
    7: ["sieben", "sibe", "siebe", "sibä"],
    8: ["acht"],
    9: ["neun", "nüün", "nün", "nüün"],
}
TEENS = {
    10: ["zehn", "zäh", "zää"], 11: ["elf", "elf", "ölf"], 12: ["zwölf", "zwöuf"],
    13: ["dreizehn", "drizäh", "dreizäh"], 14: ["vierzehn", "vierzäh"], 15: ["fünfzehn", "füfzäh", "füüfzäh", "foifzäh"],
    16: ["sechzehn", "sächzäh", "sechzäh"], 17: ["siebzehn", "sibezäh", "siebzäh"], 18: ["achtzehn", "achtzäh"],
    19: ["neunzehn", "nüünzäh", "nünzäh"],
}
TENS = {
    20: ["zwanzig", "zwänzg", "zwänzig"], 30: ["dreissig", "dreißig", "drissig", "driissg", "drissg"],
    40: ["vierzig", "vierzg"], 50: ["fünfzig", "füfzg", "fünfzg", "füüfzg", "foifzg"],
    60: ["sechzig", "sächzg", "sechzg"], 70: ["siebzig", "sibezg", "siebzg"], 80: ["achtzig", "achtzg"],
    90: ["neunzig", "nüünzg", "nünzg"],
}
HUNDRED = ["hundert"]
THOUSAND = ["tausend", "tuusig", "tuusend"]
CONNECTORS = ["und", "e", "s"]  # "sibeundzwänzg", "einezwänzg", "achtshundert"

_MORPHEMES: list[tuple[str, str, int]] = sorted(
    [(w, "unit", v) for v, ws in UNITS.items() for w in ws]
    + [(w, "teen", v) for v, ws in TEENS.items() for w in ws]
    + [(w, "tens", v) for v, ws in TENS.items() for w in ws]
    + [(w, "hundred", 100) for w in HUNDRED]
    + [(w, "thousand", 1000) for w in THOUSAND]
    + [(w, "conn", 0) for w in CONNECTORS],
    key=lambda m: -len(m[0]),
)
_GROUPED_DIGITS = re.compile(r"^\d{1,3}(?:['’.\s]\d{3})+$")
_PLAIN_DIGITS = re.compile(r"^\d+$")


def _split(word: str) -> list[tuple[str, int]] | None:
    """Split a word fully into number morphemes, or None. Connectors only between numbers."""
    if not word:
        return []
    for text, kind, value in _MORPHEMES:
        if word.startswith(text):
            rest = _split(word[len(text):])
            if rest is not None:
                return [(kind, value)] + rest
    return None


def word_to_number(word: str) -> int | None:
    """'viertuusigfüüfhundert' -> 4500, 'sibeundzwänzg' -> 27, '4.500' -> 4500, 'Code' -> None."""
    w = word.casefold().strip(".,;:!?«»\"'()-–")
    if _PLAIN_DIGITS.match(w):
        return int(w)
    if _GROUPED_DIGITS.match(w):
        return int(re.sub(r"\D", "", w))
    parts = _split(w)
    if not parts or parts[0][0] == "conn" or parts[-1][0] == "conn":
        return None
    if all(k == "conn" for k, _ in parts):
        return None
    total = current = 0
    for kind, value in parts:
        if kind in ("unit", "teen", "tens"):
            current += value
        elif kind == "hundred":
            current = (current or 1) * 100
        elif kind == "thousand":
            total += (current or 1) * 1000
            current = 0
    return total + current


class DigitSequence(BaseModel):
    digits: str  # "836194" or "4500"
    start_word: int  # index into the word list
    end_word: int  # inclusive
    kind: str  # "spelled" (digit by digit) or "number" (one value)


def digit_sequences(words: list[str], min_spelled: int = 3, min_value: int = 100) -> list[DigitSequence]:
    """Critical numbers: runs of >= min_spelled single digits read one by one (codes, PINs),
    and single numbers >= min_value (amounts, references). Grouped digits like '4 500' count as one number."""
    vals = [word_to_number(w) for w in words]
    out: list[DigitSequence] = []
    i = 0
    while i < len(words):
        v = vals[i]
        if v is not None and v < 10 and len(re.sub(r"\D", "", words[i])) <= 1:
            j = i
            while j + 1 < len(words) and vals[j + 1] is not None and vals[j + 1] < 10 and len(re.sub(r"\D", "", words[j + 1])) <= 1:
                j += 1
            if j - i + 1 >= min_spelled:
                out.append(DigitSequence(digits="".join(str(vals[k]) for k in range(i, j + 1)), start_word=i, end_word=j, kind="spelled"))
            i = j + 1
            continue
        if v is not None and v >= min_value:
            out.append(DigitSequence(digits=str(v), start_word=i, end_word=i, kind="number"))
        i += 1
    return out


def tokenize(text: str) -> list[str]:
    """Words for number detection: keeps "4'500" / "4.500" together, splits "acht, drü" at commas."""
    text = re.sub(r"(?<=\d)\s*['’]\s*(?=\d{3}\b)", "'", text)  # ASR writes Swiss amounts as "10 '000": -> "10'000"
    text = re.sub(r"(?<=\d)[ ](?=\d{3}\b)", "'", text)  # "4 500" -> "4'500"
    return [t for t in re.split(r"[\s,;:!?«»\"()–]+", text) if t and t not in ("-", ".")]


_GROUP_HEAD = re.compile(r"^\d{1,3}$")
_GROUP_TAIL = re.compile(r"^['’]?\d{3}[.,;:!?]?$")


def digit_sequences_from_words(words: list[str], min_spelled: int = 3, min_value: int = 100) -> list[DigitSequence]:
    """digit_sequences() on ASR words, after merging digit groups the ASR writes as separate words
    ("836" "174" -> 836174, "10" "'000" -> 10000). Word indices refer to the original list (for timestamps)."""
    tokens: list[str] = []
    spans: list[tuple[int, int]] = []
    i = 0
    while i < len(words):
        w = words[i].strip()
        j = i
        if _GROUP_HEAD.match(w.rstrip(".,;:!?")):
            merged = w.rstrip(".,;:!?")
            while j + 1 < len(words) and _GROUP_TAIL.match(words[j + 1].strip()) and not re.search(r"[.,;:!?]$", words[j].strip()):
                merged += re.sub(r"\D", "", words[j + 1])
                j += 1
            w = merged if j > i else words[i]
        tokens.append(w)
        spans.append((i, j))
        i = j + 1
    out = []
    for d in digit_sequences(tokens, min_spelled, min_value):
        out.append(d.model_copy(update={"start_word": spans[d.start_word][0], "end_word": spans[d.end_word][1]}))
    return out
