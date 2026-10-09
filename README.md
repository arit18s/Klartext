# Klartext

**Every bank call heard. Every alert explained.**

Klartext checks every recorded call between bank customers and advisors in Swiss German. It flags insider trading, leaked access codes, information given to third parties and other compliance risks. For each flagged call it gives the compliance officer the exact passage worth listening to, with a timestamp and a plain-language reason. When the call does not contain enough facts to decide, Klartext says what is missing and hands the call to a human.

Built for the Inventx × Outcept case at sprintd Innovation Sprint Zurich, October 2026.

## The problem

- Banks record every advisory call, but only samples are ever reviewed. Misconduct goes undetected on both ends of the line.
- The calls are in Swiss German, where off-the-shelf speech tools struggle.
- Keyword filters do not work. "I'll read you the six digits" is harmless when a customer reads an expired sample from a manual. It is a serious incident when the customer has just started a login and reads out a live code. The difference sits in the context, often minutes earlier in the call.

## How Klartext solves it

```
WAV in inbox folder
  → speech to text (Swiss German, word timestamps)
  → speaker separation (advisor / customer)
  → number normalisation
  → keyword hints
  → one context-aware check per risk family
  → decision: alarm / review / no alert
  → evidence snippets + twin call
  → alert to Outcept with a deep link to the passage
```

**1. Audio in, no manual step.** A folder watcher picks up every new recording and runs it through the pipeline end to end. The same path processes a whole folder in batch.

**2. Speech to text built for dialect.** Open-weight Whisper models (including Swiss German fine-tunes) run on our own GPU. We choose the model by how reliably it captures the words that matter (digits, company names, key phrases), not by overall word error rate. Speaker separation labels each line as advisor or customer.

**3. Keywords are hints, not verdicts.** A configurable keyword list (Standard German and Swiss German phrases) points the checks at the right passages. A keyword alone never raises an alarm.

**4. One check per risk family, reading the whole context.** Each family has its own check run by an open-weight language model:

| Family | What it looks for |
|---|---|
| Trading on non-public information | Trades or recommendations based on news that is not yet public |
| Splitting to avoid approval | Payments broken up so that no single part needs approval |
| Access code shared | A valid login code, one-time password or PIN read out to anyone |
| Information given to a third party | Account details shared without the holder's consent |
| Relevant information left out | Risks or customer statements deliberately kept out of the record |

Each check must state the most plausible harmless reading first, cite the exact passages it relies on, and say when the call does not settle the question. Every check runs several times, and agreement between runs counts towards the confidence.

**5. Code decides, not the model.** The language model returns structured findings. A small, transparent rule turns them into the verdict:

- **Alarm** when the evidence is strong.
- **Review** when the score is in the middle band, when the facts needed to decide are missing (the open question is written out), when the transcript is unclear at the key passage, or when a check fails.
- **No alert** otherwise.

Errors always fail towards review, never towards silence. A real case sent to review still counts as caught.

**6. Every alert is traceable.** Each flagged call comes with:
- the suspicious passages as audio snippets (with 10 seconds of context before and after), timestamps and speaker
- the reason in plain language, and the criterion it supports
- a **twin call** where one exists: a similar call that was *not* flagged, and the one-sentence difference between them

**7. Compliance stays in control.** The officer can set how strict Klartext is with two thresholds and see the effect on hits, precision and recall immediately. They can switch families on or off and edit rules and keywords in plain language, without code. Every change is versioned and written to an audit log.

**8. Measured honestly.** Detection quality is measured on held-out dialogues that were never used for tuning. We report precision, recall, the full confusion matrix, results for clean versus noisy audio, and how often the cited passage matches the expected evidence. We also compare against a keyword-only baseline.

## Built for a bank's environment

- **Open-weight models only.** Speech and language models can run on GPUs inside the bank. The language model sits behind an OpenAI-compatible address, so moving from a hosted endpoint to a self-hosted vLLM server is a single configuration change.
- **Untrusted transcripts.** Call content is treated as data. Prompts ignore instructions spoken in a call, outputs are validated against a strict schema, and every cited passage must exist in the transcript.
- **Audit trail.** Every decision stores the model, the configuration versions and the raw check outputs, so it can be reproduced and explained to an auditor.
- **No real data.** The prototype uses only the fictional case data provided by Inventx and Outcept.

## Stack

Python 3.11 · FastAPI · SQLite (SQLModel) · faster-whisper / WhisperX · pyannote · open-weight LLMs via an OpenAI-compatible API · React + TypeScript (Vite, Tailwind) · wavesurfer.js

## Status

Work in progress during the sprint. Setup and run instructions will follow.
