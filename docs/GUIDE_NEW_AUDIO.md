# New recordings: from audio file to verdict

For a live test with new recordings (jury, partner, your own test files). About 5–10 minutes for a few short calls. For the hidden test set with an export, follow `RUNBOOK_HIDDEN_SET.md`.

Speech recognition runs on the GPU box (Exoscale); the checks run via OpenRouter; everything else on the Mac. The app does not start the GPU box or transcribe by itself: an upload without a transcript waits at *Waiting for ASR*.

## Before you start

- Backend and frontend running on the Mac, watcher on (sidebar: *Pipeline watching*).
- Only recordings whose speakers agreed: the transcript text goes to the LLM via OpenRouter. No real account numbers, codes or personal details.
- Recordings in one folder, nothing else in it (no music, no case files). WAV, MP3, M4A, MP4, FLAC or OGG.

## 1. Start the GPU box (2 min)

Exoscale console → Compute → Instances → `klartext` → **Start**. Wait until it shows *Running*.

## 2. Transcribe (one command, from `~/Klartext`)

```bash
backend/scripts/transcribe_on_gpu.sh ~/path/to/recordings test2
```

`test2` is any short name for this batch (letters, digits, `-`, `_`). The script prepares the files as 16 kHz mono WAV in `data/test2/`, checks the box, uploads, transcribes (about 20 s per call) and copies the transcripts into `data/transcripts/`. It ends with `Done: N of N transcripts`.

- *The GPU box does not answer*: it is not running yet, or your IP is not allowed for SSH (security group).
- The Hugging Face token comes from `.env`; if it is missing there, the script asks for it (not shown).

## 3. Stop the GPU box (1 min)

Exoscale console → `klartext` → **Stop**. Not needed for the next steps; it costs credits while it runs.

## 4. Run them through Klartext

Drop the WAVs from `data/test2/` on the Pipeline page (**Drop a recording here**), or:

```bash
cp data/test2/*.wav inbox/
```

About a minute per call. Alerts show a toast; results in Inbox (alerts, reviews) and All calls (everything). The original file names are in `data/test2/_names.csv`.

## 5. Remove them again (after the test)

From `backend/`, for each call ID (the names in `data/test2/`, without `.wav`):

```bash
rm -f ../inbox/<call_id>.wav
../.venv/bin/python scripts/purge_call.py <call_id> --keep-transcript
```

Then reset the Outcept list once: `../.venv/bin/python scripts/reset_demo.py` (this also resets `demo_call`). Leave out `--keep-transcript` to delete the transcript too. `data/` is not in git, so the recordings never go to GitHub.
