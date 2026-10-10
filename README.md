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
  → decision: alert / review / no alert
  → evidence snippets + twin call
  → alert to Outcept with a deep link to the passage
```

**1. Audio in, no manual step.** A folder watcher picks up every new recording and runs it through the pipeline end to end. The same path processes a whole folder in batch.

**2. Speech to text built for dialect.** Open-weight Whisper models (including Swiss German fine-tunes) run on our own GPU. We choose the model by how reliably it captures the words that matter (digits, company names, key phrases), not by overall word error rate. Speaker separation labels each line as advisor or customer.

**3. Keywords are hints, not verdicts.** A configurable keyword list (Standard German and Swiss German phrases) points the checks at the right passages. A keyword alone never raises an alert.

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

- **Alert** when the evidence is strong.
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

Python 3.11 · FastAPI · SQLite (SQLModel) · faster-whisper (Whisper large-v3) · pyannote community-1 · open-weight LLM (Qwen3.6 27B) via an OpenAI-compatible API · React + TypeScript (Vite, Tailwind) · wavesurfer.js

## Try it with your own recordings

Step-by-step guide for case partners and testers: set up once, then transcribe new recordings with one command and check them in the app, in 5–10 minutes: [`docs/GUIDE_PARTNERS.md`](docs/GUIDE_PARTNERS.md).

## Run it

From a fresh clone. Needs macOS or Linux with [uv](https://docs.astral.sh/uv/), ffmpeg, Docker, Node 22+, an OpenAI-compatible endpoint for an open-weight model (OpenRouter during the sprint), and for speech recognition a GPU machine with an NVIDIA card and a Hugging Face token.

### 1. Backend setup

```bash
git clone https://github.com/Dinesh18S/Klartext.git && cd Klartext
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
cp .env.example .env        # then fill in LLM_API_KEY, LLM_MODEL (e.g. qwen/qwen3.6-27b), HF_TOKEN
```

Keep `LLM_SAMPLES=5` and `LLM_REASONING=off`: the evaluated configuration. Keys stay in `.env`, which git ignores.

### 2. Case data and database

```bash
git clone --depth 1 https://github.com/Outcept/inventx-case-study /tmp/inventx-case-study
mkdir -p case-data && cp -R /tmp/inventx-case-study/data/. case-data/
cd backend && ../.venv/bin/python -m app.db.init && cd ..   # creates data/klartext.db with the seeded configs
```

`case-data/`, `data/` and `inbox/` are git-ignored: no audio or results in the repository.

### 3. Outcept trigger API

```bash
docker compose up -d trigger-api    # list at http://localhost:8080, bound to localhost only
```

### 4. Speech recognition (GPU machine)

Klartext transcribes on its own GPU; the laptop pipeline reads the transcripts from `data/transcripts/<call_id>.json`.

```bash
scp backend/scripts/run_asr.py backend/scripts/setup_gpu.sh <user>@<gpu-host>:~/
ssh <user>@<gpu-host>
read -s HF_TOKEN && export HF_TOKEN          # accept the terms of pyannote/speaker-diarization-community-1 first
bash ~/setup_gpu.sh && source ~/klartext-gpu/env.sh
python ~/run_asr.py --in ~/klartext-gpu/case-data/Audio --out ~/klartext-gpu/out/large-v3 --model large-v3 --diarize
```

Back on the laptop: `scp "<user>@<gpu-host>:~/klartext-gpu/out/large-v3/*.json" data/transcripts/`, then stop the GPU machine.

### 5. Process all calls

```bash
cd backend && ../.venv/bin/python scripts/process_all.py && cd ..
```

Runs every stage for the 60 recordings (roles, numbers, keywords, family checks, decision, evidence snippets, twin calls, Outcept triggers) and prints the counts. Re-runs reuse stored results; `--from <stage>` re-runs from a stage, `--list` prints every verdict.

### 6. API server with the inbox watcher

```bash
cd backend && ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API docs at http://127.0.0.1:8000/docs. The watcher starts with the server: a WAV dropped into `inbox/` is processed with no click (it needs its transcript in `data/transcripts/`). `WATCHER_ENABLED=false` turns it off.

### 7. Frontend

```bash
cd frontend && npm install && npm run dev       # http://127.0.0.1:5173, proxies /api to port 8000
```

Without a backend: set `VITE_USE_FIXTURES=true` in `frontend/.env.development` (fixtures with a simulated pipeline).

### 8. Evaluation

```bash
cd backend
../.venv/bin/python scripts/evaluate.py --split dev --source asr     # precision, recall, confusion matrix, pairs, evidence overlap
../.venv/bin/python scripts/asr_benchmark.py                         # ASR models by critical token recall (dev)
../.venv/bin/python scripts/injection_test.py                        # prompt injection must not change verdicts
```

The holdout split is evaluated once with frozen prompts and thresholds (`--split holdout --holdout`); results are on the Quality page.

### 9. A new folder of recordings (hidden test set) and export

```bash
.venv/bin/python backend/scripts/prepare_hidden_set.py --in <folder> --out data/hidden-test-set
# transcribe data/hidden-test-set/*.wav on the GPU machine (step 4) into data/transcripts/
cd backend && ../.venv/bin/python scripts/process_all.py --folder ../data/hidden-test-set
../.venv/bin/python scripts/export_results.py --folder ../data/hidden-test-set --out ../data/export/hidden_results
```

Full step-by-step procedure: [`docs/RUNBOOK_HIDDEN_SET.md`](docs/RUNBOOK_HIDDEN_SET.md). All calls at once: `GET /api/pipeline/export?format=json` or `format=csv`.

### Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q        # API, pipeline, shared decision cases
cd frontend && npm test                               # decide.ts against the same shared/decision_cases.json
```
