# 01 · Product Requirements Document: Klartext

## 1. Product in one paragraph

Klartext is a self-hostable compliance system that automatically checks every recorded phone call between bank customers and advisors in Swiss German. It transcribes the audio, runs several AI fraud checks, and decides per call: **alarm**, **review** or **no alert**. Every alarm comes with the suspicious audio snippets, a timestamp and a plain-language reason. When the call does not contain enough facts to decide, Klartext says what is missing and routes the call to a human.

## 2. Problem

- Every customer–advisor call is recorded, but only samples are ever reviewed.
- Thousands of call minutes arrive per day. Insider trading and other misconduct mostly go undetected, on both ends of the line.
- The calls are in Swiss German, where off-the-shelf speech tools fail.
- Keyword filters do not help: the same sentence ("I'll read you the six digits…") is harmless in one call and a leaked live login code in another. The difference sits in context minutes earlier.

## 3. Users

**Primary: compliance officer.** Reviews flagged calls, decides on escalation, documents decisions for audits and the regulator. Not a programmer. Wants to hear the suspicious passage, not a 20-minute call. Needs to trust why the system flagged something, and to change how strict it is without code.

**Secondary: head of compliance.** Sets policy (keyword families, strictness), wants coverage numbers and patterns across advisors.

**Tertiary: Inventx / bank IT.** Runs it inside a secured environment. Needs self-hosted models, an audit trail and a clear operating concept.

## 4. Goals

1. Check 100% of calls with no manual step per call.
2. Catch the cases that matter, with few false alarms.
3. Make every decision traceable: passage, timestamp, speaker, criterion, reason.
4. Escalate instead of guessing when facts are missing.
5. Let the officer tune strictness and configure what is checked, without code.
6. Run fully on self-hostable models.

## 5. Scope

### In scope (MVP for Sunday)

| # | Requirement | Mandatory? |
|---|---|---|
| R1 | Transcribe Swiss German audio with word-level timestamps | Yes (case #1) |
| R2 | Several AI fraud checks, one per family: trade, splitting, access, disclosure, documentation, plus the numbers classifier | Yes (case #2) |
| R3 | Suspicious passages as audio snippets with timestamp and reason | Yes (case #3) |
| R4 | Adjustable threshold, live effect on hits | Yes (case #4) |
| R5 | Metric for false alarms and missed cases on the test set | Yes (case #5) |
| R6 | Runs automatically: a call dropped into the inbox folder is processed end to end | Yes |
| R7 | Three-way decision alarm / review / no alert, with an "open question" when review | Core |
| R8 | Keyword list editable in the UI (families, phrases, on/off) | Core (demo item) |
| R9 | Speaker separation: advisor vs customer | Stretch, planned |
| R10 | Outcept trigger API: post every alarm/review with a deep link to the passage (±10 s) | Stretch, planned |
| R11 | Feedback buttons (correct / false alarm / missed) and suggested thresholds | Stretch, planned |
| R12 | Advisor view: calls per advisor, repeated reviews | Stretch, if time |
| R13 | Operating concept (one page + architecture diagram) | Stretch, pitch material |

### Out of scope

- Real customer or bank data. All data is the fictional case set.
- Live call streaming. Klartext processes finished recordings.
- User accounts, roles, SSO. The demo runs as one officer.
- Telephony integration. Represented by the inbox folder watcher.
- Training or fine-tuning models.
- Cloud-only AI services (Deepgram, AssemblyAI, ElevenLabs, OpenAI/Anthropic/Google models). The LLM runs on open-weight models via OpenRouter (provided by the case partners) and can be moved to a self-hosted vLLM server with one config change.

## 6. Data we have

- 60 WAV calls (16 kHz mono): 30 scripts × clean and noisy. Levels: Stufe1 (10 keyword calls), Stufe2 (16 calls = 8 context pairs), Stufe3 (4 open cases).
- Per script: dialogue turns with speaker labels (Beratung / Kundin), no timestamps.
- Expected assessment per script: verdict (Bearbeitung: alarm / no_alert / review), family (Testziel), event (present / absent / undetermined / not_applicable), reason, open question, evidence turns, keyword annotations (relevant / benign).
- Keyword list JSON: 6 families, 11 keywords, de + gsw phrases, `policy_examples` per family.
- Hidden test set (30%) held back by Inventx/Outcept, run on Sunday.

Rules for data use:
- Scripts and expected assessments are for **evaluation only**. The pipeline input is audio.
- The `policy_examples` and keyword list are product configuration and may be used in prompts.

## 7. How decisions are scored (confirmed with Outcept)

- A fraud call that Klartext sends to **review** counts as **caught**.
- Therefore: missing a real case is the worst outcome; unclear calls go to review.
- Review on a clearly harmless call still costs precision. Review is for missing facts, not for model nerves.

## 8. Success metrics

| Metric | Target |
|---|---|
| Recall (alarm + review counted as hit) on held-out dialogues | ≥ 0.95 |
| Precision on held-out dialogues | ≥ 0.80 |
| Stufe2 pairs decided correctly (both sides) | 8 / 8 on clean audio |
| Stufe3 calls sent to review | 4 / 4 |
| Evidence passage overlaps an expected evidence turn | ≥ 90% of alarms |
| Clean vs noisy verdict agreement | ≥ 90% |
| Time from file drop to verdict (cached ASR model) | < 2 min per call |

## 9. Judging criteria and how we answer them

| Criterion | Weight | Our answer |
|---|---|---|
| Creativity & innovation | 20% | "Twin-call" explanation: every alarm shows why a similar harmless call was not flagged. Review driven by missing facts, with the open question written out. |
| Feasibility | 10% | All models open-weight. ASR on our own GPU. LLM behind an OpenAI-compatible URL: OpenRouter today, vLLM in the bank tomorrow. Inbox watcher stands in for the recording system. |
| Design & usability | 25% | Inbox → call view with the yellow highlighted passage and one-click snippet. Threshold sliders with live counts. Keyword editor in plain language. |
| Impact & relevance | 20% | 100% coverage, minutes of review instead of hours, audit trail per decision. |
| Detection quality & traceability | 25% | Context-aware checks per family, measured on held-out dialogues, every hit with passage + criterion, review with stated open question. |

## 10. Demo script (5 minutes)

1. **Drop a call** into the inbox. It appears as processing, then as alarm (Stufe2 C09, live login code read out). Open it, play the yellow snippet, read the reason.
2. **Borderline case**: open the twin call C10. Same six digits, no alarm, reason: expired sample from the manual. Show the keyword-only baseline would have flagged both.
3. **Review case**: C17. The open question is shown: was the value still valid? Human decides.
4. **Tuning**: move the alarm slider. Counts and the confusion matrix update live. Disable one keyword family, show hits change.
5. **Quality**: precision / recall on held-out dialogues, clean vs noisy. Outcept trigger list with deep links.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Swiss German ASR drops digits or key phrases | Benchmark 2–3 models on the 60 calls by "critical token recall", not WER. Digit normaliser. |
| LLM over-flags | Per-family prompts with an explicit benign hypothesis. Code computes final score, not the LLM. |
| Overfitting to 30 dialogues | Group splits by dialogue pair. Tune on dev, report on holdout. |
| Running out of GPU credits | ASR runs once in batch, results cached, instance stopped. |
| Demo breaks live | Pre-processed results cached. Live drop uses one short call. Screen recording as backup. |

## 12. Submission checklist (Sunday 08:30)

- [ ] Pipeline runs from audio, no manual steps per call
- [ ] All 60 calls processed, results cached
- [ ] Metrics page shows precision, recall, confusion matrix, clean vs noisy
- [ ] Threshold change visibly changes hit counts
- [ ] Keyword list change visibly changes hits
- [ ] Borderline harmless call with keyword ready to show
- [ ] Hidden test set procedure tested (drop a folder of WAVs, get a results file)
- [ ] Outcept trigger API receives alarms with deep links
- [ ] Repo README with run instructions
- [ ] Backup screen recording of the demo
