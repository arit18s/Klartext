# Progress: Klartext

Updated with every step's commit. Steps and checks: `06_IMPLEMENTATION_PLAN.md`. Submission Sunday 08:30, feature freeze Saturday 22:00.

Last update: Sat 10 Oct (German UI merged; German wording "Alert", German reasons in Inbox/All calls via `reason_de`, reason toggle follows the interface language).

## Next up

| Track | Next 3 steps |
|---|---|
| Backend | **B32** freeze (Sat 22:00) → **B34** demo rehearsal ×3 + backup recording → **B35** final run Sunday 06:00 (repeat the clean re-run below) |
| Frontend | Taken over from the teammate: (1) demo script D06 ✓ → (2) advisor fairness `raised_by` ✓ → (3) safe suggestion ✓ → (4) fixtures-real fallback ✓ |

## Demo prep (todo)

- [x] **Live-drop call:** a re-encoded copy of **Stufe2_C09-K3** (the PRD demo alarm, 2:23, twin C10 in the batch): `ffmpeg -i case-data/Audio/Stufe2_C09-K3.wav -af adelay=300 -ar 16000 -ac 1 demo_call.wav`. Different bytes → not skipped as a duplicate; neutral name → no level/variant chip (hidden-set behaviour). Keep it out of the batch by never putting it in case-data/Audio.
- [x] **Its transcript:** decided (D42): copy of Stufe2_C09-K3's transcript as `data/transcripts/demo_call.json`; no live ASR. File: `data/demo/demo_call.wav` (byte-different, identical audio). Rehearsed: drop → alarm, access, twin C10, in 6 s with cached LLM answers (30–60 s with an empty cache).
- [x] **Harmless call with a keyword (brief):** C10 has no registered keywords, so demo step 2 first shows Stufe1_D06-K1 (7 keyword hits, no alert, access check absent), then C10 as the context twin. D06's headline reason is about the trade family (all scores 0); the presenter opens the access check instead.
- [ ] **Reset after each rehearsal:** `python scripts/purge_call.py demo_call --keep-transcript`, then `DELETE /triggers` on the Outcept API if its list should be clean.

## Clean demo state (Sat 09:45)

Final run on the frozen config (check prompts a8ee57dbcc41, thresholds v4, large-v3, k=5, reasoning off): 60/60 calls done, decisions identical to before the reset (60/60 verdict, family, score, reason, twin), 35 triggers in the Outcept list, 166 evidence rows with snippets, 53 calls with an advisor name (25 distinct). Config versions and the 4 eval runs kept; per-call rows and stage files rebuilt. Backup of the previous DB: `data/klartext.backup-20261010-0941.db`. `demo_call` is not in the DB; `data/demo/demo_call.wav` and its transcript are ready.

## Submission checklist (01_PRD.md §12)

9 of 10 done. Open: **backup screen recording of the demo** (B34). Security checklist (07 §8): no secrets in git history, `.env` ignored, no real data, open-weight models only, injection test 4/4 (`scripts/injection_test.py`), audio only via the API, backend and trigger API on localhost; open: stop the Exoscale instance after use and destroy it after the event.

## Risks / open items

1. **Exoscale instance:** stop after every use; after the event delete the case data on it and destroy it (07_SECURITY §8). Rotate the OpenRouter key after the event.
2. **Hidden test set day-of:** depends on the GPU box starting and on the results format (asked the organisers). Runbook: `docs/RUNBOOK_HIDDEN_SET.md`.
3. **Known errors, accepted:** C14 documentation false alarm (dev, both recordings); noisy recordings flip twice on holdout (C15-K4 extra review, C19-K4 alarm instead of review). Clean vs noisy agreement on holdout is 8/10 (target 90%).
4. **Holdout has no disclosure case** (D07, C12, C18 are all in dev): disclosure recall is shown on dev only.
5. **Evidence overlap on dev 17/19 (89%)**, just under the 90% target; holdout 9/9.
6. **`decide.ts` has no `reason_de`:** German reasons on the Tuning page only come from the server (stretch).
7. **Trigger API image** `ghcr.io/outcept/inventx-case-study` is not publicly pullable; compose builds it from the case repo.

Closed: review threshold chosen (B28, D11); ASR measured and chosen (B15, D19); GPU size sufficient (B14/B15); contract gaps (quotes snapped to exact substrings in B20, API built in B24/B25); LLM run time measured and request deadline added (B18); keyword hints in the prompts: not changed after the freeze (prompts frozen for B29); `.env` uses k = 5.

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
| B27 Fixture export | done | (this commit) | `scripts/export_fixtures.py` writes the real API responses (66 files, 60 calls, holdout eval) into `frontend/src/fixtures-real/`, not `src/fixtures/` (the hand-made files are the expected values of the API contract tests). Frontend switch and the 5 relaxed checker rules done in F-real (below). Fixed on the way: a needs_human review now always carries an open question (verdicts unchanged, 60/60) |
| B28 Threshold tuning on dev | done | (this commit) | Review 30 / alarm 70 saved as thresholds version 4 (via PUT /config/thresholds, audit logged), all 60 decisions re-decided on it. Recall 1.00 holds 10–50 on dev; 30 keeps a two-vote margin (DECISIONS D11) |
| B29 Holdout run | done | (this commit) | Once, frozen (check prompts a8ee57dbcc41, thresholds v4, large-v3, k=5, reasoning off): 20 holdout recordings P 0.91 R 1.00, exact 18/20, Stufe2 pairs 3/3, Stufe3 review 1/2 (C19-K4 alarm, caught), clean/noisy 8/10, evidence overlap 9/9, family 10/10; keyword-only P 0.67 R 0.40. Extra flag: C15-K4 (review). Nothing tuned afterwards. `data/eval/eval-20261010-073258-holdout-asr.json` |
| B30 Hidden test set dry run | done | (this commit) | Isolated DATA_DIR, 6 dev recordings renamed to random names, via POST /pipeline/process-folder + GET /pipeline/export (JSON + CSV): 6/6 verdict, family and score identical to the original names, 0 new LLM requests (no prompt contains a name), level/variant/dialogue null, notes.txt rejected. Static check: names are parsed only in `display_fields()` (display) |
| B31 Robustness pass | done | (this commit) | Trigger API killed mid-run: calls still done, failed post recorded ("Connection refused"), re-run `--from notify` delivers it. Bad LLM key (empty cache): all checks failed → review "A check could not complete. Needs a human.", roles fall back, key never stored. Corrupt / empty WAV: rejected (process-folder) or failed (watcher) with a plain message, watcher keeps running. Fixed: empty file no longer blocks the watcher 60 s |
| B32 Freeze | todo | – | Sat 22:00 |
| B33 Pitch material | done | (this commit) | `docs/pitch/`: three slides (architecture, operating concept, detection quality with holdout vs dev vs keyword-only precision/recall; HTML, PNG, PDF), timed demo script with readiness check and the `demo_call.wav` drop (D42), Q&A sheet with the B29 numbers |
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
| R12b Advisor fairness | done | (this commit) | `raised_by` (advisor / customer / unclear) from the trigger evidence's speaker role on call list and detail; `/advisors` splits alarms and reviews into advisor- vs customer-raised; Advisors view highlights only advisor-raised alarms or 2+ reviews, customer-raised ones in a muted *Customer requests* column; call view shows *Raised by: …*. No prompt, threshold or verdict change (D43). Real DB: 27 of 35 flagged calls customer-raised, highlighted advisors 14 → 4 |
| R11b Safe suggestion | done | (this commit) | `/scores/suggestion` only suggests pairs that keep recall on the latest dev eval run (its PR curve) and make no feedback error worse; otherwise *No safe suggestion: every change would miss real cases.* No dev run → no suggestion. New `dev_recall` field, shown on the Tuning card. Tests: single false alarm on C09, holdout never read, no dev run, score-100 call (D44) |
| F-real Real fixture fallback | done | (this commit) | Fixture mode loads `src/fixtures-real/` (git-ignored real export) when all six base files exist, else the hand-made `src/fixtures/`; tests and `npm run check:fixtures` keep using `src/fixtures/`, `npm run check:fixtures-real` checks the export. Checker relaxed for real data: keyword hits may belong to the `numbers` helper; no phrase-in-segment check (Swiss German variants, partial words); zero-length segments and equal starts allowed; a needs_human/failed review may name its own family instead of the top-scoring one; eval confusion compared with the call list only when the run covers every call (real export holds the holdout run, 20 of 60). Tried in Chromium: 60 calls, Advisors split, Simulate a new recording (becomes `Stufe2_C09-K4-1`, since K4 exists) |
| F-alert Wording "alert" | done | (this commit) | Visible labels say alert (chip, buttons, tiles, slider, toasts, Advisors, Quality, Settings, twin box, suggestion sentences, Outcept trigger title); the verdict value `alarm` is unchanged in API, DB and decision rule (D45). Demo script, Q&A, slides (HTML, PNG, PDF re-rendered), BRIEFING, README and frontend guidelines updated |
| Quality: holdout read-only | done | `b888fe6` | B29 holdout run shown read-only (`GET /eval/latest?split=holdout`) next to the latest Dev run; new runs from the UI are Dev only (replaces `a227339`'s note) |
| R11 Suggest from feedback (stretch) | done | `b888fe6` | `GET /api/scores/suggestion` (contract updated, 7 tests): re-decides labelled calls with `decide.py` over a 5-step grid, fewest misses first. Tuning card with the effect; **Use suggestion** only moves the handles, **Apply thresholds** saves. Judges labelled calls only, so check the live counts before applying. Needs the backend (not in fixture mode) |
| All calls Match column fix | done | `74297fd` | Reason column absorbs the free width and truncates; table fits at 1440 px with evaluation columns (narrower windows scroll inside the panel) |
| Call report print (D30) | done | `71fb8bb` | **Print report** button + print stylesheet, A4 portrait: report header, verdict, reason, open question, evidence, twin note, checks, why-unclear, keyword hits, transcript excerpt (±1 line around evidence). Checked as PDF: C09-K3 2 pages, C17-K3 3 pages |
| Demo readiness check | done | `6ef65bd` | `docs/pitch/demo-script.md`: per step call ID, page, required data, all **verify on real DB** |
