# 02 · App Flow: Klartext

One user: the compliance officer. Desktop first (1280–1600 px wide), usable down to tablet. No login screen in the MVP.

## Navigation

Left sidebar, fixed, icon + label:

1. **Inbox**: flagged calls, default landing page
2. **All calls**: every processed call, including no alert
3. **Tuning**: how strict Klartext is
4. **Rules**: what Klartext listens for
5. **Quality**: detection quality on the test set
6. **Advisors** (stretch): patterns per advisor
7. **Pipeline**: processing status and the inbox folder

Bottom of sidebar: settings (model, endpoint, trigger API URL) and a small status dot (pipeline running / idle).

Top bar: page title on the left, global search (call ID, advisor, text in transcript) on the right.

---

## Screen 1: Inbox

**Purpose:** what needs the officer's attention, most urgent first.

**Header row**
- Title "Inbox"
- Summary counts: alarms, reviews, checked today, coverage ("60 of 60 calls checked")
- Filters (open a filter modal like the Vocalyn reference): verdict, family, level (Stufe 1/2/3), audio (clean/noisy), date, advisor

**List** (table-like rows, not cards), sorted by verdict then score:
- Verdict chip: Alarm (red) / Review (blue) 
- Call ID and audio variant as a small chip (e.g. "Stufe2_C09" + chip "Clean")
- Family label ("Access code shared")
- One-line reason, max 1 line, truncated
- Score (0–100) as a small bar
- Duration, processed time
- Status icons: feedback given, sent to Outcept

**Interactions**
- Click row → Call view
- Keyboard: ↑/↓ to move, Enter to open, A / F to mark correct / false alarm
- Empty state: "No calls need attention. 60 of 60 calls checked." with link to All calls

## Screen 2: Call view (the core screen)

**Purpose:** understand one decision in under 30 seconds.

Layout: two columns. Left 60% evidence and audio, right 40% decision and transcript.

**Top: verdict header**
- Large verdict chip + family + score
- Reason in one or two sentences (plain German or English, toggle)
- If review: the open question in a highlighted box: "Missing: was the value still valid when it was read out?"
- Buttons: "Correct", "False alarm", "Missed something" (feedback), "Send to Outcept" (if not auto-sent), "Open full call"

**Left column: audio + evidence**
- Waveform of the full call. Suspicious spans highlighted in **Outcept yellow**. Speaker lanes under the waveform (Advisor / Customer).
- Evidence cards, in time order. Each card:
  - Role tag: Context (earlier turn that changes the meaning) / Trigger (the critical moment) / Exclusion (rules the event out)
  - Timestamp range, speaker
  - Quote in serif italic (transcribed text)
  - Play button: plays the snippet with 10 s before and after
  - Criterion: which family rule it supports
- **Twin call box** (when one exists): "Similar call without alarm: Stufe2_C10. Same six digits read out, but the customer reads an expired sample from the manual." Link opens that call.

**Right column: checks + transcript**
- Checks table: one row per family. Event (present / absent / undetermined / not applicable), score, agreement (e.g. 3/3 runs agree). Click a row to see that check's reasoning.
- Keyword hits: phrase, family, timestamp, labelled relevant or benign by the model.
- Transcript: speaker-labelled segments with timestamps. Evidence segments highlighted. Click a segment to seek audio.
- Transcription confidence warning on segments with low ASR confidence.

**Deep links**
- `/calls/{call_id}?t={seconds}` opens the call with the audio cued at t and the matching evidence card focused. This is the URL sent to the Outcept trigger API.

## Screen 3: All calls

Same table as Inbox, including no alert. Extra columns: expected verdict (from the test set, shown only in evaluation mode) and a match/mismatch marker. Filter "Only mismatches" helps debugging and shows honesty in the demo.

## Screen 4: Tuning

**Purpose:** set how strict Klartext is and see the cost immediately.

- Two sliders on one track: "Review from" and "Alarm from" (score 0–100).
- Preset buttons: "Catch everything" (recall first), "Balanced", "Fewer reviews" (precision first).
- Live panel, recalculated on every slider move (client-side, no backend call):
  - Calls: alarms / reviews / no alert counts
  - On the test set: caught / missed / false alarms / extra reviews
  - Precision and recall
  - 3×3 confusion matrix (expected vs Klartext)
  - Precision–recall curve with the current point marked
- Plain sentence summary: "At these settings Klartext catches 15 of 16 cases and sends 3 harmless calls to review."
- Button "Apply" saves the thresholds (versioned, shown in audit log). "Suggest from feedback" (stretch) proposes thresholds from marked false alarms.

## Screen 5: Rules

**Purpose:** what Klartext listens for, editable without code.

Two tabs:

**Tab "Families"**: one card per family (trade, splitting, access, disclosure, documentation; numbers shown as a helper).
- On/off toggle
- Plain-language rule (from `policy_examples`), editable text area
- "What counts as harmless" text, editable
- Last changed, by whom

**Tab "Keywords"**: table of keywords per family.
- Columns: keyword, Standard German phrases, Swiss German phrases, on/off
- Add phrase, add keyword, delete
- "Suggest Swiss German variants" button: the LLM proposes variants, officer accepts each one
- After save: keyword stage re-runs on all cached transcripts (seconds). A banner shows the effect: "Keyword hits: 41 → 47. Verdicts unchanged in 58 calls, 2 calls moved to review."
- Comparison box: "Keyword filter alone would flag 22 calls. Klartext flags 14."

Every save writes a new config version.

## Screen 6: Quality

**Purpose:** prove detection quality honestly.

- Headline numbers on held-out dialogues: recall, precision, exact verdict match
- Breakdown by level (Stufe 1/2/3), by family, clean vs noisy
- Confusion matrix
- Stufe2 pairs table: each pair, both expected verdicts, both Klartext verdicts, correct ✓/✗
- Evidence accuracy: share of alarms whose passage overlaps an expected evidence turn
- Error list: every mismatch with a one-line explanation, linked to the call
- "Run evaluation" button: re-runs the evaluation on current config, shows run ID and time

## Screen 7: Pipeline

**Purpose:** show it runs without anyone uploading anything.

- Inbox folder path and status (watching / paused)
- Queue: file name, stage (transcribing / diarizing / checking / deciding / done / failed), progress, duration
- Recent runs log
- Drop zone (demo convenience): dropping a file here copies it into the inbox folder. It is not an upload form; the watcher does the work.
- Batch mode: "Process folder" for the hidden test set on Sunday, then "Download results (JSON/CSV)"

## Screen 8: Advisors (stretch)

- Table of advisors: calls, alarms, reviews, families involved
- Highlight: advisors with 2+ reviews in the period
- Click → filtered call list

## Key flows

**A. New call arrives (no human)**
File lands in inbox folder → watcher picks it up → ASR → diarization → keyword stage → family checks → decision → evidence snippets cut → if alarm/review: post to Outcept trigger API with deep link → appears in Inbox.

**B. Officer reviews an alarm**
Inbox → click row → read reason → play yellow snippet → check twin call if shown → mark Correct / False alarm.

**C. Officer makes Klartext stricter**
Tuning → drag "Review from" down → see recall go up, extra reviews counted → Apply.

**D. Officer adds a keyword**
Rules → Keywords → add Swiss German phrase → Save → banner shows changed hits → Inbox updates.

**E. Sunday hidden test set**
Pipeline → Process folder → wait → Download results → submit file + show Quality page.
