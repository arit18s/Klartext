# Q&A sheet

Short answers for the jury, built from the pitch lines in `docs/DECISIONS.md` (decision numbers in brackets). Lead with the line in **bold**, add one sentence of detail only if asked again.

**Numbers:** *holdout* is the B29 run: 20 recordings on real speech recognition, run once with prompts and thresholds frozen (review 30, alert 70, version 4). *Dev* is the 40 recordings we tuned on, also on speech recognition. Quote holdout first.

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
**"The officer sees the 20 seconds that matter, highlighted, with a reason, before anything else."** (D26) Every alert shows the passages with timestamps and speaker, plays them with 10 s of context, and names the rule it supports.

**Why didn't it flag a call that looks similar?**
**"Klartext doesn't just say 'alert', it shows why a near-identical call wasn't one."** (D27) The twin-call box shows the most similar call with a different verdict and the one-sentence difference (C09 live login code vs C10 expired sample from the manual).

**Does the AI make the decision?**
**"The AI reads the call; a transparent rule makes the decision. Every verdict is reproducible for an auditor."** (D9) The model returns structured findings with quotes; quotes that don't match the transcript are dropped. One tested rule, the same on server and screen (22 shared test cases), turns them into alert, review or no alert. (D12, D13)

**How confident is it, and where does that come from?**
**"Confidence comes from agreement between independent runs, not from the model grading itself."** (D10) Each check runs several times; the score is the share of runs that say it happened, with "unclear" counted as half.

**How do the score and the thresholds work? Why 70 and 30?**
**"Each check runs five times; the score is how many runs agree. Alert from 70, review from 30, chosen on calls we tuned on, and compliance can move them."** (D10, D11) Each run says *happened* (1), *unclear* (½) or *did not happen* (0); score = points ÷ 5 × 100, so it moves in steps of 10. Examples: 4 of 5 say happened = 80 (alert); 3 happened, 1 unclear, 1 no = 70 (alert); 5 times unclear = 50 (review); 1 happened, 1 unclear, 3 no = 30 (review). The call's highest category score decides. A majority asking for a human, a failed check or unclear speech recognition at the key passage always go to review. 30 was chosen on the dev calls: every real case reached a human with the fewest extra reviews, and recall stays 1.00 anywhere from 10 to 50. 70 means at least three of five runs clearly agree.

**What if the model hallucinates?**
Quotes must match a real transcript segment or the evidence is dropped; a "happened" without valid evidence becomes "unclear". (D9) **"Every error fails towards a human, never towards silence."** (D12)

**Doesn't the Advisors view blame advisors for what customers ask?**
**"Klartext doesn't blame the advisor for what the customer asked. It shows who raised the risk, so the Advisors view only highlights advisors whose own behaviour was flagged."** (D43) Who raised it comes from the speaker of the trigger passage; customer-raised flags still appear, in a muted "Customer requests" column, and the call view says "Raised by: Customer".

**How do you know who is the advisor and who is the customer?**
**"We decide roles by what people say, not by who speaks first, and we tested the tricky openings. The officer always sees who said what and hears the audio. In a bank it gets easier: recording systems usually keep the bank and the caller on separate channels, so the roles are known for certain."** (D46) The case recordings were mono, so in the sprint Klartext separates the voices itself and an open-weight LLM decides which speaker acts for the bank (identifies the caller, sees the account, explains processes). If pushed: **"Next step: when the role assignment is uncertain, Klartext sends the call to review instead of guessing."** (planned, not built before the freeze)

**What if a caller tries to trick the model ("ignore your instructions")?**
Transcripts are treated as untrusted data in every prompt, outputs are checked against a strict schema, and the verdict is computed by code, not taken from model text. (D34)

## Quality

**How good is it?**
**"Our numbers come from calls we never tuned on."** (D22) Holdout, on real speech recognition: recall 1.00 (10 of 10 real cases caught, none missed), precision 0.91 (one extra review on a harmless call, no false alert), exact verdict 18 of 20, Stufe 2 pairs 3 of 3, evidence on the expected passage for 9 of 9 measurable alerts, Stufe 3 sent to review 1 of 2 (the other went to alert, so it was still caught). Dev: precision 0.92, recall 1.00, exact 37 of 40. The keyword filter alone: recall 0.40 on holdout, 0.36 on dev.

**How do you avoid overfitting to 30 dialogues?**
**"We encode the compliance rules, not the test calls."** (D8) Fixed dev/holdout split by dialogue group (pairs and both recordings stay together), prompts and thresholds tuned on dev only, holdout run once. Nothing depends on file names, so the hidden test set works as is. (D22, D24)

**Swiss German speech recognition is hard. How do you deal with it?**
We picked the ASR model by whether digits and key phrases survive, not by word error rate. (D19) Whisper large-v3 recognises 95% of the digits and key phrases on dev. Low-confidence lines are marked *Listen to confirm*, and an unclear key passage sends the call to review. Clean and noisy recordings of the same call agree on 8 of 10 holdout pairs.

**Did anyone check the transcripts by ear? What if they are wrong?**
**"A Swiss German listener checked five calls: the transcript has errors, especially names, technical words and sometimes a missing negation. The verdicts were still right in all five, because Klartext judges the meaning of the whole call and the officer always hears the passage."** (D47) Checked: C09 (both recordings, alert), C10 (no alert), C17 (review), D02 (alert). Typical errors: *"Weizen"* for *"Bitte"*, *"Gospach"* for *"Postfach"*, misheard names, a few lines given to the wrong speaker, and missing negations (*"ich habe nichts Neues gestartet"* where the customer said *"heute schon etwas Neues gestartet"*). Klartext never edits transcripts by hand: the input is the audio, as it will be for the bank's calls.

**Which LLM, and why reasoning off?**
**"We measured it: the faster setting also caught more."** (D17) Qwen3.6 27B, open-weight. On dev, reasoning off: recall 1.00, precision 0.92, 6.6 s per request; reasoning on: recall 0.91, about 5× slower.

**Why ask five times? Why not a fine-tuned or a bigger model?**
**"We ask an open-weight model the same question five times and count the agreement; that's a known technique, and we measured that five runs make the verdict stable. We didn't fine-tune because 30 example calls are far too few and compliance must be able to change rules without retraining. Most remaining errors come from Swiss German speech recognition, so that's where fine-tuning pays off first."** (D10, D17, D18) Asking several times and using the agreement is known as self-consistency (Wang et al., 2022); disagreement between runs as a sign of uncertainty is the idea behind SelfCheckGPT (Manakul et al., 2023). Measured on dev: with three runs the same call's scores moved by up to 33 points between identical runs and 2 of 20 verdicts flipped; with five, at most 10 points and 1 of 20. Fine-tuning would need hundreds of labelled calls and retraining for every rule change, and a classifier gives a label, not a reason with quotes; the officers' feedback buttons collect exactly the labels a later fine-tune would need. A bigger model: closed models are ruled out for bank call data, bigger open ones need several GPUs, and "thinking harder" (reasoning on) did worse here (recall 0.91 vs 1.00, five times slower). A bigger open model is a one-line config change; we would test it on dev only. Honest limit: all five runs read the same transcript, so a word speech recognition got wrong is wrong in all five.

## Running it in a bank

**Does call data leave the bank?**
**"Every model we use can run on a GPU inside the bank."** (D14) **"Today OpenRouter for speed; in the bank, one URL change and nothing leaves the building."** (D15) Speech recognition and speaker separation already run on our own GPU, and **"even speaker separation runs offline."** (D20)

**Where would it run?**
**"In production this runs in a Swiss data centre such as Inventx ix.Cloud."** (D16) Behind the recording system: **"Nobody uploads anything. A call ends, the recording lands, Klartext checks it."** (D2)

**How does it connect to the bank's systems?**
**"Recordings come in through a folder, an upload API or a webhook from the recording system; alerts go out to Outcept with a link to the passage, and everything is also available as a REST API."** In today: a watched inbox folder (any recording system that can drop files into a share or SFTP folder works unchanged), a REST upload (`POST /api/pipeline/inbox`, WAV, MP3, M4A, MP4, FLAC or OGG) and a batch endpoint for a whole folder; in production a webhook from the bank's call-recording system with metadata (advisor ID, ideally separate channels for bank and caller). Out: every alert and review is posted to Outcept's trigger API as JSON with a deep link to the passage (live today), a REST read API (`GET /api/calls`, `GET /api/calls/{id}`) for any case-management tool, a live event stream, JSON/CSV export and a print report per call. Not built yet: login/SSO and roles, and a connector for a specific recording product.

**Who controls how strict it is?**
Compliance. Two thresholds on the Tuning page with the cost shown live; rules and keywords edited in plain language; every change is a versioned config with an audit entry. (D11, D35)

**Can the bank add its own rule, say "no velo purchases"? Will Klartext flag it?**
**"Today compliance edits the rules and keywords of the five categories without a developer, and it takes effect on the next check. A new category like 'no velo purchases' is the same engine with a new rule text. In the prototype the five are fixed; adding a category in the UI is the next step."** The *Rule* and *What counts as harmless* text of each category on the Rules page goes directly into that category's check. A keyword such as *Velo* can be added too, but a keyword alone never flags a call: it only points the checks at the passage (D5). So "no velo purchases" is not flagged today unless it falls under one of the five categories. Every category is the same thing to the engine (rule text, harmless text, keywords, five independent runs), so a new one is configuration plus one entry in the fixed list, not a new system.

**What does an auditor or FINMA get?**
Per decision: model, prompt version, config versions (rules, keywords, thresholds) and every raw run. Every config change and every officer action (correct, false alert, missed, escalate, close, note) is in the audit log. (D28, D35)

**What if something breaks?**
**"Every error fails towards a human, never towards silence."** (D33) A failed check, unreadable audio or an empty transcript goes to review with the reason. Trigger API or LLM outages never lose a call; it stays queued.

**How fast, and does it scale?**
Within minutes after the call. One batch of 60 recordings runs its checks in about 22 minutes at 8 parallel requests, with five runs per check (D18, reasoning off). It scales with GPUs; each call is independent.

**Did you build on an existing product?**
No. CallQuanta, the closest open-source analogue, is AGPL-3.0, which would force open-sourcing an Inventx MVP; we took ideas only (audio next to findings, webhook ingestion, local speech-to-text, feedback buttons). (D32)

**How would Inventx sell this?**
**"Inventx runs one platform; each bank gets its own rule package. The checks, keywords and thresholds are configuration, not code."** Categories, keywords and thresholds are already edited on the Rules and Tuning pages without a developer, and every change is a versioned config with an audit entry (D11, D35). Onboarding a bank means loading its rule package, not a new deployment.

**What would you do next?**
**"Same pipeline, new rule package: promised guaranteed returns, missing risk warnings. The bank adds a category, not a new system."** Today's five categories are about fraud and abuse. The natural next category is advisory quality under FIDLEG, the Swiss Financial Services Act: an advisor saying *"Das isch garantiert sicher"* (a guaranteed return), or a recommendation without a risk warning. After that: live warnings for access codes, where seconds matter, and the recording-system webhook instead of the inbox folder. For speech recognition: the bank's own vocabulary and known advisor names as hints (*Browser, Feld, Postfach, Countdown, Anmeldebildschirm*), measured on dev only; a targeted check of negations at the evidence passages; and separate recording channels for bank and caller, which fixes wrong speakers at the source. Threshold suggestions from feedback (D44) and the advisor view (D43) are already built.
