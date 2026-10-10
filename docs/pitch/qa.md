# Q&A sheet

Short answers for the jury, built from the pitch lines in `docs/DECISIONS.md` (decision numbers in brackets). Lead with the line in **bold**, add one sentence of detail only if asked again.

**Numbers:** *holdout* is the B29 run: 20 recordings on real speech recognition, run once with prompts and thresholds frozen (review 30, alarm 70, version 4). *Dev* is the 40 recordings we tuned on, also on speech recognition. Quote holdout first.

---

## Problem and approach

**Why not just a keyword filter?**
**"Same six digits, two verdicts. Keywords tell us where to look; context tells us what it means."** (D5) Many Stufe 1 hits are harmless and the Stufe 2 and 3 cases have no keyword at all. On the holdout a keyword filter alone caught 4 of the 10 real cases (recall 0.40, precision 0.67); on dev its recall was 0.36.

**What exactly does it detect?**
**"Five specialised checks instead of one vague 'is this fraud?' question. Each hit names its rule."** (D6) Trading on non-public information, splitting to avoid approval, access code shared, information given to a third party, relevant information left out. A number-type helper tells them what kind of number was read out; it never decides on its own.

**What happens when the call doesn't contain enough to decide?**
**"When Klartext can't know, it says exactly what's missing and hands it to a human."** (D3) Every review comes with the open question written out, e.g. *Was the code still valid when it was read out?*

**Isn't a review just a hedge?**
**"We optimise for zero missed cases first, then for fewer extra reviews."** (D4) Outcept confirmed that a real case sent to review counts as caught. Review is for missing facts, not for model nerves; extra reviews on harmless calls cost precision and we report them.

**Can it work on live calls?**
**"Today every call is checked within minutes after it ends. Live warnings are the next step, starting with access codes, where seconds matter."** (D1) Compliance review happens after the call anyway, so finished recordings match the brief and keep Swiss German ASR robust. For access codes a live warning could stop the advisor before the code is used; that needs streaming ASR and is the first extension we would build.

## Trust and explainability

**How do I know why it flagged a call?**
**"The officer sees the 20 seconds that matter, highlighted, with a reason, before anything else."** (D26) Every alarm shows the passages with timestamps and speaker, plays them with 10 s of context, and names the rule it supports.

**Why didn't it flag a call that looks similar?**
**"Klartext doesn't just say 'alarm', it shows why a near-identical call wasn't one."** (D27) The twin-call box shows the most similar call with a different verdict and the one-sentence difference (C09 live login code vs C10 expired sample from the manual).

**Does the AI make the decision?**
**"The AI reads the call; a transparent rule makes the decision. Every verdict is reproducible for an auditor."** (D9) The model returns structured findings with quotes; quotes that don't match the transcript are dropped. One tested rule, the same on server and screen (22 shared test cases), turns them into alarm, review or no alert. (D12, D13)

**How confident is it, and where does that come from?**
**"Confidence comes from agreement between independent runs, not from the model grading itself."** (D10) Each check runs several times; the score is the share of runs that say it happened, with "unclear" counted as half.

**What if the model hallucinates?**
Quotes must match a real transcript segment or the evidence is dropped; a "happened" without valid evidence becomes "unclear". (D9) **"Every error fails towards a human, never towards silence."** (D12)

**What if a caller tries to trick the model ("ignore your instructions")?**
Transcripts are treated as untrusted data in every prompt, outputs are checked against a strict schema, and the verdict is computed by code, not taken from model text. (D34)

## Quality

**How good is it?**
**"Our numbers come from calls we never tuned on."** (D22) Holdout, on real speech recognition: recall 1.00 (10 of 10 real cases caught, none missed), precision 0.91 (one extra review on a harmless call, no false alarm), exact verdict 18 of 20, Stufe 2 pairs 3 of 3, evidence on the expected passage for 9 of 9 measurable alarms, Stufe 3 sent to review 1 of 2 (the other went to alarm, so it was still caught). Dev: precision 0.92, recall 1.00, exact 37 of 40. The keyword filter alone: recall 0.40 on holdout, 0.36 on dev.

**How do you avoid overfitting to 30 dialogues?**
**"We encode the compliance rules, not the test calls."** (D8) Fixed dev/holdout split by dialogue group (pairs and both recordings stay together), prompts and thresholds tuned on dev only, holdout run once. Nothing depends on file names, so the hidden test set works as is. (D22, D24)

**Swiss German speech recognition is hard. How do you deal with it?**
We picked the ASR model by whether digits, names and key phrases survive, not by word error rate. (D19) Whisper large-v3 recognises 95% of the digits and key phrases on dev. Low-confidence lines are marked *Listen to confirm*, and an unclear key passage sends the call to review. Clean and noisy recordings of the same call agree on 8 of 10 holdout pairs.

**Which LLM, and why reasoning off?**
**"We measured it: the faster setting also caught more."** (D17) Qwen3.6 27B, open-weight. On dev, reasoning off: recall 1.00, precision 0.92, 6.6 s per request; reasoning on: recall 0.91, about 5× slower.

## Running it in a bank

**Does call data leave the bank?**
**"Every model we use can run on a GPU inside the bank."** (D14) **"Today OpenRouter for speed; in the bank, one URL change and nothing leaves the building."** (D15) Speech recognition and speaker separation already run on our own GPU, and **"even speaker separation runs offline."** (D20)

**Where would it run?**
**"In production this runs in a Swiss data centre such as Inventx ix.Cloud."** (D16) Behind the recording system: **"Nobody uploads anything. A call ends, the recording lands, Klartext checks it."** (D2)

**Who controls how strict it is?**
Compliance. Two thresholds on the Tuning page with the cost shown live; rules and keywords edited in plain language; every change is a versioned config with an audit entry. (D11, D35)

**What does an auditor or FINMA get?**
Per decision: model, prompt version, config versions (rules, keywords, thresholds) and every raw run. Every config change and every officer action (correct, false alarm, missed, escalate, close, note) is in the audit log. (D28, D35)

**What if something breaks?**
**"Every error fails towards a human, never towards silence."** (D33) A failed check, unreadable audio or an empty transcript goes to review with the reason. Trigger API or LLM outages never lose a call; it stays queued.

**How fast, and does it scale?**
Within minutes after the call. One batch of 60 recordings runs its checks in about 22 minutes at 8 parallel requests, with five runs per check (D18, reasoning off). It scales with GPUs; each call is independent.

**Did you build on an existing product?**
No. CallQuanta, the closest open-source analogue, is AGPL-3.0, which would force open-sourcing an Inventx MVP; we took ideas only (audio next to findings, webhook ingestion, local speech-to-text, feedback buttons). (D32)

**What's next after the sprint?**
Live warnings for access codes, feedback-driven threshold suggestions, the advisor pattern view, and the recording-system webhook instead of the inbox folder.
