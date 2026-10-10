# API contract: Klartext

Response bodies for every endpoint in `05_BACKEND_STRUCTURE.md` section 9. The backend implements exactly this; the frontend types in `frontend/src/lib/types.ts` mirror it one to one. Change both together.

Base: section 8 tables, the transcript JSON (section 2) and `CheckSample` (section 4). Agreed changes and fields that are still invented are listed under **Decisions and invented fields** below.

## Conventions

- Prefix `/api`. JSON in and out, UTF-8. Backend binds to `127.0.0.1`.
- Times: ISO 8601 in UTC with `Z` (`"2026-10-10T08:42:00Z"`). The UI shows them in Europe/Zurich.
- Offsets and durations: seconds as float (`101.0`). Scores: 0–100 as float; the UI rounds.
- Recording ID (`call_id`) = file stem, e.g. `Stufe2_C09-K3`. `dialogue_id` = `Stufe2_C09`, `variant` = `clean` (K1/K3) or `noisy` (K2/K4), `level` = 1/2/3. For unknown file names all three are `null`; the UI then shows the file stem and no Clean/Noisy chip.
- Enum values: verdict `alarm | review | no_alert`; family `trade | splitting | access | disclosure | documentation` (helper `numbers`); event `present | absent | undetermined | not_applicable` (plus `failed` in results); evidence role `context | trigger | exclusion`; speaker role `advisor | customer | unknown`.
- Defaults: thresholds review 30, alarm 70 (review threshold to be re-chosen in B28); k = 5 samples per check.
- Errors: any non-2xx returns FastAPI's `{"detail": "…"}`. 404 for an unknown call, 422 for invalid input.
- Paths on disk (`file_path`, `snippet_path`) are never returned. Audio is reached only through the audio and snippet endpoints.

## Decisions and invented fields

Agreed (contract changes beyond sections 2, 4 and 8):

| Where | Field | Decision |
|---|---|---|
| `Evidence` | `note` | One short line on why this passage matters. The backend adds `note` to each `CheckSample.evidence` item |
| `Decision` | `reason_de` | New column on `decisions`: the decided family's `reason_de` (English/Deutsch toggle) |
| Scores | — | Section 4 formula stays. With k = 5, real scores move in steps of 10. The UI accepts any integer 0–100. The fixtures keep the design's illustrative numbers (91, 58, 12) |
| Numbers helper | — | Defined by the backend; not part of this contract yet. The UI does not show it |
| "Why the check is unclear" panel | — | No new field. Built from the check's `open_question`, `benign_explanation` and `agreement` |
| Keyword list | `KeywordList`, `KeywordEntry` | Field names confirmed against `data/Stichwortliste.json` in the case repo (version `example-0.2`) |
| New endpoints | `POST /pipeline/watch`, `POST /calls/{id}/retry`, `GET /calls/{id}/history` | Pause and resume watching, retry a failed call, call history from `audit_log` |
| Download report | — | No endpoint. Stretch: a print stylesheet for the call view (browser print to PDF) |
| `Feedback.label` | `note` | A plain note on a call. Note text required. Does not count as a verdict on the decision |

Still invented, review before implementing:

| Where | Field | Why |
|---|---|---|
| `CallSummary` | `file_name` | Pipeline page shows file names; `file_path` without directories |
| `CallSummary` | `feedback_label`, `trigger_sent`, `expected_verdict` | Inbox status icons and the All calls expected/match columns. `expected_verdict` comes from ground truth by `dialogue_id`, `null` when unknown; the UI shows it only in evaluation mode |
| `GET /calls` | `counts`, query params `advisor` and `since` | Sidebar and Inbox header need unfiltered counts. The filter modal has advisor and date |
| `CheckResult` | `samples` | Number of valid samples, so the UI can say "2 of 3 runs agree" |
| `Evidence` | `snippet_url` | Replaces `snippet_path` |
| `KeywordHit` | `label` | Majority of `keyword_judgements` for that hit, `null` if no sample judged it |
| `twin` | expanded object | `decisions.twin_call_id` + `twin_note`, plus the twin's verdict and variant. For a review call the twin is "the closest call" (C17 design); the UI picks the wording |
| Families config | `changed_at`, `changed_by` | Rules page shows "Last changed 8 Oct, 16:40 · Compliance officer" per family |
| `POST /keywords/rescan` | `keyword_only_flagged`, `config_version_id` | Rules page compares the keyword-only filter with Klartext |
| `POST /calls/{id}/recheck`, `/retry` | async 202 | Both take seconds. Progress arrives over SSE |
| `GET /calls/{id}/history` | `action` values | `decided, feedback, recheck, retry, trigger_sent`; config changes have their own targets |
| Eval metrics | shape of `metrics` | Section 10 lists the metrics, not their JSON |
| Pipeline status | whole object | Not specified. Stages from `02_APP_FLOW.md` screen 7 |
| `POST /pipeline/inbox` | whole endpoint | The Pipeline drop zone (02_APP_FLOW screen 7) copies one file into the inbox folder; section 9 has no endpoint for it |
| `GET /scores/suggestion` | whole endpoint | Tuning page **Suggest from feedback** (R11); `dev_recall` and the recall guard (D44) |
| `GET /advisors` | `last_call_at`, `last_call_id`, query `since` | Advisors page (R12): last call column and the period picker |
| `CallSummary` | `raised_by` | Who raised an alarm or review: `advisor`, `customer` or `unclear`, `null` otherwise. Derived in the API from the speaker roles of the decided family's trigger evidence; no model call, verdicts unchanged (D43) |
| `GET /advisors` | `advisor_alarm`, `advisor_review`, `customer_alarm`, `customer_review` | Advisors page highlights only advisor-raised flags; customer-raised ones are a muted "Customer requests" column (D43) |

Not covered yet: "View history" of config versions (Rules, Settings).

---

## Calls

### `GET /calls`

Query: `verdict`, `family`, `level`, `variant`, `advisor` (comma-separated lists), `since` (ISO time; `processed_at` at or after it), `q` (call ID, advisor name or transcript text), `flagged_only` (`true` = alarm or review). Items are sorted by verdict (alarm, review, no_alert, undecided), then by score, highest first. No pagination; the case has 60 calls.

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
      "expected_verdict": "alarm",
      "raised_by": "customer"
    }
  ],
  "counts": { "total": 3, "done": 3, "flagged": 2, "alarm": 1, "review": 1, "no_alert": 1, "checked_today": 3 }
}
```

`counts` ignores the filters. `verdict, family, score, reason, open_question` are `null` until the call is decided.

`raised_by` (list and detail): who raised an alarm or review, from the `speaker_role` of the trigger evidence in the decided family. Any trigger spoken by the advisor → `advisor`; all triggers spoken by the customer → `customer`; no trigger evidence or an unknown speaker → `unclear`. `null` for no-alert and undecided calls. It is read from stored evidence and never changes the verdict. In the call detail it uses the same evidence as `evidence`.

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
      "benign_explanation": "The letter may be old, and codes on bank letters expire after a set time. Then the digits give no access."
    }
  ],
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
    { "keyword_id": "K10", "family": "access", "phrase": "Bestätigungscode", "seg_id": "S007", "start_s": 112.0, "end_s": 113.2, "label": "relevant" }
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
- Scores are any number 0–100. With k = 5 they come in steps of 10; the UI rounds and accepts any value.
- `checks` always has the five verdict families in the order `trade, splitting, access, disclosure, documentation`. A family that failed has `score: null`, `agreement: null`, `event_majority: "failed"`. A `not_applicable` family has `score: 0`, which the UI shows as "–".
- `decision.score` and `decision.family` are the maximum `checks[].score` and its family (section 5).
- `evidence` holds only the decided family, sorted by `start_s`. `start_s`/`end_s` lie within the segment, and `quote` is a substring of the segment text. Every alarm or review has at least one `trigger`. A no-alert call may carry `exclusion` items.
- The "Why the check is unclear" panel is built from the decided family's `open_question`, `benign_explanation` and `agreement`. No extra field.
- The numbers helper output may be added by the backend later; the UI ignores unknown keys.
- `segments` come from the transcript JSON without `speaker`, `words` or ASR probabilities.
- `triggers[].url` is `{PUBLIC_BASE_URL}/calls/{call_id}?t={max(0, floor(trigger start − 10))}`.

### `GET /calls/{id}/audio`

`audio/wav`, the full recording, with HTTP `Range` support (`206 Partial Content`). No JSON.

### `GET /calls/{id}/snippets/{seg_id}`

`audio/wav`, the snippet cut with ±10 s padding (section 6). 404 if there is no snippet for that segment.

### `POST /calls/{id}/feedback`

Request: `{ "label": "false_alarm", "note": "Code was a demo value from training." }`. `label` ∈ `correct, false_alarm, missed, escalated_to_alarm, closed_no_alert, note`. `note` is optional, max 2000 characters, except for `label: "note"`, where it is required and non-empty (422 otherwise). A `note` is a plain comment: it does not mark the decision right or wrong and does not change the verdict. Always writes an `audit_log` row.

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

### `POST /calls/{id}/retry`

No body. Re-queues a call whose `status` is `failed` and runs it from the first stage. Writes an `audit_log` row. Response `202`:

```json
{ "call_id": "Stufe1_D04-K2", "status": "queued" }
```

409 if the call is not `failed`.

### `GET /calls/{id}/history`

The `audit_log` rows whose `target` is `call:{id}`, newest first. `details` is the parsed `details_json`.

```json
[
  { "id": 31, "actor": "Compliance officer", "action": "feedback", "target": "call:Stufe2_C09-K3", "details": { "label": "correct", "note": null }, "created_at": "2026-10-10T09:02:11Z" },
  { "id": 12, "actor": "system", "action": "trigger_sent", "target": "call:Stufe2_C09-K3", "details": { "remote_id": "trg_0001", "status_code": 201 }, "created_at": "2026-10-10T08:43:00Z" },
  { "id": 11, "actor": "system", "action": "decided", "target": "call:Stufe2_C09-K3", "details": { "verdict": "alarm", "family": "access", "score": 91, "thresholds_version_id": 3 }, "created_at": "2026-10-10T08:42:00Z" }
]
```

`action` ∈ `decided, feedback, recheck, retry, trigger_sent`. Feedback, review actions (`escalated_to_alarm`, `closed_no_alert`) and plain notes (`note`) appear as `feedback` with the label in `details`.

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

### `GET /scores/suggestion` (stretch goal R11)

Thresholds suggested from officer feedback, for the Tuning page's **Suggest from feedback**. Never saves anything: the officer moves the sliders to the suggestion and saves with **Apply thresholds** (`PUT /config/thresholds`).

The latest verdict-type feedback per call counts (`note` is ignored). Each label says what the call should have been: `false_alarm` and `closed_no_alert` = harmless; `missed` = should be flagged; `escalated_to_alarm` = should be alarm; `correct` = the current verdict is right. Every labelled call is re-decided with the decision rule over review and alarm thresholds in steps of 5 (review ≤ alarm), and the pair with the fewest misses is chosen, then the fewest false alarms, extra reviews, unmet escalations and changed confirmed verdicts, then the smallest move from the active thresholds. `suggestion` is `null` when no pair does better than the active one, or when there is no feedback.

Safety (D44): a pair is only suggested if it makes no effect count worse than the active thresholds (no trading a false alarm for an extra review) and keeps recall on the **latest dev evaluation run** at least as high as at the active thresholds. Recall per review threshold is read from that run's `pr_curve` (with review ≤ alarm, whether a call is flagged depends on the review threshold only). Holdout runs are never read. When a pair would fit the feedback better but only by losing that recall, `summary` is *No safe suggestion: every change would miss real cases.* Without a dev run there is no suggestion (`dev_recall: null`, summary asks for a Dev run on the Quality page).

```json
{
  "current": { "review": 30, "alarm": 70 },
  "thresholds_version_id": 4,
  "labelled_calls": 3,
  "labels": { "missed": 1, "correct": 2 },
  "suggestion": { "review": 25, "alarm": 70 },
  "current_effect": { "missed": 1, "false_alarms": 0, "extra_reviews": 0, "unmet_escalations": 0, "changed_confirmed": 0, "flagged": 35 },
  "suggested_effect": { "missed": 0, "false_alarms": 0, "extra_reviews": 0, "unmet_escalations": 0, "changed_confirmed": 0, "flagged": 36 },
  "dev_recall": { "run_id": "eval-20261010-071957-dev-asr", "current": 1.0, "suggested": 1.0 },
  "summary": "Would catch 1 missed call, misses nothing."
}
```

- Effect counts are over the labelled calls, except `flagged`: alarms and reviews among all decided calls at those thresholds.
- `missed`: marked as a real case (missed, escalated, or a correct alarm or review) but no alert. `false_alarms` / `extra_reviews`: marked harmless (false alarm, closed, or a correct no alert) but alarm / review. `unmet_escalations`: escalated but still review. `changed_confirmed`: marked correct and the verdict would change while still caught.
- Uses the active families config (enabled families only) and the server's k, like the server's own decisions.
- `dev_recall`: `run_id` of the latest dev run and its recall at the active (`current`) and suggested review threshold (`suggested`, `null` without a suggestion). A fractional threshold reads the curve point below it.

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
      "label_de": "Zugangsinformation",
      "task": "active_secret_disclosure",
      "keyword_ids": ["K10"],
      "rule": "Actual disclosure of a currently active access secret; mention/refusal/expired value is not disclosure of an active secret.",
      "harmless": "…",
      "changed_at": "2026-10-09T09:05:00Z",
      "changed_by": "Compliance officer"
    }
  }
}
```

The other four verdict families and `numbers` have the same shape. The UI never edits `numbers` in the MVP.

### `GET /config/keywords`, `PUT /config/keywords`

`keywords` is `Stichwortliste.json`, stored and returned unchanged. Confirmed against the case repo, version `example-0.2`. Keywords carry no family: a keyword's family is the key of the `families` entry whose `keywords` list contains its ID (K09 belongs to the `numbers` helper). PUT body: `{ "keywords": { … }, "note": "…" }`. Response for both:

```json
{
  "version_id": 14,
  "note": "Added gsw variant",
  "created_at": "2026-10-10T16:10:00Z",
  "keywords": {
    "version": "example-0.2",
    "status": "provisional_not_official",
    "official_source": "Inventx list not supplied",
    "families": {
      "access": { "label": "Zugangsinformation", "keywords": ["K10"], "task": "active_secret_disclosure" },
      "numbers": { "label": "Zahlenobjekte", "keywords": ["K09"], "task": "object_classification" }
    },
    "keywords": [
      {
        "id": "K10",
        "label": "Zugangswörter",
        "de": ["PIN", "Passwort", "TAN", "Bestätigungscode"],
        "gsw": ["PIN", "Passwort", "TAN", "Bestätigungscode"],
        "harmless": "…",
        "enabled": true,
        "status": "provisional_example",
        "match_unit": "whole_phrase",
        "partial_words_count_as_full_hit": false
      }
    ],
    "alarm_scope": "Defined fictional test behaviors; keyword hits and entity mentions are not themselves legal findings.",
    "policy_examples": { "access": "Actual disclosure of a currently active access secret; …" },
    "corpus_binding": "corpus-3.0; unchanged provisional example-0.2 list"
  }
}
```

Keyword fields: `id`, `label` (German), `de[]`, `gsw[]`, `enabled`, `status`, `match_unit`, `partial_words_count_as_full_hit`; `harmless`, `rules[]` and `case_sensitive` are present on some keywords only (K09–K11 have no `harmless`). The UI edits `de`, `gsw` and `enabled` and keeps every other field as it came.

### `POST /config/keywords/suggest`

Request: `{ "keyword_id": "K10" }`. Calls the open-weight LLM only. Response:

```json
{ "keyword_id": "K10", "suggestions": ["Bestätigungscode vorläse", "de Pin säge"] }
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

Query `split` (optional: `dev | holdout | all`): the newest run of that split. Without it, the newest run of any split. 404 if no such run exists. The Quality page shows the B29 holdout run read-only with `?split=holdout`; new runs from the UI are Dev only.

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

### `POST /pipeline/watch`

Request: `{ "enabled": false }` pauses the inbox watcher, `true` resumes it. Files dropped while paused are picked up on resume. Writes an `audit_log` row. Response:

```json
{ "watching": false }
```

### `POST /pipeline/inbox`

Multipart form, one field `file`: a WAV recording (`audio/wav` or `.wav`), max 200 MB. The backend writes it into `INBOX_DIR` under a safe name (never a path from the client) and the watcher processes it like any other recording. Response `202`:

```json
{ "file_name": "Stufe2_C09-K4.wav", "queued": true, "duplicate": false }
```

A file seen before (same hash) answers `{ "queued": false, "duplicate": true }`. 415 for non-WAV files, 413 when too large; `detail` says what to do ("… is not a WAV file. Convert it to WAV and drop it again.").

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

## Download report

No endpoint. Stretch goal: a print stylesheet for the call view, so the browser's print to PDF gives a one-page report.

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

### `GET /advisors` (stretch goal R12)

Patterns across calls, one row per advisor name from the role labelling (`calls.advisor_name`). Calls without a recognised name are left out. Query: `since` (ISO time; only calls with `processed_at` at or after it, as in `GET /calls`). Sorted by advisor-raised alarms, advisor-raised reviews, alarms, reviews, then calls, most first.

```json
[
  {
    "advisor_name": "Advisor 01",
    "calls": 12,
    "alarm": 7,
    "review": 3,
    "no_alert": 2,
    "advisor_alarm": 2,
    "advisor_review": 1,
    "customer_alarm": 5,
    "customer_review": 2,
    "families": ["trade", "access"],
    "last_call_at": "2026-10-10T08:42:00Z",
    "last_call_id": "Stufe2_C09-K3"
  }
]
```

- `calls` counts every call of the advisor, decided or not; `alarm + review + no_alert` counts the decided ones.
- `advisor_alarm + customer_alarm = alarm` and `advisor_review + customer_review = review`, split by the call's `raised_by`. `unclear` counts as advisor-raised, so nothing is hidden.
- `families`: the families of the advisor's alarms and reviews, in the fixed family order. Empty when there are none.
- `last_call_at`: `processed_at` of the newest call (`created_at` while it is not processed yet); `last_call_id` is that call.
- The UI highlights advisors with an advisor-raised alarm or 2+ advisor-raised reviews in the period, shows customer-raised ones in a muted "Customer requests" column, and links each row to All calls filtered by that advisor (`/calls?advisor=…`).
