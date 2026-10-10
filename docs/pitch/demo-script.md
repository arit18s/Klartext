# Demo script: 5 minutes

Draft for B34 rehearsal. Follows `01_PRD.md` section 10. Button and label names are exactly as they appear in the app. **Say** lines come from the pitch lines in `docs/DECISIONS.md`; keep them short and look at the jury, not the screen.

Times are the target *end* of each part. If you are late at 2:50, shorten part 4 to one slider move.

## Before the demo (checklist)

- [ ] Backend, frontend and Outcept trigger API running (`docker compose up -d trigger-api`, trigger list open at `http://localhost:8080` in a second tab).
- [ ] All 60 calls processed and cached. Thresholds back to **review from 30, alarm from 70** (Tuning → **Reset to saved**, or **Balanced**).
- [ ] No feedback left on C09, C10, C17 from rehearsals.
- [ ] Holdout evaluation run once (B29), latest run shown on Quality.
- [ ] One short recording ready to drop: `Stufe2_C09-K4.wav` (noisy C09), not yet processed. **If the full 60-call batch included it, the drop answers *processed before. Skipped.*** (dedup by file hash): delete its call row before the demo, or leave it out of the batch. Live ASR only if the GPU box is up; otherwise its transcript is cached and the watcher uses it (decision open in `DECISIONS.md`).
- [ ] Browser at 100 % zoom, 1440 px or wider, sidebar visible. Sound on, tested.
- [ ] Fallback if the backend fails: frontend in fixture mode (`VITE_USE_FIXTURES=true`), Inbox → **Simulate a new recording** plays the same flow. Backup video ready (B34).

---

## 0:00 – 0:20 · Opening

**Screen:** Inbox, no filters changed.

**Say:** "Banks record every advisory call, and almost none are ever listened to. Klartext checks every call, in Swiss German, and hands the compliance officer the 20 seconds that matter, with a reason. When the call doesn't settle it, Klartext says what's missing."

## 0:20 – 1:20 · 1. A call arrives and becomes an alarm

**Do:**
1. Sidebar → **Pipeline**. Drag `Stufe2_C09-K4.wav` onto **Drop a WAV file here** (or copy it into the inbox folder).
2. While the queue row moves through *Transcribing → Separating speakers → Checking → Deciding*:

   **Say:** "Nobody uploads anything. A call ends, the recording lands, Klartext checks it."
3. When the toast **New alarm** appears: sidebar → **Inbox**. The new row slides in at the top.
4. Open **Stufe2_C09** (Clean, the processed twin with the full transcript). Point at the red **Alarm**, **Access code shared**, the reason.
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
3. Point at **Why the access check is unclear** and the **Checks** table (*2 of 3* runs agree).
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
