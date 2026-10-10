
# Decisions: Klartext

Every important choice we made, why, and the line to use in the pitch or Q&A. Newest open items at the bottom. Update this file whenever a real decision is made (not for small implementation details).

Format: **Decision** · Why · *Pitch line*

---

## 1. Problem framing

**D1. Check finished recordings automatically, not live calls.**
The case: calls are already recorded but almost never reviewed. Target picture: checks integrated into the bank's recording system, running on every call without uploads. Compliance review happens after the fact anyway. Live streaming ASR in Swiss German would add risk without matching the brief.
*"Every call is checked within minutes of ending. Live warnings during the call are the next step, not the first."*

**D2. The inbox folder stands in for the bank's recording system.**
A watcher picks up every new WAV and runs the full pipeline with no human step. In production the folder becomes a webhook from the recording platform.
*"Nobody uploads anything. A call ends, the recording lands, Klartext checks it."*

**D3. Three outcomes: alarm, review, no alert.**
Review means "the call does not contain the facts needed to decide", not "the model is nervous". Every review states the missing fact as an open question.
*"When Klartext can't know, it says exactly what's missing and hands it to a human."*

**D4. Review counts as caught (confirmed with Outcept on site).**
So missing a real case is the worst error. Unclear calls go to review. Review on a clearly harmless call still costs precision.
*"We optimise for zero missed cases first, then for fewer extra reviews."*

## 2. Detection approach

**D5. Keywords are hints, never verdicts.**
Stufe 2 and 3 calls contain zero keyword hits, and in Stufe 1 many hits are harmless. A keyword filter alone would miss the context cases and flood the queue with false alarms. Keywords still matter: they guide the checks, they are visible to the officer, and they are editable without code.
*"Same six digits, two verdicts. Keywords tell us where to look; context tells us what it means."*

**D6. One LLM check per misconduct family.**
Families from the case keyword list: trading on non-public information, splitting to avoid approval, access code shared, information given to a third party, relevant information left out. The number-type helper classifies digit sequences (login code, card number, invoice reference) and feeds the other checks but never produces a verdict.
*"Five specialised checks instead of one vague 'is this fraud?' question. Each hit names its rule."*

**D7. Every check states the most plausible harmless reading before deciding.**
Forces the model to consider the innocent explanation, which reduces false alarms on context pairs.

**D8. Prompt rules are general, taken from the case policy, never written around a specific dialogue.**
The hidden test set has different stories with the same rules. Rules added during tuning:
- Asking to leave out or hide relevant information is the event itself, whether or not the advisor agrees.
- If it can't be determined whether a code or value was still valid, the event is "unclear from the call".
- If someone claims an authorisation the call doesn't verify, a human must decide, even if nothing was disclosed.
- When torn between "did not happen" and "unclear", choose unclear.
*"We encode the compliance rules, not the test calls."*

**D9. The code decides, not the LLM.**
The LLM returns structured fields (event, evidence, open question). A fixed, tested rule turns them into a verdict. Evidence quotes must match real transcript segments or they are dropped (hallucination guard).
*"The AI reads the call; a transparent rule makes the decision. Every verdict is reproducible for an auditor."*

## 3. Decision rule and scoring

**D10. Family score = share of runs that say "happened", with "unclear" counted as half.**
k runs per check; present = 1, undetermined = 0.5, absent = 0. An all-"unclear" check scores 50 and lands in review by default. We do not use the model's self-reported confidence (unreliable according to recent research).
*"Confidence comes from agreement between independent runs, not from the model grading itself."*

**D11. Default thresholds: review from 30, alarm from 70.** Officer-adjustable on the Tuning page with live effect. **B28 (dev, ASR, k = 5): review stays at 30, saved as thresholds version 4.** Recall 1.00 holds for any review threshold from 10 to 50 (precision 0.92 throughout; the real cases' lowest scores are 0 via needs_human and 50 for unclear, harmless calls score 0 except the accepted C14 false alarm at 100). 30 keeps a two-vote margin below the cases at 50 (one "unclear" vote = 10 points at k = 5) instead of sitting on the edge at 50.
*"We set the threshold where real cases can lose two votes and still reach a human."*

**D12. Rule order (final):**
1. No family enabled → review ("No checks enabled.")
2. Top score ≥ alarm threshold → alarm, even if another family failed (the failure is noted in the reason)
3. Any failed family → review
4. Top score ≥ review threshold → review
5. Majority of runs ask for a human → review
6. Transcription unclear at the key passage and score ≥ half the review threshold → review
7. Otherwise no alert

Ties follow the fixed family order: trade, splitting, access, disclosure, documentation.
*"Every error fails towards a human, never towards silence."*

**D13. One shared test file for the decision rule.**
`shared/decision_cases.json` (22 cases, every branch and boundary). Backend `decide.py` and frontend `decide.ts` both must pass it, so the Tuning sliders show exactly what the server would decide.

## 4. Models and infrastructure

**D14. Only open-weight, self-hostable models in the core pipeline.**
Case rule: if it can be self-hosted, it's allowed. No Claude, GPT, Gemini or cloud speech APIs, even via OpenRouter.
*"Every model we use can run on a GPU inside the bank."*

**D15. Split: speech on our own GPU, LLM via OpenRouter, app on the laptop.**
OpenRouter key provided by the case partners. The LLM client uses an OpenAI-compatible URL, so production swaps OpenRouter for a vLLM server with one config line.
*"Today OpenRouter for speed; in the bank, one URL change and nothing leaves the building."*

**D16. GPU: RTX 3080 Ti (12 GB) in Exoscale Vienna (AT-VIE-2).**
The A30 in Geneva needed extra enablement; Vienna was set up for the sprint. 12 GB is enough because the GPU only runs ASR and diarization. Run in batch, cache results, stop the instance (75 CHF credit).
*"In production this runs in a Swiss data centre such as Inventx ix.Cloud."*

**D17. LLM: Qwen3.6 27B, reasoning off.**
Open-weight, structured JSON output, long context, cheap, and small enough for one bank GPU. Reasoning comparison on dev (20 dialogues):

| | Reasoning off | Reasoning on |
|---|---|---|
| Recall | **1.00** | 0.91 |
| Precision | 0.92 | 0.91 |
| Mean latency per request | **6.6 s** | 29.3 s |
| Output tokens | **132k** | 774k |

Reasoning on missed a real case and was ~5× slower. No hybrid needed.
*"We measured it: the faster setting also caught more."*

**D18. Runs per check: k = 5.**
Stability check on dev (reasoning off, two independent runs each): with k = 3 the same call's family scores differed by up to 33 between identical runs and 2 of 20 verdicts flipped; with k = 5 they differ by at most 10 and 1 of 20 flips. k = 3 sometimes caught borderline cases (C18, C20) by luck; k = 5 shows the model's real lean, so the review threshold is set on its scores in B28 (D11). Cost: 5/3 of the LLM calls, ~22 min per full 60-recording run instead of ~13.
*"We run every check five times and measured that the answer barely moves between runs."*

**D19. ASR model chosen by critical token recall, not WER.**
Chosen: **Whisper large-v3** (B15, dev recordings): critical token recall 95% (digits 57/60, annotated keywords 46/48), tied with the Flix Swiss German fine-tune (95%), ahead of gcoli turbo (91%); WER 58% vs 59% broke the tie. Turbo is ~2× faster (538 s vs 996 s for 59 calls) but loses 5 critical tokens, mostly digits on clean audio. *"We picked the speech model by whether the digits and key phrases survive, not by word error rate."*
Candidates: Whisper large-v3, Flix-AI Swiss German fine-tune (Apache-2.0), gcoli turbo (MIT). What matters is whether digits, names and key phrases survive, not exact dialect wording. Swiss German ASR outputs Standard German; transcripts and quotes are shown as transcribed.

**D20. Speaker separation: pyannote community-1 on our GPU, never precision-2.**
Precision-2 runs on pyannoteAI's cloud. Community-1 works fully offline.
*"Even speaker separation runs offline."*

## 5. Data and evaluation

**D21. Scripts and expected assessments are for evaluation only; the pipeline input is audio.**

**D22. Fixed dev/holdout split by dialogue group.**
Context pairs, both recordings (clean and noisy) and related calls never cross splits. Demo calls (C09, C10, C17) stay in dev. Prompts and thresholds are tuned on dev only; holdout is run once, at the end, for the pitch numbers.
*"Our numbers come from calls we never tuned on."*

**D23. Metrics as the case partners score them:** flagged = alarm or review; precision, recall, exact verdict, Stufe 2 pair accuracy, Stufe 3 review rate, clean vs noisy agreement, evidence overlap, plus a keyword-only baseline for comparison.

**D24. Recording IDs everywhere (e.g. `Stufe2_C09-K3`).** The UI shows the dialogue ID plus a Clean/Noisy chip. Nothing may depend on file names, because hidden test files may be named differently.

## 6. Product and design

**D25. Name: Klartext.** "Klartext reden" means to speak plainly. Fits next to Outcept's product Klarsicht.

**D26. Design: calm monochrome workspace, Outcept yellow as the only accent, and yellow always means "listen here".**
Echoes the case deck, where the suspicious part of the waveform is yellow. Review is blue (not amber) so it never clashes with the yellow highlight. Instrument Sans for the interface, Newsreader italic only for words spoken in a call.
*"The officer sees the 20 seconds that matter, highlighted, with a reason, before anything else."*

**D27. Twin call explanation.** Each alarm shows the most similar call without an alarm and the one-sentence difference (e.g. C09 live login code vs C10 expired sample from the manual).
*"Klartext doesn't just say 'alarm', it shows why a near-identical call wasn't one."*

**D28. Officer actions: correct, false alarm, missed, escalate to alarm, close as no alert, plain note.** All logged in the audit trail.

**D29. Settings page is read-only** (model, endpoints, config versions) for the MVP.

**D30. Download report = browser print of the call view; evaluation report as JSON.** No PDF generator.

**D40. `muted` text colour is `#666A72`, not `#6E727A` (contrast fix).**
The F9 accessibility pass (axe-core, WCAG 2 A/AA) found `#6E727A` reaches only 4.42:1 on the `canvas` background, below the 4.5:1 in `04_FRONTEND_GUIDELINES.md` section 9 (sidebar group labels, stat tile footers, keyboard hints, table group rows). `#666A72` is the smallest darker step that passes on every surface muted text sits on: paper 5.43, canvas 4.97, nav hover 4.58, review soft 4.63, alarm soft 4.62, signal soft 4.80 (old value: 4.83 / 4.42 / 4.07 / 4.12 / 4.11 / 4.27). Barely visible; the guideline allows darker ("do not go lighter"). Applied in `04_FRONTEND_GUIDELINES.md` and `frontend/src/index.css`; axe now reports 0 violations on all 12 routes and the filter modal. Frontend commit `9c368a0`, approved by the team on Sat 10 Oct.
*"Every screen passes WCAG AA contrast, checked automatically on every page."*

**D41. Advisor names from speech are snapped to known names; in production the advisor ID comes from telephony.**
Role labelling reads the advisor's name from the greeting. ASR spells the same name differently between recordings, so a new name is snapped to an already known one at ≥ 85 % similarity (31 → 25 distinct names on the 60 calls; clean/noisy pairs with the same name 15 → 20 of 30). This only serves the Advisors view in the prototype.
*"In the bank, the advisor ID comes from the telephony system's call metadata, not from speech recognition."*

**D42. No live ASR in the demo: the dropped call uses a cached transcript.**
The live drop is `demo_call.wav`, a byte-different copy of Stufe2_C09-K3 with identical audio (re-encoded WAV header, so the duplicate check by content does not skip it). Its transcript is a copy of Stufe2_C09-K3's large-v3 transcript, which is exactly what ASR returns for that audio. The watcher, checks, decision, evidence, twin and trigger then run as in production. The GPU box stays off during the demo.
*"Speech recognition runs as a batch on our GPU; the demo shows what happens from the moment a transcript exists."*

**D43. The Advisors view counts only what the advisor raised; customer requests are shown apart.**
Most alarms are raised by the customer: they ask for the trade, the split or the omission, and the advisor often refuses correctly. Counting those against the advisor would be unfair. Each alarm or review gets `raised_by` from the speaker role of its trigger evidence in the decided family. Any advisor trigger → advisor, only customer triggers → customer, otherwise → unclear. No model call, no prompt or threshold change, verdicts unchanged (frozen for B29). The Advisors view highlights only advisor-raised alarms or 2+ advisor-raised reviews. Customer-raised ones are a muted "Customer requests" column, and `unclear` counts on the advisor side (fail safe: nothing hidden). The call view shows "Raised by: …" next to the verdict. On the 60 calls: 27 of 35 flagged calls are customer-raised, 8 advisor-raised (D07, C12, C14, C18), 0 unclear; highlighted advisors drop from 14 to 4. Limit: speaker roles come from role labelling, so a swapped speaker flips `raised_by`. Example: in C09 the advisor tells the customer twice not to read out numbers; she reads the live code anyway. The alarm stands (the code is compromised) and is marked customer-raised.
*"Klartext doesn't blame the advisor for what the customer asked. It shows who raised the risk, so the Advisors view only highlights advisors whose own behaviour was flagged."*

**D44. Suggest from feedback never costs recall and never trades one error for another.**
Before: in the test data, one false alarm on C09 (score 91) made **Suggest from feedback** propose review 95 / alarm 95. That silences C09 but misses real cases: on the latest real dev run, review 95 drops recall from 1.00 to 0.82. Now a pair is only suggested if (1) recall on the latest dev evaluation run is at least as high as at the active thresholds and (2) no feedback error count gets worse. Recall comes from that run's PR curve: with review ≤ alarm, whether a call is flagged depends on the review threshold only, so nothing is re-run. Rule 2 rules out the only recall-safe move for C09 (alarm 70 → 95), which would turn its false alarm into an extra review and push every dev alarm scoring 70–94 down to review. If a better pair exists but only by losing recall, the Tuning page says *No safe suggestion: every change would miss real cases.* No dev run means no suggestion (fail safe). Holdout runs are never read (CLAUDE.md rule 4). On the real DB, C09-K3 scores 100 (5 of 5 runs), so no threshold could clear it; the page says *No threshold change would fit the feedback better.* No prompt, threshold or decision rule changed.
*"Feedback can tune Klartext, but never into missing a real case."*

**D45. The UI says "alert", the data says `alarm`.**
Inventx and Outcept say "alert", so every visible label now does too: the verdict chip (**Alert** / **Review** / **No alert**), **Escalate as alert**, **False alert**, the **Alerts** tile and column, **Alert from** on the Tuning slider, toasts, the suggestion sentences and the Outcept trigger title (*Alert: …*). The verdict value stays `alarm` in the API, the database, `decide.py` / `decide.ts`, `decision_cases.json`, the feedback labels (`false_alarm`, `escalated_to_alarm`) and the colour token `alarm`. Renaming those would change the data contract and both copies of the decision rule right before the freeze, with no visible gain. Older design docs (PRD, App flow, this file) still say "alarm" for the same verdict. Triggers already posted to Outcept keep their old *Alarm: …* title until they are posted again.

**D46. The LLM decides who the advisor is on every call; greeting words are only the fallback.**
Before, a greeting rule decided first: the speaker with more bank words (*Bank, Team, Beratung, mein Name ist …*) in their first three lines was the advisor, with confidence 0.9, and the LLM was asked only on a tie (54 of 60 calls). Tested on invented openings for the hidden set (two real people, no case data): when nobody greets or the customer speaks first, the LLM was right every time, but a customer who says *"mein Name ist Huber, ich bin Kunde bei Ihrer Bank"* outscored an advisor who answers *"Ja, hallo?"*, so the rule labelled the customer as advisor and the LLM was never asked (2 of 8 wrong). A swapped label flips advisor-side checks (disclosure) and *Raised by*. Now one short LLM call (temperature 0, cached) decides on every call; the greeting rule, then the first speaker, are used only if that call fails. Advisor names: never a role word (*Kunde, Kundin, Inhaber, Inhaberin, Berater* …; *"ich bin Kunde"* had produced the advisor name "Kunde"), and only a name the advisor says in their own lines. The fallback name pattern accepts *mein Name ist* / *ich heisse* in any case (*"Mein Name ist …"*); *hier ist / da ist / ich bin* stay lower case only, because at a sentence start they precede too much that is no name (ASR wrote *"Da ist Twitter -Kund vom Technischen Service"* on C09/C10). Re-run from the roles stage on all 60 calls, cached: advisor/customer assignment, verdict, family, score, *Raised by*, evidence, twins and triggers unchanged on 60/60; holdout metrics identical to the B29 run (computed in memory, no new eval run written). Only changes: the 6 calls the greeting rule decided are now decided by the LLM (same speaker), and D04 (both recordings) gets its advisor name. All 8 invented openings now right. No prompt, threshold or decision rule changed. Not done before the freeze: sending a call to review when the role assignment is uncertain (planned next step).
*"We decide roles by what people say, not by who speaks first, and we tested the tricky openings."*

## 7. Integrations

**D31. Outcept trigger API: run their Docker image, don't fork it.** Every alarm and review is posted with a deep link to the passage, 10 s before the trigger.

**D32. CallQuanta (closest open-source analogue) used for ideas only, not code.** It's AGPL-3.0, which would force open-sourcing anything built on it, a problem for an Inventx MVP. Ideas taken: audio next to findings, webhook ingestion, local-first STT, feedback buttons.

## 8. Security and operations

**D33. Fail safe:** every error leads to review, never to a silent no-alert.
**D34. Transcripts are untrusted input;** prompt-injection guard in every prompt, verdict computed by code.
**D35. Full audit trail:** model, prompt version, config versions and raw runs stored per decision; every config change and feedback logged.
**D36. Secrets only in `.env`;** never in git or in AI chats. Audio served only via the API; backend and trigger API bound to localhost.

## 9. Team and workflow

**D37. Two tracks, separate folders:** backend/pipeline (Dinesh) and frontend (teammate), joined by `docs/API_CONTRACT.md`. The frontend built against fixtures from hour one.
**D38. Contract and decision rule have one owner each:** the API contract lives in `docs/API_CONTRACT.md`; the decision rule is owned by the backend and mirrored in `decide.ts`.
**D39. Progress tracked in `docs/PROGRESS.md`,** updated with every step's commit.

---

## Open decisions

| Item | Options | Decide when |
|---|---|---|
| Review threshold | Chosen on the PR curve (ASR, dev), recall 1.00 at best precision; stays 30 until then (D11) | B28 |
| Failed-check note wording | Family key ("trade") vs display name | If time allows |
