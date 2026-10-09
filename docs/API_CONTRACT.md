# API contract: Klartext

Response bodies for every endpoint in `05_BACKEND_STRUCTURE.md` section 9. The backend implements exactly this; the frontend types in `frontend/src/lib/types.ts` mirror it one to one. Change both together.

Base: section 8 tables, the transcript JSON (section 2) and `CheckSample` (section 4). Where those did not cover what the designs in `Klartext.html` show, a field was invented. Every invented field is listed in **Invented** below and marked *(invented)* where it appears.

## Conventions

- Prefix `/api`. JSON in and out, UTF-8. Backend binds to `127.0.0.1`.
- Times: ISO 8601 in UTC with `Z` (`"2026-10-10T08:42:00Z"`). The UI shows them in Europe/Zurich.
- Offsets and durations: seconds as float (`101.0`). Scores: 0–100 as float; the UI rounds.
- Recording ID (`call_id`) = file stem, e.g. `Stufe2_C09-K3`. `dialogue_id` = `Stufe2_C09`, `variant` = `clean` (K1/K3) or `noisy` (K2/K4), `level` = 1/2/3. For unknown file names all three are `null`; the UI then shows the file stem and no Clean/Noisy chip.
- Enum values: verdict `alarm | review | no_alert`; family `trade | splitting | access | disclosure | documentation` (helper `numbers`); event `present | absent | undetermined | not_applicable` (plus `failed` in results); evidence role `context | trigger | exclusion`; speaker role `advisor | customer | unknown`.
- Defaults: thresholds review 30, alarm 70; k = 3 samples per check.
- Errors: any non-2xx returns FastAPI's `{"detail": "…"}`. 404 for an unknown call, 422 for invalid input.
- Paths on disk (`file_path`, `snippet_path`) are never returned. Audio is reached only through the audio and snippet endpoints.

## Invented

These go beyond sections 2, 4 and 8. Review them before implementing.

| Where | Field | Why |
|---|---|---|
| `CallSummary` | `file_name` | Pipeline page shows file names; `file_path` without directories |
| `CallSummary` | `feedback_label`, `trigger_sent`, `expected_verdict` | Inbox status icons, All calls expected/match columns. `expected_verdict` comes from ground truth by `dialogue_id`, `null` when unknown; the UI shows it only in evaluation mode |
| `GET /calls` | `counts` | Sidebar and Inbox header need unfiltered counts |
| `Decision` | `reason_de` | English/Deutsch toggle in the call header. Copy of the decided family's `reason_de` (not a column in `decisions` today) |
| `CheckResult` | `samples` | Number of valid samples, so the UI can say "2 of 3 runs agree" |
| `CheckResult` | `uncertainty_note` | "Why the access check is unclear" panel (C17 design). Set when agreement < 1 or the event is undetermined; may be `null` |
| `numbers` | whole object | Section 4 names the numbers helper but has no output schema. Kinds from the Rules page: `login_code, account_number, amount, date, phone_number, reference, unknown` |
| `Evidence` | `note` | Evidence cards show one explanatory line per passage. Needs a `note` field on each `CheckSample.evidence` item |
| `Evidence` | `snippet_url` | Replaces `snippet_path` |
| `KeywordHit` | `label` | Majority of `keyword_judgements` for that hit, `null` if no sample judged it |
| `twin` | expanded object | `decisions.twin_call_id` + `twin_note`, plus the twin's verdict and variant. For a review call the twin is "the closest call" (C17 design); the UI picks the wording |
| Families config | `changed_at`, `changed_by` | Rules page shows "Last changed 8 Oct, 16:40 · Compliance officer" per family |
| Keywords config | `KeywordEntry` fields | **To confirm against `case-data/Stichwortliste.json`**, which is not in this checkout. The UI needs per keyword: `id, label, family, de[], gsw[], harmless, enabled`. Unknown fields pass through unchanged |
| `POST /keywords/rescan` | `keyword_only_flagged`, `config_version_id` | Rules page compares the keyword-only filter with Klartext |
| `POST /calls/{id}/recheck` | async 202 | Re-checking takes seconds. Progress arrives over SSE |
| Eval metrics | shape of `metrics` | Section 10 lists the metrics, not their JSON |
| Pipeline status | whole object | Not specified. Stages from `02_APP_FLOW.md` screen 7 |

**Design scores vs formula.** With k = 3 and section 4's formula, a family score can only be 0, 16.7, 33.3, 50, 66.7, 83.3 or 100. The designs show 91, 58, 12, 4 and so on. The fixtures copy the design values. Either the backend formula stays as it is (and real scores are coarser), or samples gain a confidence value. Undecided.

**Not in section 9, shown in the designs:** "Pause watching" (Pipeline), "Retry" on a failed file, "View history" of config versions, "Download report" (Quality). There are no endpoints for these yet.

---

## Calls

### `GET /calls`

Query: `verdict`, `family`, `level`, `variant` (comma-separated lists), `q` (call ID, advisor name or transcript text), `flagged_only` (`true` = alarm or review). Items are sorted by verdict (alarm, review, no_alert, undecided), then by score, highest first. No pagination; the case has 60 calls.

```json
{
  "items": [
    {
      "call_id": "Stufe2_C09-K3",
      "file_name": "Stufe2_C09-K3.wav",
      "dialogue_id": "Stufe2_C09",
      "variant": "clean",
      "level": 2,
      "duration_s": 192.0,
      "advisor_name": "Advisor 04",
      "status": "done",
      "error": null,
      "created_at": "2026-10-10T08:42:00Z",
      "processed_at": "2026-10-10T08:42:00Z",
      "verdict": "alarm",
      "family": "access",
      "score": 91,
      "reason": "Customer reads a live six-digit login code to the advisor. She had started the login herself a minute earlier, so the code was valid and gives access to her account.",
      "open_question": null,
      "feedback_label": null,
      "trigger_sent": true,
      "expected_verdict": "alarm"
    }
  ],
  "counts": { "total": 3, "done": 3, "flagged": 2, "alarm": 1, "review": 1, "no_alert": 1, "checked_today": 3 }
}
```

`counts` ignores the filters. `verdict, family, score, reason, open_question` are `null` until the call is decided.

### `GET /calls/{id}`

The full detail. Full examples: `frontend/src/fixtures/call_detail_*.json`. Shortened here:

```json
{
  "call": { "...": "same object as one item of GET /calls" },
  "decision": {
    "verdict": "review",
    "family": "access",
    "score": 58,
    "reason": "Customer reads six digits from a bank letter to the advisor. The call never says when the letter arrived, so it is unclear whether the code still worked.",
    "reason_de": "Die Kundin liest der Beratung sechs Ziffern aus einem Brief der Bank vor. …",
    "open_question": "Was the code still valid when it was read out?",
    "asr_uncertain": false,
    "thresholds_version_id": 3,
    "decided_at": "2026-10-10T07:40:00Z"
  },
  "checks": [
    {
      "family": "access",
      "score": 58,
      "event_majority": "undetermined",
      "agreement": 0.6666666666666666,
      "samples": 3,
      "needs_human_votes": 2,
      "open_question": "Was the code still valid when it was read out?",
      "reason": "Customer reads six digits from a bank letter to the advisor. …",
      "reason_de": "Die Kundin liest …",
      "benign_explanation": "The letter may be old, and codes on bank letters expire after a set time. Then the digits give no access.",
      "uncertainty_note": "Two runs found a code read out with no sign it had expired. One run treated the old letter as an expired code. …"
    }
  ],
  "numbers": {
    "objects": [
      { "seg_id": "S008", "start_s": 125.0, "end_s": 132.0, "digits": "291508", "kind": "login_code", "label": "Code, source unknown" }
    ],
    "agreement": 0.6666666666666666,
    "samples": 3
  },
  "evidence": [
    {
      "id": 3,
      "family": "access",
      "seg_id": "S008",
      "role": "trigger",
      "start_s": 125.0,
      "end_s": 132.0,
      "speaker_role": "customer",
      "quote": "Zwei, neun, eins, fünf, null, acht.",
      "note": "Would support Access code shared if the code was still valid. The call does not settle that.",
      "snippet_url": "/api/calls/Stufe3_C17-K3/snippets/S008"
    }
  ],
  "keyword_hits": [
    { "keyword_id": "K07", "family": "access", "phrase": "Code vorlesen", "seg_id": "S009", "start_s": 96.0, "end_s": 97.2, "label": "relevant" }
  ],
  "segments": [
    { "seg_id": "S001", "start_s": 3.0, "end_s": 14.4, "role": "advisor", "text": "Grüezi, Kundenberatung. Was kann ich für Sie tun?", "low_confidence": false }
  ],
  "twin": {
    "call_id": "Stufe2_C10-K3",
    "dialogue_id": "Stufe2_C10",
    "variant": "clean",
    "verdict": "no_alert",
    "note": "The closest call is Stufe2_C10, where the customer reads an expired sample from the manual. Here the source is a real letter, so Klartext does not rule it out."
  },
  "feedback": [],
  "triggers": [
    { "id": 2, "call_id": "Stufe3_C17-K3", "remote_id": "trg_0002", "url": "http://localhost:5173/calls/Stufe3_C17-K3?t=115", "status_code": 201, "created_at": "2026-10-10T07:41:00Z" }
  ]
}
```

Rules:
- `decision` is `null` until decided. Its `verdict, family, score, reason, open_question` equal the same fields in `call`.
- `checks` always has the five verdict families in the order `trade, splitting, access, disclosure, documentation`. A family that failed has `score: null`, `agreement: null`, `event_majority: "failed"`. A `not_applicable` family has `score: 0`, which the UI shows as "–".
- `decision.score` and `decision.family` are the maximum `checks[].score` and its family (section 5).
- `evidence` holds only the decided family, sorted by `start_s`. `start_s`/`end_s` lie within the segment, and `quote` is a substring of the segment text. Every alarm or review has at least one `trigger`. A no-alert call may carry `exclusion` items.
- `numbers` is `null` if the helper did not run.
- `segments` come from the transcript JSON without `speaker`, `words` or ASR probabilities.
- `triggers[].url` is `{PUBLIC_BASE_URL}/calls/{call_id}?t={max(0, floor(trigger start − 10))}`.

### `GET /calls/{id}/audio`

`audio/wav`, the full recording, with HTTP `Range` support (`206 Partial Content`). No JSON.

### `GET /calls/{id}/snippets/{seg_id}`

`audio/wav`, the snippet cut with ±10 s padding (section 6). 404 if there is no snippet for that segment.

### `POST /calls/{id}/feedback`

Request: `{ "label": "false_alarm", "note": "Code was a demo value from training." }`. `label` ∈ `correct, false_alarm, missed, escalated_to_alarm, closed_no_alert`. `note` is optional, max 2000 characters. Always writes an `audit_log` row.

Response `201`:

```json
{ "id": 7, "call_id": "Stufe2_C09-K3", "label": "false_alarm", "note": "Code was a demo value from training.", "created_at": "2026-10-10T09:02:11Z" }
```

### `POST /calls/{id}/recheck`

No body. Re-runs the checks and the decision in the background. Response `202`:

```json
{ "call_id": "Stufe2_C09-K3", "status": "checking" }
```

Progress and the result arrive as `call_updated` events.

## Scores

### `GET /scores`

Feeds client-side re-decision on the Tuning page (`lib/decide.ts` mirrors section 5). One entry per decided call.

```json
{
  "thresholds": { "review": 30, "alarm": 70, "version_id": 3, "note": "Default thresholds", "created_at": "2026-10-09T20:00:00Z" },
  "samples_per_check": 3,
  "enabled_families": ["trade", "splitting", "access", "disclosure", "documentation"],
  "calls": [
    {
      "call_id": "Stufe3_C17-K3",
      "dialogue_id": "Stufe3_C17",
      "variant": "clean",
      "level": 3,
      "verdict": "review",
      "asr_uncertain": false,
      "expected_verdict": "review",
      "families": [
        { "family": "trade", "score": 3, "needs_human_votes": 0, "failed": false },
        { "family": "splitting", "score": 2, "needs_human_votes": 0, "failed": false },
        { "family": "access", "score": 58, "needs_human_votes": 2, "failed": false },
        { "family": "disclosure", "score": 6, "needs_human_votes": 0, "failed": false },
        { "family": "documentation", "score": 0, "needs_human_votes": 0, "failed": false }
      ]
    }
  ]
}
```

`families` lists every family that was checked. The client applies `enabled_families` itself.

## Config

Every `PUT` writes a new `config_versions` row, makes it active and writes an `audit_log` row. Request bodies may carry an optional `note`.

### `GET /config/thresholds`, `PUT /config/thresholds`

PUT body: `{ "review": 40, "alarm": 70, "note": "Recall first for the demo" }`. Requires `0 ≤ review ≤ alarm ≤ 100` (otherwise 422). Response for both:

```json
{ "version_id": 13, "review": 40, "alarm": 70, "note": "Recall first for the demo", "created_at": "2026-10-10T16:02:00Z" }
```

### `GET /config/families`, `PUT /config/families`

`families` is the config as seeded by `backend/app/db/init.py`, keyed by family, including the `numbers` helper. PUT body: `{ "families": { … }, "note": "…" }`. Response for both:

```json
{
  "version_id": 13,
  "note": "Access rule: mention codes on letters",
  "created_at": "2026-10-10T16:02:00Z",
  "families": {
    "access": {
      "enabled": true,
      "helper": false,
      "label_de": "Zugangsdaten weitergegeben",
      "task": "…",
      "keyword_ids": ["K07", "K08"],
      "rule": "A valid login code, one-time password or PIN is read out to anyone, including bank staff.",
      "harmless": "Expired sample codes from a manual, parcel tracking numbers.",
      "changed_at": "2026-10-09T09:05:00Z",
      "changed_by": "Compliance officer"
    }
  }
}
```

The other four verdict families and `numbers` have the same shape. The UI never edits `numbers` in the MVP.

### `GET /config/keywords`, `PUT /config/keywords`

`keywords` is the keyword list in the shape of `Stichwortliste.json`, stored and returned as is (see **Invented**: field names to confirm). PUT body: `{ "keywords": { … }, "note": "…" }`. Response for both:

```json
{
  "version_id": 14,
  "note": "Added gsw variant",
  "created_at": "2026-10-10T16:10:00Z",
  "keywords": {
    "families": { "access": { "label": "Zugangsdaten", "task": "…", "keywords": ["K07", "K08"] } },
    "keywords": [
      {
        "id": "K07",
        "label": "Read out the code",
        "family": "access",
        "de": ["Code vorlesen", "sechs Ziffern"],
        "gsw": ["Code vorläse", "sächs Ziffere", "de Code säge"],
        "harmless": "Reading an expired sample code from a manual.",
        "enabled": true
      }
    ],
    "policy_examples": { "access": "…" }
  }
}
```

### `POST /config/keywords/suggest`

Request: `{ "keyword_id": "K07" }`. Calls the open-weight LLM only. Response:

```json
{ "keyword_id": "K07", "suggestions": ["d Zahle vorläse", "de Pin dürgä"] }
```

Suggestions never include phrases already in the list. Nothing is saved until the officer accepts and PUTs the list.

### `POST /keywords/rescan`

No body. Re-runs the keyword stage on all cached transcripts with the active keyword config. Verdicts do not change, because keywords are hints; a recheck is what changes verdicts. Response:

```json
{
  "config_version_id": 14,
  "before": 41,
  "after": 47,
  "changed_calls": [{ "call_id": "Stufe2_C10-K4", "hits_before": 1, "hits_after": 2 }],
  "keyword_only_flagged": { "before": 44, "after": 47 }
}
```

## Evaluation

### `POST /eval/run`

Request: `{ "split": "dev" }` (`dev | holdout | all`). Runs synchronously on cached check results (seconds) and returns the same body as `GET /eval/latest`.

### `GET /eval/latest`

404 if no run exists.

```json
{
  "run_id": "eval-0412",
  "split": "all",
  "source": "asr",
  "created_at": "2026-10-10T20:14:00Z",
  "config_versions": { "keywords": 14, "families": 13, "thresholds": 13, "model": null },
  "metrics": {
    "n_calls": 60,
    "binary": { "tp": 31, "fp": 3, "fn": 1, "tn": 25, "precision": 0.912, "recall": 0.969, "f1": 0.939 },
    "exact": { "correct": 52, "total": 60, "accuracy": 0.867 },
    "confusion": {
      "labels": ["alarm", "review", "no_alert"],
      "matrix": [[20, 4, 0], [0, 7, 1], [0, 3, 25]]
    },
    "breakdown": [
      { "group": "level", "key": "1", "calls": 20, "cases": 12, "recall": 1.0, "precision": 1.0, "note": null },
      { "group": "family", "key": "access", "calls": 12, "cases": 6, "recall": 1.0, "precision": 0.86, "note": null },
      { "group": "variant", "key": "noisy", "calls": 30, "cases": 16, "recall": 0.94, "precision": 0.89, "note": null }
    ],
    "stufe2_pairs": [
      { "pair": ["Stufe2_C09", "Stufe2_C10"], "family": "access", "fraud_side": "alarm", "harmless_side": "no_alert", "both_right": true }
    ],
    "stufe3_review": { "reviewed": 7, "total": 8 },
    "clean_noisy_agreement": { "agree": 26, "total": 30 },
    "evidence_overlap": { "hit": 19, "measurable": 20, "alarms": 20 },
    "family_accuracy": { "correct": 30, "total": 31 },
    "pr_curve": [{ "t_review": 30, "precision": 0.912, "recall": 0.969 }],
    "keyword_baseline": { "tp": 30, "fp": 17, "fn": 2, "tn": 11, "precision": 0.638, "recall": 0.938, "f1": 0.759, "flagged": 47 },
    "mismatches": [
      { "call_id": "Stufe2_C10-K4", "expected": "no_alert", "predicted": "review", "caught": false, "reason": "Six digits read out. Noise covers the word that says the sample is expired." }
    ]
  }
}
```

- The numbers above are illustrative. The ground truth is 24 alarm, 28 no_alert and 8 review recordings.
- `confusion.matrix`: rows are expected, columns are Klartext, in `labels` order. Positive = expected alarm or review. Flagged = Klartext alarm or review.
- `caught` is true when expected alarm or review and predicted alarm or review.
- `evidence_overlap` is `null` until B23. `pr_curve` has one point per `t_review` from 0 to 100.
- `stufe2_pairs` is measured on clean audio, fraud side first. `breakdown.note` may be `null`.
- Family accuracy excludes `numbers` dialogues.

## Pipeline

### `GET /pipeline/status`

Also the payload of the SSE event `pipeline_status`.

```json
{
  "watching": true,
  "inbox_dir": "/data/klartext/inbox",
  "poll_interval_s": 5,
  "last_file_at": "2026-10-10T08:40:00Z",
  "queue": [
    {
      "call_id": "Stufe2_C11-K4",
      "file_name": "Stufe2_C11-K4.wav",
      "stage": "checking",
      "progress": 0.7,
      "progress_note": "4 of 6 checks",
      "duration_s": 322.0,
      "elapsed_s": 41.0,
      "verdict": null,
      "score": null,
      "trigger_sent": false,
      "error": null,
      "updated_at": "2026-10-10T08:44:30Z"
    }
  ],
  "recent": [
    {
      "call_id": "Stufe2_C09-K3",
      "file_name": "Stufe2_C09-K3.wav",
      "stage": "done",
      "progress": 1.0,
      "progress_note": null,
      "duration_s": 192.0,
      "elapsed_s": 74.0,
      "verdict": "alarm",
      "score": 91,
      "trigger_sent": true,
      "error": null,
      "updated_at": "2026-10-10T08:42:00Z"
    }
  ],
  "last_batch": { "files": 60, "failed": 0, "duration_s": 3480.0, "finished_at": "2026-10-10T06:58:00Z" }
}
```

- `stage` ∈ `queued, transcribing, diarizing, checking, deciding, done, failed, waiting_for_asr`.
- `queue` holds everything not yet done, plus failed items. `recent` holds the last 20 finished items, newest first.
- A failed item carries `error` in plain language, for example "Transcription failed for Stufe1_D04. The file is not 16 kHz mono. Convert it and drop it into the inbox again."

### `POST /pipeline/process-folder`

Request: `{ "path": "/data/hidden-test-set" }`. The path must resolve inside an allowed directory (07_SECURITY section 5). Response `202`:

```json
{ "path": "/data/hidden-test-set", "enqueued": 18, "skipped_duplicates": 0, "rejected": [{ "file_name": "notes.txt", "error": "Not an audio file." }] }
```

### `GET /pipeline/export?format=json|csv`

JSON: an array with one row per call. CSV has the same columns, with `evidence` written as `role:start-end;…`.

```json
[
  {
    "call_id": "Stufe2_C09-K3",
    "file_name": "Stufe2_C09-K3.wav",
    "verdict": "alarm",
    "family": "access",
    "score": 91,
    "reason": "Customer reads a live six-digit login code to the advisor. …",
    "open_question": null,
    "evidence": [{ "role": "context", "start_s": 31.0, "end_s": 45.0 }, { "role": "trigger", "start_s": 101.0, "end_s": 108.0 }]
  }
]
```

### `GET /events`

Server-sent events.

```
event: call_updated
data: {"call_id": "Stufe2_C09-K3", "status": "done", "verdict": "alarm"}

event: pipeline_status
data: { …same body as GET /pipeline/status… }
```

`verdict` is `null` until decided. The client refetches the call and the lists on `call_updated`.

## Settings and advisors

### `GET /settings`

Read-only. Never contains the API key.

```json
{
  "llm_model": "qwen/qwen3-235b-a22b-2507",
  "llm_base_url": "https://openrouter.ai/api/v1",
  "asr_model": "flix-swissgerman-full",
  "trigger_api_url": "http://localhost:8080",
  "trigger_api_enabled": true,
  "config_versions": { "keywords": 1, "families": 2, "thresholds": 3, "model": null }
}
```

The model values are examples. `config_versions` holds the active version ID per kind, or `null` if there is none.

### `GET /advisors` (stretch)

```json
[
  { "advisor_name": "Advisor 01", "calls": 12, "alarm": 7, "review": 3, "no_alert": 2, "families": ["access", "trade"] }
]
```
