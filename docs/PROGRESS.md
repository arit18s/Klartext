# Progress: Klartext

Updated with every step's commit. Steps and checks: `06_IMPLEMENTATION_PLAN.md`. Submission Sunday 08:30, feature freeze Saturday 22:00.

Last update: Sat 10 Oct, 09:45 (B30, B31 done; clean final run of all 60 calls on the frozen config).

## Next up

| Track | Next 3 steps |
|---|---|
| Backend | **B32** freeze (Sat 22:00) → **B34** demo rehearsal ×3 + backup recording → **B35** final run Sunday 06:00 (repeat the clean re-run below) |
| Frontend | **F10** Switch to real API (needs B24–B26, incl. SSE `/api/events` and `POST /pipeline/inbox`) → integration bugs → demo rehearsal with B34 |

## Demo prep (todo)

- [x] **Live-drop call:** a re-encoded copy of **Stufe2_C09-K3** (the PRD demo alarm, 2:23, twin C10 in the batch): `ffmpeg -i case-data/Audio/Stufe2_C09-K3.wav -af adelay=300 -ar 16000 -ac 1 demo_call.wav`. Different bytes → not skipped as a duplicate; neutral name → no level/variant chip (hidden-set behaviour). Keep it out of the batch by never putting it in case-data/Audio.
- [x] **Its transcript:** decided (D42): copy of Stufe2_C09-K3's transcript as `data/transcripts/demo_call.json`; no live ASR. File: `data/demo/demo_call.wav` (byte-different, identical audio). Rehearsed: drop → alarm, access, twin C10, in 6 s with cached LLM answers (30–60 s with an empty cache).
- [ ] **Reset after each rehearsal:** `python scripts/purge_call.py demo_call --keep-transcript`, then `DELETE /triggers` on the Outcept API if its list should be clean.

## Clean demo state (Sat 09:45)

Final run on the frozen config (check prompts a8ee57dbcc41, thresholds v4, large-v3, k=5, reasoning off): 60/60 calls done, decisions identical to before the reset (60/60 verdict, family, score, reason, twin), 35 triggers in the Outcept list, 166 evidence rows with snippets, 53 calls with an advisor name (25 distinct). Config versions and the 4 eval runs kept; per-call rows and stage files rebuilt. Backup of the previous DB: `data/klartext.backup-20261010-0941.db`. `demo_call` is not in the DB; `data/demo/demo_call.wav` and its transcript are ready.

## Risks / open items

1. **Review threshold at k = 5 (decided: k = 5, DECISIONS D18).** k=5 scores are stable (max diff 10 vs 33 at k=3) but at T_review 30 dev recall is 0.82 / 0.91: C20 and C18 are borderline for the model, C14 a stable false alarm at 80. B28 picks the review threshold on the ASR PR curve (recall 1.00, best precision); 30 until then.
2. **ASR not measured yet.** All check results so far run on script text. Swiss German ASR will drop digits and key phrases; expect dev numbers to fall. B15 picks the model by critical token recall.
3. **GPU is smaller than planned.** RTX 3080 Ti 12 GB (AT-VIE-2), not A30/A5000 24 GB. Enough for faster-whisper large-v3 + pyannote, one model at a time. Driver 595 / CUDA 13.2: faster-whisper needs the CUDA 12 pip libs (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`).
4. **C14 and C20 unstable** (C14 extra review or alarm, C20 review or missed, depending on the run). Prompt time-box in B13 is used up.
5. **Holdout has no disclosure case** (D07, C12, C18 are all in dev). Disclosure recall can only be shown on dev.
6. **Contract gaps for B20/B24:** `quote` must be an exact substring (snap fuzzy quotes in B20); `CheckResult.samples` = our `valid_samples`; fields marked "still invented" in `API_CONTRACT.md` need a review before B24.
7. **`decide.ts` has no `reason_de`.** Fine for Tuning; needed if the UI shows German reasons from client-side decisions.
8. **Full LLM run cost/time.** Reasoning off: ~13 min for 60 recordings at concurrency 8. Rate limits at that load are untested.
9. **Trigger API image** `ghcr.io/outcept/inventx-case-study` is not publicly pullable; compose builds it from the case repo instead.
10. **Exoscale instance** must be stopped after every session and destroyed after the event (07_SECURITY section 8).
11. **Keyword hints are not in the check prompts yet.** Section 4 designs them in, but the prompts were tuned without them. Turning them on is a prompt change: decide in B19 with a dev re-run.
12. **Your `.env` still overrides k:** the pipeline run printed k=3. Set `LLM_SAMPLES=5` in `.env` (D18).

## Backend (Track B)

| Step | Status | Commit | Note |
|---|---|---|---|
| B1 Repo skeleton | done | `fd56ffc` | uv venv Python 3.11, FastAPI `/api/health` returns ok |
| B2 Case data | done | `fd56ffc` | 60 WAVs, 30 scripts, all 16 kHz mono; `scripts/inventory.py` |
| B3 Exoscale GPU smoke test | done | – | Manual. `klartext`, AT-VIE-2, RTX 3080 Ti 12 GB, driver 595 / CUDA 13.2, nvidia-smi ok, stopped |
| B4 Database and config | done | `87584df` | 12 tables, seeded keywords / families / thresholds 30/70; idempotent init with column migration |
| B5 Outcept trigger API | done | `87584df` | Built from the case repo (ghcr image private), bound to 127.0.0.1:8080; test trigger 201 |
| B6 Ground truth loader | done | `3e09b49` | 12 alarm / 14 no_alert / 4 review dialogues, 49 keyword annotations |
| B7 Splits | done | `3e09b49` | 22 groups, holdout 10 dialogues; C09+C10, C17, C18 kept in dev |
| B8 Script transcript adapter | done | `3e09b49` | Development only, `source: "script"`; 30 transcripts valid |
| B9 LLM client | done | `d4dc1cc` | Structured output + JSON fallback, validation retry, backoff, fail safe |
| B10 Family checks | done | `aad30a4` | Numbers helper, k samples in parallel, hallucination guard, disk cache, reasoning flag |
| B11 Decision rule | done | `99d00ab` | `shared/decision_cases.json` (22 cases) passes in decide.py and decide.ts; no_checks, alarm despite failed family, fixed family order |
| B12 Evaluation runner | done | `d0fc9c0` | `scripts/evaluate.py`: GET /eval/latest shape, keyword-only baseline, `--holdout` guard. Dev/script, reasoning off: P 0.91 R 0.91, exact 17/20; on: 1.00 / 1.00, 20/20; keyword baseline P 0.57 R 0.36 |
| B13 First tuning loop | done | `961dc84` | 5 iterations on dev, reasoning off: precision 0.92, recall 1.00, exact 18/20. Reasoning on: 0.91 / 0.91, 5× slower; default off. Stability check after B12: see risk 1 (`run_checks.py --sample-offset` for independent repeat runs) |
| B14 ASR script for GPU box | done | (this commit) | Check passed on the GPU box: Stufe1_D01-K1 (166 s) in 11.7 s with diarization (39 s incl. model load). Schema valid, 343 words (script: 343), speakers match script roles in 40/42 segments. Versions in `backend/requirements-gpu.lock.txt`. env.sh fixed (nvidia namespace packages) |
| B15 ASR bake-off | done | (this commit) | Dev (40 recordings), critical token recall: large-v3 95% (103/108, WER 58%), flix 95% (103/108, WER 59%), gcoli-turbo 91% (98/108). Chosen: **large-v3** (tie with flix, wins on WER; no conversion). Speed for 59 calls: gcoli 538 s, large-v3 996 s, flix 1020 s. DECISIONS D19 |
| B16 Role labelling and normaliser | done | `f98443d` | Cue rule + LLM fallback (`prompts/roles_system.md`, temperature 0) + first-speaker fallback. Check on all 40 dev recordings: key (evidence) turns 94% right, 39/40 calls right (C14-K4 noisy: diarization), all segments 89%; advisor name in 33/40. Normaliser handles "10 '000" |
| B17 Optional ASR service | todo | – | |
| B18 Pipeline orchestrator | done | (this commit) | Check passed: all 60 calls `done` on large-v3 transcripts, 0 failed. Fixed on the way: hard 240 s deadline per LLM request (a provider kept stalled requests open; the run hung). Dev on ASR: P 0.92 R 1.00, exact 37/40, Stufe2 pairs 4/5, Stufe3 review 5/6 (C20-K4 alarm, still caught), clean/noisy 19/20 |
| B19 Keyword stage + rescan diff | done | `6714166` | Keyword stage in the pipeline (B18) + `pipeline.keywords.rescan()` returning the POST /keywords/rescan body (`dry_run` option). Check: active config reproduces 78 stored hits; adding "Franken" → 124 hits, 30 changed calls, keyword-only flags 20 → 39. Endpoint wiring is the teammate's (api/). Keyword hints still not in the check prompts (risk) |
| B20 Evidence and snippets | done | (this commit) | Check passed: C09-K3 trigger S023 snippet (94–120 s) contains code 836174. 166 evidence rows with snippets in 46 calls. Fixed: number stage merges ASR digit groups ("836" "174", "10" "'000") |
| B21 Twin call | done | (this commit) | Check on dev pairs (C15/C16 is holdout): flagged ↔ harmless partner found 12/12 incl. C09 ↔ C10 (similarity 62–76). C13/C14: no twin while C14 is a false alarm. Fixed: similarity on equal-length windows (token_sort_ratio) and same-family candidates; notes never say "Call A/B" |
| B22 Trigger API integration | done | (this commit) | 35 alarms/reviews posted to Outcept with deep links, re-runs skip already-posted calls (60 skipped on re-run) |
| B23 Evaluation on ASR | done | `bf2132f` | `evaluate.py --source asr` reads the pipeline's results. Dev: P 0.92 R 1.00 vs script source 0.91/0.91 (k=5, B12); evidence overlap 17/19 alarms (89%, target 90%); keyword-only baseline 14 flags, P 0.57 R 0.36 |
| B24 Read API | done | `5ee4bfc` | All GET endpoints of `API_CONTRACT.md` incl. SSE `/api/events`, routers in `app/api/`. 53 API tests on a seeded temp DB; the three call details, list, scores, thresholds, keywords, eval and settings equal the frontend fixtures. Open for the pipeline track: evidence falls back to `data/checks/<id>.json` until B20 fills the `evidence` table; `/pipeline/status` is derived from `calls` until the watcher (B26) reports to `app/api/pipeline_state.py` (`watching` is false until then); the pipeline should call `app.api.events.notify_call_updated(call_id)` / `notify_pipeline_status()`; `checks` lists only families with a `check_results` row; audio is served only from DATA_DIR, INBOX_DIR or CASE_DATA_DIR; tests need `pytest` (dev only, not in `requirements.txt`) |
| B25 Write API | done | `fd85059` | All write endpoints of `API_CONTRACT.md` plus `GET /calls/{id}/history`; 65 new API tests (119 backend tests pass). PUTs write a new active version + `audit_log` (`config_changed`, target `<kind>:<id>`), families get `changed_at`/`changed_by` per changed family; recheck runs `process(from_stage="checks")`, retry from `asr`, process-folder registers + processes in one background worker (`app/api/jobs.py`); `/eval/run` runs `scripts/evaluate.py --source asr` (holdout/all pass `--holdout`; failure → 409 with the script's message); inbox duplicate answers 202 `{queued: false, duplicate: true}` as in the contract (not 409); 422 details are one plain sentence; suggest calls `llm_client.complete_json` with an injection guard; `python-multipart==0.0.32` added |
| B26 Inbox watcher | done | `c637b25` | Started with the API server (`bbc5b59`).  `services/watcher.py` + `scripts/watch_inbox.py`: watchdog + 5 s scan, stable-size wait, ffmpeg conversion to 16 kHz mono, one worker thread, hash dedup, reports to `api/pipeline_state` (watching, file seen, progress, batch). Check: 44.1 kHz stereo drop → done in 56 s with 3 evidence rows + snippets and an Outcept trigger; duplicate skipped. Starting it with the API server needs a hook in `main.py` (teammate / open) |
| B27 Fixture export | todo | – | |
| B28 Threshold tuning on dev | done | (this commit) | Review 30 / alarm 70 saved as thresholds version 4 (via PUT /config/thresholds, audit logged), all 60 decisions re-decided on it. Recall 1.00 holds 10–50 on dev; 30 keeps a two-vote margin (DECISIONS D11) |
| B29 Holdout run | done | (this commit) | Once, frozen (check prompts a8ee57dbcc41, thresholds v4, large-v3, k=5, reasoning off): 20 holdout recordings P 0.91 R 1.00, exact 18/20, Stufe2 pairs 3/3, Stufe3 review 1/2 (C19-K4 alarm, caught), clean/noisy 8/10, evidence overlap 9/9, family 10/10; keyword-only P 0.67 R 0.40. Extra flag: C15-K4 (review). Nothing tuned afterwards. `data/eval/eval-20261010-073258-holdout-asr.json` |
| B30 Hidden test set dry run | done | (this commit) | Isolated DATA_DIR, 6 dev recordings renamed to random names, via POST /pipeline/process-folder + GET /pipeline/export (JSON + CSV): 6/6 verdict, family and score identical to the original names, 0 new LLM requests (no prompt contains a name), level/variant/dialogue null, notes.txt rejected. Static check: names are parsed only in `display_fields()` (display) |
| B31 Robustness pass | done | (this commit) | Trigger API killed mid-run: calls still done, failed post recorded ("Connection refused"), re-run `--from notify` delivers it. Bad LLM key (empty cache): all checks failed → review "A check could not complete. Needs a human.", roles fall back, key never stored. Corrupt / empty WAV: rejected (process-folder) or failed (watcher) with a plain message, watcher keeps running. Fixed: empty file no longer blocks the watcher 60 s |
| B32 Freeze | todo | – | Sat 22:00 |
| B33 Pitch material | draft done | (this commit) | `docs/pitch/`: architecture and operating concept slides (HTML, PNG, PDF), timed demo script, Q&A sheet. Numbers marked `[B29]` until the holdout run on ASR |
| B34 Demo rehearsal | todo | – | |
| B35 Final run | todo | – | Sun 06:00 |
| B36 Submit | todo | – | Before Sun 08:30 |

Also on main: `d64bcac` contract changes (evidence `note`, decision `reason_de`), `0de94fc` docs added to the repo.

## Frontend (Track F)

| Step | Status | Commit | Note |
|---|---|---|---|
| F0 Setup and tokens | done | `d60bd06` | |
| F1 Fixtures and API client | done | `d60bd06` | Contract update `3fdbd44` |
| F2 Inbox and All calls | done | `34f91b2` | |
| F3 Call view layout | done | `a7cb097` | Design changes F1–F3 in `e6fa03a` |
| F4 Waveform and evidence | done | `b4331df` | |
| F5 Tuning page | done | `0d1aa0b` | `decide.ts` runs the shared cases; feedback label `note` in `a18c0e3`, `c03901a` |
| F6 Rules page | done | `f923c00` | Merged in `fe06d7e` |
| F7 Quality page | done | `04b7280` | Reads the B12 metrics shape; merged in `fe06d7e` |
| F8 Pipeline page | done | `78de022` | Watch toggle, queue with stages, retry, drop zone, batch, exports, recent runs; SSE layer; fixture-mode watcher simulation. New invented endpoint `POST /pipeline/inbox` for the drop zone (in `API_CONTRACT.md`) |
| F9 Live updates and polish | done | `9c368a0` | Inbox slide-in on `call_updated` (reduced motion respected), error copy for an unreachable server, read-only Settings page, axe WCAG 2 A/AA: 0 violations on 12 routes; `muted` token darkened to #666A72 for 4.5:1 on canvas |
| F10 Switch to real API | done | `b664ca3` | `VITE_USE_FIXTURES=false`. Tested in Chromium against a local DB built from the case repo (real configs, 60 real recordings; no ASR transcripts or LLM key in the cloud session, so the 3 demo calls carry fixture results and 57 wait for ASR). No shape mismatches found; fixed lane overflow and waiting-for-ASR copy. Still to do on the real `data/klartext.db`: one rehearsal run (B34), incl. eval run and rescan on real transcripts |
| R12 Advisors view (stretch) | done | `ae08384` | `GET /api/advisors?since=` (contract updated, 4 tests) + Advisors page: highlight for any alarm or 2+ reviews, row opens All calls filtered by advisor. Tested in Chromium on the stand-in DB and in fixture mode. Calls without a recognised advisor name are left out. Route rides on the scores router; register `advisors.router` in `main.py` directly if you prefer |
| Quality: Dev only until B29 | done | `a227339` | Holdout and All disabled in Run evaluation, note "Holdout opens for the final run" |
| All calls Match column fix | done | `74297fd` | Reason column absorbs the free width and truncates; table fits at 1440 px with evaluation columns (narrower windows scroll inside the panel) |
| Call report print (D30) | done | `71fb8bb` | **Print report** button + print stylesheet, A4 portrait: report header, verdict, reason, open question, evidence, twin note, checks, why-unclear, keyword hits, transcript excerpt (±1 line around evidence). Checked as PDF: C09-K3 2 pages, C17-K3 3 pages |
| Demo readiness check | done | `6ef65bd` | `docs/pitch/demo-script.md`: per step call ID, page, required data, all **verify on real DB** |
