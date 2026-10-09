// API contract between backend and frontend. Mirrors docs/API_CONTRACT.md one to one: change both together.
// Base: 05_BACKEND_STRUCTURE.md section 8 (tables), section 2 (transcript JSON), section 4 (CheckSample).
// Times are ISO 8601 strings in UTC. Durations and offsets are seconds (float). Scores are 0–100 (float).

// ---------- Enums ----------

export type Verdict = 'alarm' | 'review' | 'no_alert'
export type Family = 'trade' | 'splitting' | 'access' | 'disclosure' | 'documentation'
export type HelperFamily = 'numbers'
export type CheckEvent = 'present' | 'absent' | 'undetermined' | 'not_applicable'
/** check_results.event_majority also takes 'failed' when every sample failed. */
export type CheckEventOrFailed = CheckEvent | 'failed'
export type Variant = 'clean' | 'noisy'
export type Level = 1 | 2 | 3
export type CallStatus = 'queued' | 'transcribing' | 'checking' | 'done' | 'failed' | 'waiting_for_asr'
export type SpeakerRole = 'advisor' | 'customer' | 'unknown'
export type EvidenceRole = 'context' | 'trigger' | 'exclusion'
export type KeywordLabel = 'relevant' | 'benign'
export type FeedbackLabel = 'correct' | 'false_alarm' | 'missed' | 'escalated_to_alarm' | 'closed_no_alert'
/** Invented: number types listed on the Rules page of Klartext.html. */
export type NumberKind =
  | 'login_code'
  | 'account_number'
  | 'amount'
  | 'date'
  | 'phone_number'
  | 'reference'
  | 'unknown'
export type PipelineStage =
  | 'queued'
  | 'transcribing'
  | 'diarizing'
  | 'checking'
  | 'deciding'
  | 'done'
  | 'failed'
  | 'waiting_for_asr'
export type EvalSplit = 'dev' | 'holdout' | 'all'

// ---------- Calls ----------

/** One row of GET /api/calls, also embedded in the call detail. calls table + flattened decision. */
export interface CallSummary {
  call_id: string // recording ID = file stem, e.g. Stufe2_C09-K3
  file_name: string // e.g. Stufe2_C09-K3.wav (file_path without directories)
  dialogue_id: string | null // Stufe2_C09; null for unknown file names
  variant: Variant | null // K1/K3 clean, K2/K4 noisy; null for unknown file names
  level: Level | null
  duration_s: number | null
  advisor_name: string | null
  status: CallStatus
  error: string | null
  created_at: string
  processed_at: string | null
  // From decisions; all null until the call is decided.
  verdict: Verdict | null
  family: Family | null
  score: number | null
  reason: string | null
  open_question: string | null
  // Invented convenience fields for list rows.
  feedback_label: FeedbackLabel | null // latest feedback, if any
  trigger_sent: boolean // at least one triggers_sent row with a 2xx status
  expected_verdict: Verdict | null // ground truth by dialogue_id; null when unknown
}

/** Invented: unfiltered counts for the sidebar and Inbox header. */
export interface CallCounts {
  total: number
  done: number
  flagged: number // alarm + review
  alarm: number
  review: number
  no_alert: number
  checked_today: number
}

export interface CallListResponse {
  items: CallSummary[]
  counts: CallCounts
}

export interface Decision {
  verdict: Verdict
  family: Family | null
  score: number | null
  reason: string | null
  reason_de: string | null // invented column: reason_de of the decided family
  open_question: string | null
  asr_uncertain: boolean
  thresholds_version_id: number | null
  decided_at: string
}

export interface CheckResult {
  family: Family
  score: number | null // null when failed
  event_majority: CheckEventOrFailed
  agreement: number | null // share of valid samples with the majority event, 0–1
  samples: number // invented: number of valid samples (agreement × samples = runs that agree)
  needs_human_votes: number
  open_question: string | null
  reason: string | null
  reason_de: string | null
  benign_explanation: string | null
  uncertainty_note: string | null // invented: why the runs disagree, shown when agreement < 1 or undetermined
}

/** Invented: output of the numbers helper (section 4 names it but defines no schema). */
export interface NumberObject {
  seg_id: string
  start_s: number
  end_s: number
  digits: string // normalised, e.g. "836194"
  kind: NumberKind
  label: string // display text, e.g. "Login code"
}

export interface NumbersHelper {
  objects: NumberObject[]
  agreement: number | null
  samples: number
}

export interface Evidence {
  id: number
  family: Family
  seg_id: string
  role: EvidenceRole
  start_s: number
  end_s: number
  speaker_role: SpeakerRole | null
  quote: string
  note: string | null // invented: one-line explanation per evidence item (needs a `note` field in CheckSample evidence)
  snippet_url: string | null // /api/calls/{id}/snippets/{seg_id}; replaces snippet_path, which is never exposed
}

export interface KeywordHit {
  keyword_id: string
  family: Family
  phrase: string
  seg_id: string
  start_s: number
  end_s: number
  label: KeywordLabel | null // majority of keyword_judgements for that hit; null if no check judged it
}

export interface Segment {
  seg_id: string
  start_s: number
  end_s: number
  role: SpeakerRole | null
  text: string
  low_confidence: boolean
}

/** Expanded from decisions.twin_call_id + twin_note. */
export interface Twin {
  call_id: string
  dialogue_id: string | null
  variant: Variant | null
  verdict: Verdict
  note: string
}

export interface Feedback {
  id: number
  call_id: string
  label: FeedbackLabel
  note: string | null
  created_at: string
}

export interface TriggerSent {
  id: number
  call_id: string
  remote_id: string | null
  url: string
  status_code: number | null
  created_at: string
}

/** GET /api/calls/{id} */
export interface CallDetail {
  call: CallSummary
  decision: Decision | null
  checks: CheckResult[] // one per verdict family, fixed order trade, splitting, access, disclosure, documentation
  numbers: NumbersHelper | null
  evidence: Evidence[] // decided family only, sorted by start_s
  keyword_hits: KeywordHit[]
  segments: Segment[]
  twin: Twin | null
  feedback: Feedback[]
  triggers: TriggerSent[]
}

export interface FeedbackRequest {
  label: FeedbackLabel
  note?: string | null
}

export interface RecheckResponse {
  call_id: string
  status: CallStatus
}

// ---------- Scores (client-side tuning) ----------

export interface FamilyScore {
  family: Family
  score: number | null
  needs_human_votes: number
  failed: boolean
}

export interface CallScores {
  call_id: string
  dialogue_id: string | null
  variant: Variant | null
  level: Level | null
  verdict: Verdict | null // as decided by the server with the active thresholds
  asr_uncertain: boolean
  expected_verdict: Verdict | null
  families: FamilyScore[]
}

/** GET /api/scores */
export interface ScoresResponse {
  thresholds: ThresholdsConfig
  samples_per_check: number // k
  enabled_families: Family[]
  calls: CallScores[]
}

// ---------- Config ----------

export interface Thresholds {
  review: number
  alarm: number
}

export interface ThresholdsConfig extends Thresholds {
  version_id: number
  note: string | null
  created_at: string
}

export interface ThresholdsUpdate extends Thresholds {
  note?: string | null
}

/** One entry of the families config, as seeded by backend/app/db/init.py. */
export interface FamilyConfig {
  enabled: boolean
  helper: boolean
  label_de: string | null
  task: string | null
  keyword_ids: string[]
  rule: string
  harmless: string
  changed_at: string | null // invented: Rules page shows "Last changed … · Compliance officer"
  changed_by: string | null // invented
}

export interface FamiliesConfig {
  version_id: number
  note: string | null
  created_at: string
  families: Record<Family | HelperFamily, FamilyConfig>
}

export interface FamiliesUpdate {
  families: Record<Family | HelperFamily, FamilyConfig>
  note?: string | null
}

/** To confirm against case-data/Stichwortliste.json (not in this checkout). Fields the UI needs. */
export interface KeywordEntry {
  id: string // K01 …
  label: string
  family: Family
  de: string[]
  gsw: string[]
  harmless: string | null
  enabled: boolean // invented if the list has no on/off flag; default true
  [extra: string]: unknown // anything else in Stichwortliste.json is passed through unchanged
}

export interface KeywordList {
  families: Record<string, { label: string; task?: string; keywords: string[] }>
  keywords: KeywordEntry[]
  policy_examples: Record<string, string>
  [extra: string]: unknown
}

export interface KeywordsConfig {
  version_id: number
  note: string | null
  created_at: string
  keywords: KeywordList
}

export interface KeywordsUpdate {
  keywords: KeywordList
  note?: string | null
}

export interface KeywordSuggestRequest {
  keyword_id: string
}

export interface KeywordSuggestResponse {
  keyword_id: string
  suggestions: string[] // Swiss German variants, not yet in the list
}

export interface RescanChangedCall {
  call_id: string
  hits_before: number
  hits_after: number
}

/** POST /api/keywords/rescan */
export interface RescanResponse {
  config_version_id: number
  before: number // total keyword hits before
  after: number // total keyword hits after
  changed_calls: RescanChangedCall[]
  keyword_only_flagged: { before: number; after: number } // invented: keyword-only baseline call count
}

// ---------- Evaluation ----------

export interface BinaryMetrics {
  tp: number
  fp: number
  fn: number
  tn: number
  precision: number
  recall: number
  f1: number
}

export interface BreakdownRow {
  group: 'level' | 'family' | 'variant'
  key: string // "1" | "access" | "clean" …
  calls: number
  cases: number // expected alarm or review
  recall: number | null
  precision: number | null
  note: string | null
}

export interface PairResult {
  pair: [string, string] // dialogue ids, fraud side first
  family: Family
  fraud_side: Verdict | null // Klartext verdict on clean audio
  harmless_side: Verdict | null
  both_right: boolean
}

export interface Mismatch {
  call_id: string
  expected: Verdict
  predicted: Verdict
  caught: boolean // expected alarm, predicted review: counts as caught
  reason: string | null // Klartext's decision reason
}

export interface EvalMetrics {
  n_calls: number
  binary: BinaryMetrics // flagged = alarm|review, positive = expected alarm|review
  exact: { correct: number; total: number; accuracy: number }
  confusion: { labels: Verdict[]; matrix: number[][] } // rows expected, columns Klartext, order of labels
  breakdown: BreakdownRow[]
  stufe2_pairs: PairResult[]
  stufe3_review: { reviewed: number; total: number }
  clean_noisy_agreement: { agree: number; total: number } // per script
  evidence_overlap: { hit: number; measurable: number; alarms: number } | null // null until B23
  family_accuracy: { correct: number; total: number }
  pr_curve: { t_review: number; precision: number; recall: number }[]
  keyword_baseline: BinaryMetrics & { flagged: number }
  mismatches: Mismatch[]
}

/** GET /api/eval/latest, POST /api/eval/run */
export interface EvalRun {
  run_id: string // e.g. eval-0412
  split: EvalSplit
  source: 'asr' | 'script'
  created_at: string
  config_versions: ConfigVersionIds
  metrics: EvalMetrics
}

export interface EvalRunRequest {
  split: EvalSplit
}

// ---------- Pipeline ----------

export interface PipelineItem {
  call_id: string
  file_name: string
  stage: PipelineStage
  progress: number | null // 0–1
  progress_note: string | null // e.g. "4 of 6 checks"
  duration_s: number | null // audio length
  elapsed_s: number | null // processing time so far
  verdict: Verdict | null
  score: number | null
  trigger_sent: boolean
  error: string | null
  updated_at: string
}

/** GET /api/pipeline/status, also the data of the SSE event pipeline_status. */
export interface PipelineStatus {
  watching: boolean
  inbox_dir: string
  poll_interval_s: number
  last_file_at: string | null
  queue: PipelineItem[] // not done yet, plus failed
  recent: PipelineItem[] // last 20 finished, newest first
  last_batch: { files: number; failed: number; duration_s: number; finished_at: string } | null
}

export interface ProcessFolderRequest {
  path: string
}

export interface ProcessFolderResponse {
  path: string
  enqueued: number
  skipped_duplicates: number
  rejected: { file_name: string; error: string }[]
}

/** One row of GET /api/pipeline/export?format=json. CSV has the same columns, evidence as "start-end;…". */
export interface ExportRow {
  call_id: string
  file_name: string
  verdict: Verdict | null
  family: Family | null
  score: number | null
  reason: string | null
  open_question: string | null
  evidence: { role: EvidenceRole; start_s: number; end_s: number }[]
}

/** Data of the SSE event call_updated. */
export interface CallUpdatedEvent {
  call_id: string
  status: CallStatus
  verdict: Verdict | null
}

// ---------- Settings, advisors ----------

export interface ConfigVersionIds {
  keywords: number | null
  families: number | null
  thresholds: number | null
  model: number | null
}

/** GET /api/settings. Read-only. Never contains the API key. */
export interface SettingsResponse {
  llm_model: string
  llm_base_url: string
  asr_model: string
  trigger_api_url: string
  trigger_api_enabled: boolean
  config_versions: ConfigVersionIds
}

/** GET /api/advisors (stretch). */
export interface AdvisorRow {
  advisor_name: string
  calls: number
  alarm: number
  review: number
  no_alert: number
  families: Family[]
}

/** Error body for every non-2xx response (FastAPI default). */
export interface ApiError {
  detail: string
}
