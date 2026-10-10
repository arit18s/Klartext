# Demo script: 5 minutes

Draft for B34 rehearsal. Follows `01_PRD.md` section 10. Button and label names are exactly as they appear in the app. **Say** lines come from the pitch lines in `docs/DECISIONS.md`; keep them short and look at the jury, not the screen.

Times are the target *end* of each part. If you are late at 2:50, shorten part 4 to one slider move.

## Before the demo (checklist)

- [ ] Backend, frontend and Outcept trigger API running (`docker compose up -d trigger-api`, trigger list open at `http://localhost:8080` in a second tab).
- [ ] All 60 calls processed and cached. Thresholds back to **review from 30, alarm from 70** (Tuning → **Reset to saved**, or **Balanced**).
- [ ] No feedback left on C09, C10, C17 from rehearsals.
- [ ] Latest run on Quality is the B29 holdout run (`eval-20261010-073258-holdout-asr`); don't run Dev from the Quality page after it, or Dev becomes the latest run.
- [ ] Drop file ready: `data/demo/demo_call.wav` (D42: byte-different copy of Stufe2_C09-K3, same audio, so the duplicate check does not skip it). Its transcript is cached as `data/transcripts/demo_call.json`; the GPU box stays off. No `demo_call` row in the DB yet (see the reset below).
- [ ] **Reset between rehearsals** (from `backend/`): `python scripts/purge_call.py demo_call --keep-transcript`. It removes the call's DB rows, stage outputs and snippets and keeps the cached transcript. An Outcept trigger already posted stays in their list; clear it with `DELETE /triggers` on the trigger API if the list should be clean.
- [ ] Browser at 100 % zoom, 1440 px or wider, sidebar visible. Sound on, tested.
- [ ] Fallback if the backend fails: frontend in fixture mode (`VITE_USE_FIXTURES=true`), Inbox → **Simulate a new recording** plays the same flow. Backup video ready (B34).

## Demo readiness check

Run this on the real `data/klartext.db` after the 60-call batch, and again after the last rehearsal. Every row is **verify on real DB**: the stand-in DB in the cloud session only had fixture results for C09, C10 and C17. Quick API check for one call (backend running):

```bash
curl -s localhost:8000/api/calls/Stufe2_C09-K3 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['decision']['verdict'], d['decision']['family'], [(e['role'], e['seg_id']) for e in d['evidence']], d['twin'], len(d['triggers']))"
```

| Step | Call ID | Page | Must be true in the data | Status |
|---|---|---|---|---|
| Opening | – | Inbox | At least C09-K3 (alarm) and C17-K3 (review) listed; the date filter (*Last 7 days*) covers their `processed_at`. Sidebar not showing *Pipeline not reachable* or *Live updates lost* | verify on real DB |
| 1. A call arrives | drop `data/demo/demo_call.wav`, then open `demo_call` | Pipeline → Inbox → call view | **No `demo_call` row yet** (`curl -s localhost:8000/api/calls/demo_call` answers 404); after a rehearsal run `purge_call.py demo_call --keep-transcript`. If a `demo_call` row is left over, the upload is saved as `demo_call_2.wav`, which has no cached transcript and waits for ASR. `data/transcripts/demo_call.json` exists. The LLM is reachable. The watcher runs (`watching: true` in `/api/pipeline/status`). The Outcept trigger API is up (`TRIGGER_API_ENABLED=true`, Docker running). After the drop, `demo_call` is decided like C09-K3: alarm, access, trigger evidence, *Sent to Outcept*, and its twin is `Stufe2_C10-K3` (needed for step 2; otherwise do step 2 from C09-K3) | verify on real DB |
| 1. (backup) | `Stufe2_C09-K3` | Call view | The batch twin of the drop, for when the drop is slow. Verdict `alarm`, family `access`. Evidence of the access family with at least one `trigger` (the six digits) and a `context` card for "started the login herself". A snippet or the full audio plays (`/audio` answers 206). A `triggers_sent` row with a 2xx status (*Sent to Outcept at …*). No leftover feedback from rehearsals | verify on real DB |
| 2. Same digits, no alarm | `Stufe2_C09-K3` → `Stufe2_C10-K3` | Call view → twin → Quality / Rules | C09-K3's `twin_call_id` is `Stufe2_C10-K3` with a one-sentence `twin_note` (button **Open Stufe2_C10**). C10-K3 verdict `no_alert`, ideally with `exclusion` evidence (the expired sample, no login started). The latest eval run (or Rules → Keywords) has the keyword baseline for *Compared with a keyword filter* | verify on real DB |
| 3. When the call doesn't settle it | `Stufe3_C17-K3` | Call view | Verdict `review`, family `access`, `open_question` set (*Was the code still valid when it was read out?*). The access check is `undetermined`, so *Why the access check is unclear* shows; the Checks table shows the real agreement (k = 5, e.g. *3 of 5*). No feedback yet, so **Escalate as alarm** / **Close as no alert** are unpressed | verify on real DB |
| 4. Compliance sets how strict it is | – (all calls) | Tuning → Rules | `/api/scores` lists all 60 decided calls with `expected_verdict` (needs `CASE_DATA_DIR` with `Skript_mit_Sollbewertung`). Active thresholds review 30, alarm 70. All five families enabled. After the demo edit, the family is switched back on and the removed keyword is back (each save is a new config version, that is fine) | verify on real DB |
| 5. Quality, measured honestly | – | Quality, Outcept tab | The B29 holdout run is the latest eval run (`/api/eval/latest` shows `split: holdout`, recall 1.00, precision 0.91); nobody ran Dev from the Quality page after it. Mismatches have reasons. The Outcept list at `localhost:8080` shows the C09-K3 alarm and the C17-K3 review, and their deep links open Klartext at the passage (*Opened from Outcept link*) | verify on real DB |
| Fallback | – | Fixture mode tab | A second frontend with `VITE_USE_FIXTURES=true` is open; Inbox → **Simulate a new recording** works | verify before the demo |

---

## 0:00 – 0:20 · Opening

**Screen:** Inbox, no filters changed.

**Say:** "Banks record every advisory call, and almost none are ever listened to. Klartext checks every call, in Swiss German, and hands the compliance officer the 20 seconds that matter, with a reason. When the call doesn't settle it, Klartext says what's missing."

## 0:20 – 1:20 · 1. A call arrives and becomes an alarm

**Do:**
1. Sidebar → **Pipeline**. Drag `data/demo/demo_call.wav` onto **Drop a WAV file here** (or copy it into the inbox folder).
2. While the queue row moves through *Transcribing → Separating speakers → Checking → Deciding*:

   **Say:** "Nobody uploads anything. A call ends, the recording lands, Klartext checks it."
3. When the toast **New alarm** appears: sidebar → **Inbox**. The new row slides in at the top.
4. Open the new row **demo_call** (same audio and transcript as Stufe2_C09-K3; it shows the file name and no Clean/Noisy chip, because the name is not a case recording ID). Point at the red **Alarm**, **Access code shared**, the reason. If the drop is slow, open **Stufe2_C09** instead and carry on.
5. On the yellow **Trigger** card, click **Play passage** (plays 10 s before and after). Let the six digits play.

**Say:** "Yellow means listen here. The customer started the login herself a minute earlier, so these six digits are a live code, and the advisor asked for them."

## 1:20 – 2:10 · 2. Same digits, no alarm

**Do:**
1. Scroll to **Similar call without alarm: Stufe2_C10** → **Open Stufe2_C10**.
2. Point at **No alert** and the reason: the customer reads an expired sample from the manual; no login was started. Point at the **Exclusion** cards.
3. Sidebar → **Quality** → panel **Compared with a keyword filter** (or Rules → **Keywords** → *Keyword filter alone would flag …*).

**Say:** "Same six digits, two verdicts. A keyword filter flags both. Keywords tell us where to look; context tells us what it means."

## 2:10 – 2:50 · 3. When the call doesn't settle it

**Do:**
1. Sidebar → **Inbox** → open **Stufe3_C17** (blue **Review**).
2. Point at **Missing to decide**: *Was the code still valid when it was read out?*
3. Point at **Why the access check is unclear** and the **Checks** table (how many of the 5 runs agree, e.g. *3 of 5*).
4. Show the buttons **Escalate as alarm** / **Close as no alert**. Don't click.

**Say:** "When Klartext can't know, it says exactly what's missing and hands it to a human. A review counts as caught, so we never stay silent on a real case."

## 2:50 – 3:50 · 4. Compliance sets how strict it is

**Do:**
1. Sidebar → **Tuning**. Read the sentence: *At these settings Klartext catches … of … cases and sends … harmless calls to review.*
2. Drag **Alarm from** down, then **Review from** up. Counts, **Expected vs Klartext** and **Precision vs recall** move with every step; no server call.
3. Click **Catch everything**, then **Balanced**.
4. Sidebar → **Rules** → **Families**. Switch one family off (e.g. **Relevant information left out**) → **Save rules**. Back to **Tuning**: the numbers change.
   *Alternative:* **Keywords** tab → remove one phrase → **Save keywords** → banner *Keyword hits: … → …*.
5. Switch the family back on and save (so the rest of the demo is clean).

**Say:** "Compliance owns the thresholds. You see the cost before you save, every change is a new version in the audit log, and no developer is needed."

## 3:50 – 4:40 · 5. Quality, measured honestly

**Do:**
1. Sidebar → **Quality**. Latest run on **Holdout**. Point at **Recall**, **Precision** and the targets.
2. **Breakdown** → **Audio**: clean vs noisy. Point at **Stufe 2 pairs on clean audio**.
3. **Every mismatch**: name one honestly, with its reason.
4. Switch to the Outcept tab (`http://localhost:8080`): the alarm and the review are listed. Click one link: Klartext opens at the passage, card marked *Opened from Outcept link*.

**Say:** "Our numbers come from calls we never tuned on. Every alarm and review goes to Outcept with a link to the exact passage."

## 4:40 – 5:00 · Close

**Screen:** the call view of C09 or the architecture slide.

**Say:** "Every model we use can run on a GPU inside the bank. Today OpenRouter for speed; in the bank, one URL change and nothing leaves the building. Every bank call heard. Every alert explained."

---

## If something goes wrong

| Problem | What to do | Say |
|---|---|---|
| Drop doesn't start | Copy the file into the inbox folder instead; or skip to the processed C09 | "The same file was processed this morning; here is its result." |
| ASR or LLM slow | Don't wait. Open C09 directly | "In the bank this runs on dedicated GPUs; let me show the result." |
| Audio silent | Read the trigger quote aloud from the card | "Six digits, read out right after she started the login." |
| Backend down | Fixture mode tab → Inbox → **Simulate a new recording** | (say nothing about it; carry on) |
| Everything down | Backup video | "Here is the same flow recorded an hour ago." |
