# Runbook: hidden test set (Sunday)

From the organisers' folder of recordings to a results file. About **30–40 min** for 20–30 calls: ASR ~17 s per call on the GPU, checks ~1 min per call at the provider's speed, plus copying.

GPU box: `klartext`, Exoscale AT-VIE-2, RTX 3080 Ti, **IP 138.124.210.190**, user `ubuntu`. Everything on the box lives in `~/klartext-gpu` (installed by `setup_gpu.sh`, B14). Laptop commands run from the repo root `~/Klartext`; `PY=.venv/bin/python`.

**Results format:** waiting for the organisers. `export_results.py` writes JSON and CSV with `call_id, file_name, verdict, family, score, reason, open_question, evidence, original_file_name`; convert from there once the format is known.

Nothing in this procedure depends on file names (B30): names only become call IDs.

---

## Sunday: files at 09:00, pitch at 09:15

One command does everything (speech to text, checks at 16 parallel requests, export, summary). Expect about 11–14 min for ~18 calls (about 17 s per call speech to text, then all checks together; decisions appear only when every call's checks are done). Do not use the drop zone for the hidden set: the watcher does one call at a time (about 1 min each).

| Time | Do |
|---|---|
| 08:15 | Start the GPU box (Exoscale console). Check: `ssh ubuntu@138.124.210.190 'nvidia-smi --query-gpu=name --format=csv,noheader'` |
| 08:30 | Submission done (repo, video, ZIP, thumbnail) |
| 08:45 | Backend + frontend running, watcher on; `cd backend && ../.venv/bin/python scripts/reset_demo.py` (clean demo); terminal open in `~/Klartext` with the command below typed in |
| 09:00 | Files arrive: put them in one folder (e.g. `~/hidden`), nothing else in it, then: `backend/scripts/run_hidden_set.sh ~/hidden` |
| ~09:12 | Summary line `N calls: … Alert, … Review, … No alert`; results in `data/export/hidden-test-set_results.csv`; in the app under **All calls**. Pick one alert to open in the pitch |
| 09:15 | Pitch. Stop the GPU box afterwards |

If it is not finished by 09:13: start the pitch as planned (the demo does not depend on the hidden set) and say *"The held-back calls arrived 15 minutes ago and are running now; results in a few minutes."* If a step fails: run the same command again; it continues where it stopped. The app has no expected verdicts for the hidden calls, so it shows no recall or precision for them: the organisers score them; our metric in the pitch stays the B29 holdout run.

## 0. Before you start (laptop, 2 min)

```bash
cd ~/Klartext
git status --short                      # frozen config: no changes to prompts or thresholds
grep -E '^LLM_(SAMPLES|REASONING)=' .env   # must show LLM_SAMPLES=5, LLM_REASONING=off
docker compose up -d trigger-api        # Outcept list at http://localhost:8080 (optional for the results)
```

## 1. Start the GPU box (2 min)

Exoscale console → Compute → Instances → `klartext` → **Start**. Wait until it is running, then:

```bash
ssh ubuntu@138.124.210.190 'nvidia-smi --query-gpu=name,memory.used --format=csv,noheader'
```

If SSH times out: check that the instance runs and that the firewall allows SSH from your current IP (security group).

> Shortcut for steps 2–5: `backend/scripts/transcribe_on_gpu.sh <folder> hidden-test-set` prepares, uploads, transcribes and fetches the transcripts in one go (HF_TOKEN from `.env` or asked, never shown). See also `GUIDE_NEW_AUDIO.md`.

## 2. Prepare the recordings on the laptop (2 min)

Put the organisers' files into a folder (e.g. `~/Downloads/hidden`), then:

```bash
.venv/bin/python backend/scripts/prepare_hidden_set.py --in ~/Downloads/hidden --out data/hidden-test-set
```

Accepted: WAV, MP3, M4A, MP4 (audio track only), FLAC, OGG. Every file becomes a 16 kHz mono WAV with an ASCII-safe name, so the call ID, the transcript name and the export match. Check the output line: count, minutes of audio, and any `SKIPPED` file (unreadable: tell the organisers). The mapping to the original names is in `data/hidden-test-set/_names.csv`.

## 3. Copy the recordings to the box (1–3 min)

```bash
ssh ubuntu@138.124.210.190 'mkdir -p ~/klartext-gpu/hidden ~/klartext-gpu/out/hidden'
scp data/hidden-test-set/*.wav ubuntu@138.124.210.190:~/klartext-gpu/hidden/
```

## 4. Transcribe on the box (~17 s per call)

```bash
ssh ubuntu@138.124.210.190
tmux new -s hidden                      # survives a dropped connection: tmux attach -t hidden
source ~/klartext-gpu/env.sh
read -s HF_TOKEN && export HF_TOKEN     # paste the token (not shown, not stored in history)
python ~/run_asr.py --in ~/klartext-gpu/hidden --out ~/klartext-gpu/out/hidden \
  --model large-v3 --diarize 2>&1 | tee ~/klartext-gpu/out/hidden.log
```

Wait for the last line `Done: N written, 0 failed`. Same model and settings as the batch (large-v3, pyannote community-1, D19/D20).

- A file fails: the line says why; the rest continue. Re-run the same command (finished files are skipped).
- Diarization fails (HF token, gated model): re-run **without** `--diarize`. Roles are then "unknown"; the checks still run.
- GPU out of memory: add `--compute-type int8_float16`.

## 5. Copy the transcripts back (1 min)

On the laptop:

```bash
scp "ubuntu@138.124.210.190:~/klartext-gpu/out/hidden/*.json" data/transcripts/
ls data/hidden-test-set/*.wav | wc -l; ls data/transcripts/ | grep -cFf <(ls data/hidden-test-set/*.wav | xargs -n1 basename | sed 's/\.wav$//')
```

Both counts must be equal.

## 6. Stop the GPU box (1 min)

Exoscale console → `klartext` → **Stop** (credits; 07_SECURITY). After the event: delete the case data on the box and destroy the instance.

## 7. Decide every call (~1 min per call)

```bash
cd backend && LLM_CONCURRENCY=16 ../.venv/bin/python scripts/process_all.py --folder ../data/hidden-test-set; cd ..
```

Check the summary line: `done N | waiting_for_asr 0 | failed 0`. Alarms and reviews are posted to the Outcept trigger API as usual.

- `waiting_for_asr`: a transcript is missing; repeat step 5 for that call.
- `failed`: the message says what to do. Re-run the same command (done calls are kept, failed ones retried).
- A provider error makes a check fail: the call goes to **review** with "A check could not complete" (fail safe). Re-run `process_all.py --folder ... --from checks` once the provider answers again.

Alternative with the API server running: `curl -s -X POST localhost:8000/api/pipeline/process-folder -H 'content-type: application/json' -d "{\"path\": \"$PWD/data/hidden-test-set\"}"` (runs in the background; watch the Pipeline page).

## 8. Export the results (1 min)

```bash
cd backend && ../.venv/bin/python scripts/export_results.py --folder ../data/hidden-test-set --out ../data/export/hidden_results; cd ..
```

Writes `data/export/hidden_results.json` and `.csv`, only the hidden-set calls (found by file hash, so a recording identical to a batch call is included too). The line must say `N of N recordings exported` and no `NOT DECIDED` / `NOT REGISTERED`.

## 9. Submit

Convert to the organisers' format if needed, submit, and keep `data/export/hidden_results.*` plus `data/hidden-test-set/_names.csv`.

Do **not** tune anything on the hidden-set results. The Quality page keeps showing the dev and holdout runs.
