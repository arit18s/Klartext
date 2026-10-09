# 06 · Implementation Plan: Klartext

Two tracks run in parallel. **Track B** (backend + pipeline, Dinesh) and **Track F** (frontend, teammate). They meet at the API shapes and fixtures in `05_BACKEND_STRUCTURE.md`.

Each step is a prompt for Claude Code. Paste it as is, after the agent has read `CLAUDE.md` and the docs. Finish a step, run it, commit, then move on. Never skip the "check" line.

Deadline: **Sunday 08:30 submission.** Feature freeze Saturday 22:00. Sleep is in the plan on purpose.

---

## Timeline

| When | Track B | Track F |
|---|---|---|
| Fri 22:00–23:30 | Phase 0: setup, data, GPU check | F0: setup, design tokens, layout |
| Fri 23:30–02:00 | Phase 1: ground truth, eval, first LLM checks on script text | F1–F3: Inbox, Call view on fixtures |
| Fri 02:00–07:30 | Sleep | Sleep |
| Sat 07:30–11:00 | Phase 2: ASR on Exoscale, model bake-off, diarization | F4–F5: waveform, evidence, Tuning |
| Sat 11:00–15:00 | Phase 3: full pipeline on ASR, decision, evidence, trigger API | F6–F7: Rules, Quality |
| Sat 15:00–19:00 | Phase 4: integration with frontend, watcher, live updates | F8: Pipeline page, polish |
| Sat 19:00–22:00 | Phase 5: tuning on dev, holdout numbers, fixes | Integration bugs, empty/error states |
| Sat 22:00–01:00 | Phase 6: freeze, pitch, demo rehearsal, backup recording | same |
| Sun 01:00–06:00 | Sleep | Sleep |
| Sun 06:00–08:30 | Phase 7: final run, export, submit | final checks |

---

## Track B: backend and pipeline

### Phase 0: setup

**B1. Repo skeleton**
> Create the repo layout from `03_TECH_STACK.md` (backend/, frontend/, docs/, data/, inbox/, case-data/). Add `.gitignore` for data/, inbox/, case-data/, .env. Add `.env.example` from the tech stack doc. Create a Python 3.11 venv with FastAPI, uvicorn, sqlmodel, pydantic-settings, openai, httpx, rapidfuzz, watchdog, soundfile, scikit-learn. Add a FastAPI app with `GET /api/health`.
> Check: `uvicorn app.main:app` returns `{"status":"ok"}`.

**B2. Case data**
> Clone https://github.com/Outcept/inventx-case-study and copy its `data/` into `case-data/`. Write `scripts/inventory.py` that lists all WAVs with duration, sample rate, derived call_id, dialogue_id, variant (K1/K3 clean, K2/K4 noisy) and level, and prints counts per level.
> Check: 60 WAVs, 30 scripts, all 16 kHz mono.

**B3. Exoscale GPU smoke test** (manual, 10 min)
> Start one GPU instance (A30 or A5000, Vienna). SSH in, run `nvidia-smi`. If GPU quota blocks you, go to the help desk now. Stop the instance after the test.

**B4. Database and config**
> Implement the SQLModel tables from `05_BACKEND_STRUCTURE.md` section 8 and the settings class. Seed `config_versions` with: keywords (copy of `Stichwortliste.json`), families (rule text from `policy_examples`, harmless text from keyword `harmless` fields, all enabled), thresholds `{review: 30, alarm: 70}`.
> Check: `python -m app.db.init` creates `data/klartext.db` with seeded configs.

**B5. Outcept trigger API running**
> Add a `docker-compose.yml` service for `ghcr.io/outcept/inventx-case-study` on port 8080. Write `services/trigger_client.py` with `send_trigger(url, title, description)` per section 7.
> Check: one test trigger appears at http://localhost:8080.

### Phase 1: ground truth, evaluation, first checks

**B6. Ground truth loader**
> Write `eval/ground_truth.py` that parses every file in `case-data/Skript_mit_Sollbewertung/` into: dialogue_id, title, family (Testziel), event (Ereignis), verdict (Bearbeitung), reason (Begründung), open_question (Offen), evidence turns (Belege), keyword annotations (Keywordstellen: keyword_id, phrase, turn, speaker, relevant|benign). Also parse the dialogue turns. Normalise verdict names to alarm / review / no_alert.
> Check: printed table matches 12 alarm / 14 no_alert / 4 review dialogues.

**B7. Splits**
> Create `eval/splits.json` with dev and holdout as defined in section 10: 22 groups (Stufe1 dialogues, Stufe2 pairs C01+C02 … C15+C16, Stufe3 dialogues), holdout = 3 Stufe1 + 3 Stufe2 pairs + 1 Stufe3, stratified by family, fixed seed. Both recordings of a script always in the same split. Demo and B10 test groups (C09+C10, C17, C18) always stay in dev.
> Check: no dialogue in both splits; holdout has at least one access and one splitting case.

**B8. Script transcript adapter (development only)**
> Write `pipeline/sources.py` with a `ScriptTranscriptSource` that turns a script into the transcript JSON format (one segment per turn, role from Beratung/Kundin, fake timestamps 10 s per turn, marked `source: "script"`). This is only for developing checks before ASR exists. The final pipeline must use ASR transcripts.
> Check: transcript JSON validates against the Pydantic model.

**B9. LLM client**
> Write `services/llm_client.py` using the `openai` SDK with `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Function `complete_json(system, user, schema_model, temperature)` that requests JSON output, validates with Pydantic, retries once with the validation error, handles rate limits with backoff. Log latency and token counts.
> Check: a toy prompt returns a valid object.

**B10. Family checks**
> Implement section 4: prompt templates per family in `prompts/`, `CheckSample` schema, the hallucination guard (seg_id exists, quote fuzzy-matches), k samples in parallel, aggregation into `check_results` (score, event_majority, agreement, needs_human_votes, open_question, reason). Also the numbers helper prompt that classifies number sequences and feeds the other checks.
> Check: run on Stufe2_C09 and C10 script transcripts; access scores differ clearly. Stufe3_C18 (event absent, expected review) must end in review via needs_human votes / open_question. Compare `LLM_REASONING` on vs off on the small dev set (dev Stufe2 pairs + C17 + C18), pick by precision/recall, then latency. If reasoning wins on quality but is too slow: hybrid (all families with reasoning off as a screen, re-run only families scoring above ~15 with reasoning on). Build the hybrid only if needed.

**B11. Decision rule**
> Implement `pipeline/decide.py` exactly as section 5, plus `decision_cases.json` with at least 12 cases (each branch, boundaries at T_review and T_alarm, failed family, needs_human majority, asr_uncertain). Unit tests over the cases.
> Check: all tests pass.

**B12. Evaluation runner**
> Write `scripts/evaluate.py --split dev|holdout|all --source script|asr` that runs checks + decision (cached check results reused unless `--recheck`), then computes all metrics from section 10 except evidence overlap, plus the keyword-only baseline. Save to `data/eval/<run_id>.json` and `eval_runs`. Print a compact report: precision, recall, confusion matrix, Stufe2 pair accuracy, Stufe3 review rate, family accuracy (excluding `numbers` dialogues, which count only as negatives with expected no_alert), mismatches with reasons.
> Check: report runs end to end on dev with script source.

**B13. First tuning loop** (time-box 60 min)
> Look at every dev mismatch. Improve prompts (rule wording, harmless reading, open-question instruction), not thresholds. Re-run dev only. Stop when Stufe2 pairs on dev are right or the time-box ends. Never look at holdout results while tuning.

### Phase 2: speech

**B14. ASR script for the GPU box**
> Write `scripts/run_asr.py`: loads a faster-whisper model (name from arg), transcribes all WAVs in a folder with the settings in section 2, saves transcript JSON with word timestamps, avg_logprob, no_speech_prob per segment. Add `--diarize` using pyannote community-1 (`token=`, `.to(cuda)`, `num_speakers=2`), assigning speakers to segments by maximum overlap with `output.exclusive_speaker_diarization`. Community-1 only, never precision-2 (cloud). Include a `setup_gpu.sh` that installs CUDA-compatible packages, ffmpeg, and converts Hugging Face Whisper fine-tunes to CTranslate2 with `ct2-transformers-converter` when needed.
> Check: one call transcribed on the GPU box in under a minute.

**B15. ASR bake-off**
> Transcribe all 60 calls with 2–3 candidate models (whisper-large-v3, Flix-AI/flix-swissgerman-full, gcoli turbo MIT). Write `scripts/asr_benchmark.py` that computes, per model and per clean/noisy: critical token recall (digit sequences, keyword phrases from ground truth annotations, names) and a rough WER against the scripts (expected high because of dialect). Pick the best model by critical token recall.
> Check: results table saved; chosen model written to `.env`. Copy all transcripts to the laptop, stop the GPU instance.

**B16. Role labelling and normaliser**
> Implement role labelling (advisor/customer, advisor name) and the number normaliser (German and common Swiss German number words to digits, digit sequence detection with timestamps).
> Check: on 10 calls, roles match the script speakers on the key turns.

**B17. Optional ASR service**
> Wrap `run_asr.py` in a small FastAPI app (`POST /transcribe`) for the GPU box, so a newly dropped call can be transcribed live during the demo. The laptop pipeline calls it when `ASR_SERVICE_URL` is set.
> Check: laptop → GPU box → transcript JSON round trip works.

### Phase 3: full pipeline

**B18. Pipeline orchestrator**
> Implement `pipeline/run.py` with stages from section 1, each idempotent, writing to disk and DB, statuses on the call row, `--from <stage>` support. `scripts/process_all.py` runs it for all calls with bounded concurrency for LLM calls.
> Check: all 60 calls reach `done` using ASR transcripts.

**B19. Keyword stage + rescan diff**
> Implement section 3 including `POST /api/keywords/rescan` returning `{before, after, changed_calls}`.
> Check: adding a phrase changes the hit count in the response.

**B20. Evidence and snippets**
> Implement section 6: evidence rows, ffmpeg snippets with ±10 s, audio range endpoint, snippet endpoint.
> Check: snippet for Stufe2_C09-K3 plays and contains the digits.

**B21. Twin call**
> Implement twin call selection and the one-sentence difference (section 6).
> Check: C09 ↔ C10 and C15 ↔ C16 find each other.

**B22. Trigger API integration**
> After each alarm/review decision, post to the trigger API with the deep link (section 7). Store in `triggers_sent`.
> Check: Outcept list page shows alarms with links that open the call view at the right time.

**B23. Evaluation on ASR**
> Run `evaluate.py --split dev --source asr`. Add evidence overlap via the turn alignment in section 10. Compare with script-source numbers to see what ASR costs.
> Check: report includes clean vs noisy agreement and evidence overlap.

### Phase 4: API and integration

**B24. Read API**
> Implement GET endpoints from section 9: calls list with filters, call detail, scores, eval latest, pipeline status, SSE events.
> Check: responses match the fixture shapes the frontend uses (diff them).

**B25. Write API**
> Implement PUT config endpoints (versioned, audit logged), feedback, recheck, keyword suggest, process-folder, export (JSON and CSV with call_id, verdict, family, score, reason, evidence times).
> Check: changing thresholds via API changes decisions on recompute.

**B26. Inbox watcher**
> Implement the watchdog watcher on `INBOX_DIR` feeding the in-process queue, file hash dedup, conversion to 16 kHz mono when needed, SSE events on progress.
> Check: copy one WAV into ./inbox; it appears as done in the UI without any click.

**B27. Fixture export**
> `scripts/export_fixtures.py` writes real API responses into `frontend/src/fixtures/`.
> Check: frontend runs on real data with the API off.

### Phase 5: quality

**B28. Threshold tuning on dev**
> Use the PR curve on dev to choose default thresholds that keep recall ≥ 0.95. Save as the active thresholds config with a note.

**B29. Holdout run**
> Run `evaluate.py --split holdout --source asr` once with frozen prompts and thresholds. These are the numbers for the pitch. If they are much worse than dev, note why honestly; do not tune on holdout.

**B30. Hidden test set dry run**
> Copy 6 random WAVs to a new folder with renamed files (no level/variant info), run process-folder, export results. Check nothing depends on file names.

**B31. Robustness pass**
> Kill the trigger API mid-run, break the LLM key, drop a corrupt file. Each must fail safely with a clear message and no crash.

### Phase 6: freeze and pitch

**B32. Freeze** at Sat 22:00. Only bug fixes after this.

**B33. Pitch material**
> One architecture slide (inbox → ASR → checks → decide → evidence → Outcept trigger, with "self-hosted in production" labels), one operating concept slide (runs on every call from the recording system, models on bank GPUs, audit log, thresholds owned by compliance), one metrics slide from the holdout run.

**B34. Demo rehearsal**
> Run the 5-minute demo script from `01_PRD.md` section 10 three times with a timer. Record one clean run as backup video.

### Phase 7: Sunday

**B35. Final run** (06:00)
> Fresh `process_all.py` with final config, `evaluate.py --split all` and `--split holdout`, export results, commit and tag `submission`.

**B36. Submit** before 08:30, then set up the demo machine: backend, frontend, trigger API running, GPU box running only if live ASR is demoed.

---

## Track F: frontend (teammate)

**F0. Setup and tokens**
> Create the Vite + React + TS app with Tailwind, shadcn/ui, lucide-react, React Router, TanStack Query, wavesurfer.js, Recharts. Add colour tokens, fonts (Instrument Sans, Newsreader) and spacing from `04_FRONTEND_GUIDELINES.md`. Build the app frame: sidebar with the Klartext logo SVG, nav items from `02_APP_FLOW.md`, top bar with search.
> Check: app frame matches the reference screenshots in docs/design-refs.

**F1. Fixtures and API client**
> Write hand-made fixtures for three calls (C09 alarm, C10 no alert, C17 review) in the exact shapes of `05_BACKEND_STRUCTURE.md` section 9. Typed API client in `lib/api.ts` that reads fixtures when `VITE_USE_FIXTURES=true`.

**F2. Inbox and All calls**
> Build the table, filters modal, verdict chips, score bars, keyboard navigation, empty state.

**F3. Call view layout**
> Verdict header with reason, open question box, feedback buttons, checks table, keyword hits, transcript list with clickable timestamps. Deep link `/calls/:id?t=` focuses the matching evidence card.

**F4. Waveform and evidence**
> wavesurfer.js waveform with yellow evidence regions and speaker lanes; evidence cards with "Play passage" (±10 s); twin call box.

**F5. Tuning page**
> Dual-handle slider, presets, live counts, confusion matrix, PR curve, summary sentence. Implement `lib/decide.ts` exactly like section 5 and run the shared `decision_cases.json` in a unit test.

**F6. Rules page**
> Families tab (toggle, rule text, harmless text) and Keywords tab (table, add/edit/delete phrases, suggest variants), save → banner with rescan diff.

**F7. Quality page**
> Headline metrics, breakdowns, confusion matrix, Stufe2 pairs table, mismatch list.

**F8. Pipeline page**
> Inbox folder status, queue with stages, recent runs, process-folder, export buttons, drop zone that copies into the inbox via the backend.

**F9. Live updates and polish**
> SSE subscription refreshes Inbox and Pipeline. Loading, empty and error states with copy rules. Accessibility checklist from the design doc.

**F10. Switch to real API**
> Turn off fixtures, fix shape mismatches, test the full demo flow.
