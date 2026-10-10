# 03 · Tech Stack: Klartext

Rule from the case: **if it can be self-hosted, it is allowed.** Every model in this stack is open-weight. Pin exact versions when installing and record them in `requirements.txt` / `package.json`. Do not invent library names or APIs; check the docs linked below.

## Overview

```
Exoscale GPU (Vienna, A30/A5000 24 GB)       Laptop (demo + development)
┌───────────────────────────────┐           ┌──────────────────────────────────────┐
│ ASR batch job                 │  JSON →   │ FastAPI backend + SQLite             │
│  faster-whisper / WhisperX    │           │  pipeline: keywords, checks, decide  │
│  wav2vec2 alignment           │           │  watcher on ./inbox                  │
│  pyannote diarization         │           │  ffmpeg snippets, audio range server │
└───────────────────────────────┘           │                                      │
                                            │ React frontend (Vite)                │
OpenRouter (open-weight LLMs only)  ←──────│ LLM client (OpenAI-compatible)       │
                                            │                                      │
                                            │ Outcept trigger API (Docker, :8080)  │
                                            └──────────────────────────────────────┘
```

Production story: ASR and LLM both run on GPUs inside the bank (e.g. Inventx ix.Cloud). The LLM URL changes from OpenRouter to a vLLM server; nothing else changes.

## Backend and pipeline

| Area | Choice | Notes |
|---|---|---|
| Language | Python 3.11 | One language for pipeline and API |
| Packaging | `uv` (or pip + venv) | `requirements.txt` pinned |
| API | FastAPI + Uvicorn | Async, auto OpenAPI docs at `/docs` |
| Data models | Pydantic v2 | Same models validate LLM JSON output |
| Database | SQLite via SQLModel | One file `data/klartext.db`. No server to run |
| Large artifacts | JSON files on disk | Transcripts, check outputs. DB stores paths and summaries |
| Folder watcher | `watchdog` | Watches `./inbox` for new WAV files |
| Background jobs | Simple in-process queue (`asyncio.Queue`) + one worker | No Redis/Celery needed for the demo |
| Audio tools | ffmpeg (CLI), `soundfile` | Snippet cutting, duration |
| Text matching | `rapidfuzz` | Fuzzy keyword matching, script-to-ASR turn alignment for evaluation |
| Metrics | scikit-learn (`precision_recall_curve`, `confusion_matrix`) | Evaluation script |
| HTTP client | `httpx` | Trigger API calls |
| File uploads | `python-multipart` | Needed by FastAPI for multipart forms: `POST /pipeline/inbox` (drop zone). Approved for B25 |
| Config | `.env` + `pydantic-settings` | Keys and URLs never in code |

## Speech (runs on Exoscale GPU)

| Area | Choice | Notes |
|---|---|---|
| ASR engine | `faster-whisper` (CTranslate2) | Fast, int8/fp16. Word timestamps |
| ASR models to benchmark | `openai/whisper-large-v3` (baseline), `Flix-AI/flix-swissgerman-full` (Apache-2.0), `gcoli/whisper-large-v3-turbo-swiss-german-mit` (MIT) | Fine-tunes in Transformers format need `ct2-transformers-converter` for faster-whisper. Fallback: Hugging Face `transformers` pipeline with `return_timestamps="word"` |
| Language setting | `language="de"`, `task="transcribe"` | Output is Standard German text |
| Alignment | WhisperX alignment (wav2vec2 German model) | Better word timestamps. Known weakness on digits, so pad snippets |
| Diarization | `pyannote/speaker-diarization-community-1` | Gated on Hugging Face: accept terms, set `HF_TOKEN`. `Pipeline.from_pretrained(..., token=HF_TOKEN)` (not the old `use_auth_token=`). `pipeline.to(torch.device("cuda"))` or it runs on CPU. `num_speakers=2`. Match speakers to ASR segments with `output.exclusive_speaker_diarization`. Never `precision-2` (runs on pyannoteAI cloud, breaks the self-hosted rule). Works offline (git-lfs clone of the model): pitch point for a bank's secured environment |
| VAD | Silero VAD (built into faster-whisper `vad_filter=True`) | Reduces hallucination on noise |

Selection rule: pick the ASR model with the best **critical token recall** (digits, keyword phrases, company names) on the 60 calls, not the best WER.

## LLM (fraud checks)

| Area | Choice | Notes |
|---|---|---|
| Provider (sprint) | OpenRouter, key from case partners | Base URL `https://openrouter.ai/api/v1` |
| Provider (production) | vLLM OpenAI-compatible server | Same client, different `LLM_BASE_URL` |
| Client | `openai` Python SDK with custom `base_url` | |
| Models allowed | **Open-weight only**: Qwen, Llama, Mistral, DeepSeek families; Apertus if listed | Never Claude, GPT or Gemini, even via OpenRouter |
| Models to benchmark | One large (~70B+ or MoE), one mid (~30B) | Pick by precision/recall on dev split. Record exact OpenRouter model ID in config |
| Output | JSON schema / structured outputs where the model supports it, otherwise JSON mode + Pydantic validation + one retry | |
| Sampling | k = 5 runs per family check, temperature 0.3 | Agreement feeds uncertainty. k = 5 for stable scores (DECISIONS D18) |

## Frontend

| Area | Choice | Notes |
|---|---|---|
| Build | Vite + React + TypeScript | No SSR needed |
| Styling | Tailwind CSS | Tokens from `04_FRONTEND_GUIDELINES.md` in `tailwind.config` |
| Components | shadcn/ui (Radix based) | Dialog, Slider, Tabs, Table, Toggle, Tooltip |
| Icons | lucide-react | Stroke 1.5 |
| Data fetching | TanStack Query | Caching, refetch on pipeline events |
| Routing | React Router | Deep link `/calls/:id?t=` |
| Waveform | wavesurfer.js + Regions plugin | Yellow regions for evidence |
| Charts | Recharts | PR curve, bars |
| Fonts | Instrument Sans, Newsreader (Google Fonts, self-host files) | See design doc |

## Integrations

| Integration | How |
|---|---|
| Outcept trigger API | `docker run --rm -p 8080:8080 ghcr.io/outcept/inventx-case-study`. POST `/triggers` with `url`, `title`, `description` |
| Case data | `git clone https://github.com/Outcept/inventx-case-study` → copy `data/` into `case-data/` (git-ignored if large) |

## Environment variables (`.env.example`)

```
# LLM
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=
LLM_MODEL=            # open-weight model ID from OpenRouter
LLM_SAMPLES=5
LLM_TEMPERATURE=0.3

# Speech (GPU box)
ASR_MODEL=
HF_TOKEN=

# App
DATA_DIR=./data
INBOX_DIR=./inbox
CASE_DATA_DIR=./case-data
PUBLIC_BASE_URL=http://localhost:5173
TRIGGER_API_URL=http://localhost:8080
TRIGGER_API_ENABLED=true
```

## Repo layout

```
klartext/
├── CLAUDE.md
├── docs/                    # these 8 files + design-refs/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app
│   │   ├── api/             # routers
│   │   ├── pipeline/        # asr_import, keywords, checks, decide, snippets, align
│   │   ├── models/          # SQLModel tables + Pydantic schemas
│   │   ├── prompts/         # family check prompt templates
│   │   ├── services/        # llm_client, trigger_client, watcher
│   │   └── eval/            # evaluation + splits
│   ├── scripts/             # CLI: run_asr.py (GPU), process_all.py, evaluate.py
│   └── tests/
├── frontend/
│   └── src/ (pages, components, lib, fixtures)
├── data/                    # db, transcripts, checks, snippets (git-ignored)
├── inbox/                   # watched folder (git-ignored)
└── case-data/               # Outcept data (git-ignored)
```

## Docs to keep open

- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- WhisperX: https://github.com/m-bain/whisperX
- pyannote: https://huggingface.co/pyannote/speaker-diarization-community-1
- OpenRouter API: https://openrouter.ai/docs
- FastAPI: https://fastapi.tiangolo.com
- SQLModel: https://sqlmodel.tiangolo.com
- wavesurfer.js: https://wavesurfer.xyz
- shadcn/ui: https://ui.shadcn.com
- Case repo: https://github.com/Outcept/inventx-case-study
