// Typed client for the backend API (docs/API_CONTRACT.md). With VITE_USE_FIXTURES=true the read endpoints
// that have fixtures answer from src/fixtures; every other call needs the backend.
import { advisorRows } from './advisors'
import type {
  AdvisorRow,
  CallDetail,
  CallListResponse,
  CallSummary,
  CallCounts,
  CallScores,
  PipelineItem,
  UploadResponse,
  EvalRun,
  EvalRunRequest,
  FamiliesConfig,
  FamiliesUpdate,
  Family,
  Feedback,
  FeedbackRequest,
  HistoryEntry,
  KeywordsConfig,
  KeywordsUpdate,
  KeywordList,
  KeywordSuggestResponse,
  Level,
  PipelineStatus,
  ProcessFolderResponse,
  RecheckResponse,
  RescanResponse,
  RetryResponse,
  ScoresResponse,
  SettingsResponse,
  ThresholdsConfig,
  ThresholdsUpdate,
  Variant,
  Verdict,
  WatchResponse,
  EvalSplit,
  ThresholdSuggestion,
} from './types'

import { emit } from './live'
import { startOfTodayIso } from './format'
import { placeholderWav } from './placeholderAudio'
import callsFixture from '@/fixtures/calls.json'
import scoresFixture from '@/fixtures/scores.json'
import familiesFixture from '@/fixtures/families.json'
import keywordsFixture from '@/fixtures/keywords.json'
import evalFixture from '@/fixtures/eval.json'
import settingsFixture from '@/fixtures/settings.json'

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true'

const detailFixtures = import.meta.glob<CallDetail>('../fixtures/call_detail_*.json', {
  eager: true,
  import: 'default',
})

// Calls added at runtime by the fixture pipeline simulator (see the Pipeline section below).
const simDetails = new Map<string, CallDetail>()
const simScores: CallScores[] = []
const fixtureDetail = (id: string): CallDetail | undefined =>
  simDetails.get(id) ?? detailFixtures[`../fixtures/call_detail_${id}.json`]
const fixtureItems = (): CallSummary[] => [
  ...(callsFixture as unknown as CallListResponse).items,
  ...[...simDetails.values()].map((d) => d.call),
]

function fixtureCounts(items: CallSummary[]): CallCounts {
  const n = (v: string) => items.filter((c) => c.verdict === v).length
  const today = startOfTodayIso()
  return {
    total: items.length,
    done: items.filter((c) => c.status === 'done').length,
    flagged: n('alarm') + n('review'),
    alarm: n('alarm'),
    review: n('review'),
    no_alert: n('no_alert'),
    checked_today: items.filter((c) => c.processed_at && c.processed_at >= today).length,
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const UNREACHABLE = 'The Klartext server is not reachable. Check that the backend is running, then try again.'

/** Turns a failed response into a sentence for the officer; the backend's `detail` wins when there is one. */
async function failure(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null)
  if (typeof body?.detail === 'string') return new ApiError(res.status, body.detail)
  // No JSON body: a gateway or the dev proxy answered because the backend is down.
  if (res.status >= 500) return new ApiError(res.status, UNREACHABLE)
  if (res.status === 404) return new ApiError(404, 'Not found.')
  return new ApiError(res.status, `The server refused the request (${res.status}).`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch {
    throw new ApiError(0, UNREACHABLE)
  }
  if (!res.ok) throw await failure(res)
  return res.json() as Promise<T>
}

const send = <T>(method: 'POST' | 'PUT', path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

// Fixture mode keeps feedback in memory for this tab, so the review flow can be tried without a backend.
const fixtureFeedback = new Map<string, Feedback[]>()
let fixtureFeedbackId = 1

function withFixtureFeedback(c: CallSummary): CallSummary {
  const latest = fixtureFeedback.get(c.call_id)?.at(-1)
  return latest ? { ...c, feedback_label: latest.label } : c
}

function noFixture(what: string): never {
  throw new ApiError(503, `${what} needs the backend. Set VITE_USE_FIXTURES=false and start the API.`)
}

// ---------- Calls ----------

export interface CallFilters {
  verdict?: Verdict[]
  family?: Family[]
  level?: Level[]
  variant?: Variant[]
  advisor?: string[]
  since?: string // ISO time; processed_at at or after it
  q?: string
  flagged_only?: boolean
}

function matches(c: CallSummary, f: CallFilters): boolean {
  if (f.verdict?.length && (!c.verdict || !f.verdict.includes(c.verdict))) return false
  if (f.family?.length && (!c.family || !f.family.includes(c.family))) return false
  if (f.level?.length && (!c.level || !f.level.includes(c.level))) return false
  if (f.variant?.length && (!c.variant || !f.variant.includes(c.variant))) return false
  if (f.advisor?.length && (!c.advisor_name || !f.advisor.includes(c.advisor_name))) return false
  if (f.since && (!c.processed_at || c.processed_at < f.since)) return false
  if (f.flagged_only && c.verdict !== 'alarm' && c.verdict !== 'review') return false
  if (f.q) {
    const q = f.q.toLowerCase()
    const text = [c.call_id, c.advisor_name, c.reason].join(' ').toLowerCase()
    const detail = fixtureDetail(c.call_id)
    const transcript =
      detail?.segments
        .map((s) => s.text)
        .join(' ')
        .toLowerCase() ?? ''
    if (!text.includes(q) && !transcript.includes(q)) return false
  }
  return true
}

function toQuery(f: CallFilters): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    p.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export async function getCalls(filters: CallFilters = {}): Promise<CallListResponse> {
  if (!USE_FIXTURES) return request(`/calls${toQuery(filters)}`)
  const all = fixtureItems()
  return { items: all.filter((c) => matches(c, filters)).map(withFixtureFeedback), counts: fixtureCounts(all) }
}

export async function getCall(callId: string): Promise<CallDetail> {
  if (!USE_FIXTURES) return request(`/calls/${encodeURIComponent(callId)}`)
  const detail = fixtureDetail(callId)
  if (!detail) throw new ApiError(404, `Call ${callId} not found.`)
  const extra = fixtureFeedback.get(callId) ?? []
  return { ...detail, call: withFixtureFeedback(detail.call), feedback: [...detail.feedback, ...extra] }
}

export const audioUrl = (callId: string) => `/api/calls/${encodeURIComponent(callId)}/audio`

const placeholderUrls = new Map<string, string>()

/** Where the player loads the recording. Fixture mode: a generated placeholder of the call's length. */
export function audioSource(detail: CallDetail): string {
  if (!USE_FIXTURES) return audioUrl(detail.call.call_id)
  const id = detail.call.call_id
  let url = placeholderUrls.get(id)
  if (!url) {
    url = URL.createObjectURL(placeholderWav(id, detail.call.duration_s ?? 0, detail.segments))
    placeholderUrls.set(id, url)
  }
  return url
}
export const snippetUrl = (callId: string, segId: string) =>
  `/api/calls/${encodeURIComponent(callId)}/snippets/${encodeURIComponent(segId)}`

export async function postFeedback(callId: string, body: FeedbackRequest): Promise<Feedback> {
  if (!USE_FIXTURES) return send<Feedback>('POST', `/calls/${encodeURIComponent(callId)}/feedback`, body)
  const fb: Feedback = {
    id: fixtureFeedbackId++,
    call_id: callId,
    label: body.label,
    note: body.note ?? null,
    created_at: new Date().toISOString(),
  }
  fixtureFeedback.set(callId, [...(fixtureFeedback.get(callId) ?? []), fb])
  return fb
}

export const recheckCall = (callId: string) =>
  USE_FIXTURES ? noFixture('Recheck') : send<RecheckResponse>('POST', `/calls/${encodeURIComponent(callId)}/recheck`)

export async function retryCall(callId: string): Promise<RetryResponse> {
  if (!USE_FIXTURES) return send<RetryResponse>('POST', `/calls/${encodeURIComponent(callId)}/retry`)
  const item = sim.queue.find((q) => q.call_id === callId && q.stage === 'failed')
  if (!item) throw new ApiError(409, `${callId} has not failed, so there is nothing to retry.`)
  Object.assign(item, {
    stage: 'queued',
    progress: 0,
    progress_note: null,
    error: null,
    elapsed_s: 0,
    updated_at: now(),
  })
  publish()
  runSim()
  return { call_id: callId, status: 'queued' }
}

export const getCallHistory = (callId: string) =>
  USE_FIXTURES ? noFixture('Call history') : request<HistoryEntry[]>(`/calls/${encodeURIComponent(callId)}/history`)

// ---------- Scores ----------

// Fixture mode: "Apply thresholds" keeps a new version in memory for this tab.
let fixtureThresholds: ThresholdsConfig | null = null

export async function getScores(): Promise<ScoresResponse> {
  if (!USE_FIXTURES) return request('/scores')
  const base = scoresFixture as unknown as ScoresResponse
  const enabled = (Object.keys(fixtureFamilies.families) as (Family | 'numbers')[]).filter(
    (f): f is Family => f !== 'numbers' && fixtureFamilies.families[f].enabled,
  )
  return {
    ...base,
    calls: [...base.calls, ...simScores],
    thresholds: fixtureThresholds ?? base.thresholds,
    enabled_families: enabled,
  }
}

// ---------- Config ----------

/** GET /api/scores/suggestion (R11). Needs the backend: it re-decides calls with the server's decision rule. */
export const getThresholdSuggestion = () =>
  USE_FIXTURES ? noFixture('Suggestions from feedback') : request<ThresholdSuggestion>('/scores/suggestion')

export async function getThresholds(): Promise<ThresholdsConfig> {
  if (!USE_FIXTURES) return request<ThresholdsConfig>('/config/thresholds')
  return (await getScores()).thresholds
}

export async function putThresholds(body: ThresholdsUpdate): Promise<ThresholdsConfig> {
  if (!USE_FIXTURES) return send<ThresholdsConfig>('PUT', '/config/thresholds', body)
  const current = await getThresholds()
  fixtureThresholds = {
    review: body.review,
    alarm: body.alarm,
    note: body.note ?? null,
    version_id: current.version_id + 1,
    created_at: new Date().toISOString(),
  }
  return fixtureThresholds
}
// Fixture mode: families and keywords are edited in memory for this tab, versions count up like the API's.
let fixtureFamilies = structuredClone(familiesFixture) as unknown as FamiliesConfig
let fixtureKeywords = structuredClone(keywordsFixture) as unknown as KeywordsConfig

export async function getFamilies(): Promise<FamiliesConfig> {
  if (!USE_FIXTURES) return request<FamiliesConfig>('/config/families')
  return structuredClone(fixtureFamilies)
}

export async function putFamilies(body: FamiliesUpdate): Promise<FamiliesConfig> {
  if (!USE_FIXTURES) return send<FamiliesConfig>('PUT', '/config/families', body)
  const now = new Date().toISOString()
  const families = structuredClone(body.families)
  for (const [f, cfg] of Object.entries(families) as [
    keyof FamiliesConfig['families'],
    FamiliesConfig['families'][Family],
  ][]) {
    const before = fixtureFamilies.families[f]
    const changed = before.enabled !== cfg.enabled || before.rule !== cfg.rule || before.harmless !== cfg.harmless
    if (changed) Object.assign(cfg, { changed_at: now, changed_by: 'Compliance officer' })
  }
  fixtureFamilies = { version_id: nextVersion(), note: body.note ?? null, created_at: now, families }
  return structuredClone(fixtureFamilies)
}

export async function getKeywords(): Promise<KeywordsConfig> {
  if (!USE_FIXTURES) return request<KeywordsConfig>('/config/keywords')
  return structuredClone(fixtureKeywords)
}

export async function putKeywords(body: KeywordsUpdate): Promise<KeywordsConfig> {
  if (!USE_FIXTURES) return send<KeywordsConfig>('PUT', '/config/keywords', body)
  fixtureKeywords = {
    version_id: nextVersion(),
    note: body.note ?? null,
    created_at: new Date().toISOString(),
    keywords: structuredClone(body.keywords),
  }
  return structuredClone(fixtureKeywords)
}

// Config versions share one id sequence in the API (config_versions table); fixtures start after the seeds (1–3).
let fixtureVersion = 3
const nextVersion = () => {
  fixtureVersion = Math.max(fixtureVersion, fixtureThresholds?.version_id ?? 0) + 1
  return fixtureVersion
}

export const suggestKeywordVariants = (keywordId: string) =>
  USE_FIXTURES
    ? noFixture('Suggesting Swiss German variants')
    : send<KeywordSuggestResponse>('POST', '/config/keywords/suggest', { keyword_id: keywordId })

/** Fixture mode stands in for the keyword stage with a plain case-insensitive phrase match over the fixture transcripts. */
function fixtureHits(list: KeywordList): Map<string, number> {
  const hits = new Map<string, number>()
  for (const c of fixtureItems()) {
    const d = fixtureDetail(c.call_id)!
    let n = 0
    for (const kw of list.keywords.filter((k) => k.enabled)) {
      for (const phrase of [...new Set([...kw.de, ...kw.gsw])]) {
        const re = new RegExp(`(^|[^\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu')
        n += d.segments.filter((s) => re.test(s.text)).length
      }
    }
    hits.set(d.call.call_id, n)
  }
  return hits
}
let fixtureLastHits: Map<string, number> | null = null

export async function rescanKeywords(): Promise<RescanResponse> {
  if (!USE_FIXTURES) return send<RescanResponse>('POST', '/keywords/rescan')
  const before = fixtureLastHits ?? fixtureHits((keywordsFixture as unknown as KeywordsConfig).keywords)
  const after = fixtureHits(fixtureKeywords.keywords)
  fixtureLastHits = after
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
  const flagged = (m: Map<string, number>) => [...m.values()].filter((n) => n > 0).length
  return {
    config_version_id: fixtureKeywords.version_id,
    before: sum(before),
    after: sum(after),
    changed_calls: [...after]
      .filter(([id, n]) => (before.get(id) ?? 0) !== n)
      .map(([call_id, n]) => ({ call_id, hits_before: before.get(call_id) ?? 0, hits_after: n })),
    keyword_only_flagged: { before: flagged(before), after: flagged(after) },
  }
}

// ---------- Evaluation, pipeline, settings ----------

export const runEval = (body: EvalRunRequest) =>
  USE_FIXTURES ? noFixture('Running the evaluation') : send<EvalRun>('POST', '/eval/run', body)

/** GET /api/eval/latest, optionally the newest run of one split. Fixture mode has one run and ignores the split. */
export async function getLatestEval(split?: EvalSplit): Promise<EvalRun> {
  if (!USE_FIXTURES) return request<EvalRun>(`/eval/latest${split ? `?split=${split}` : ''}`)
  return evalFixture as unknown as EvalRun
}
// ---------- Pipeline ----------
// Fixture mode simulates the watcher: a file dropped (or a folder processed) walks through the stages, emitting
// pipeline_status on every step and call_updated when it is decided, exactly like GET /api/events will.
// The result is a stored one (the C09 alarm, as if recorded with noise); nothing is transcribed or checked.

const now = () => new Date().toISOString()
const RECORDING = /^(Stufe([123])_[CD]\d{2})-K([1-4])$/
const FAILS_AT_TRANSCRIPTION = /^Stufe1_D04/ // the design's failed example: not 16 kHz mono

function doneItem(c: CallSummary): PipelineItem {
  return {
    call_id: c.call_id,
    file_name: c.file_name,
    stage: 'done',
    progress: 1,
    progress_note: null,
    duration_s: c.duration_s,
    elapsed_s: null,
    verdict: c.verdict,
    score: c.score,
    trigger_sent: c.trigger_sent,
    error: null,
    updated_at: c.processed_at ?? c.created_at,
  }
}

const sim: PipelineStatus = {
  watching: true,
  inbox_dir: '/data/klartext/inbox',
  poll_interval_s: 5,
  last_file_at: null,
  queue: [],
  recent: [...(callsFixture as unknown as CallListResponse).items]
    .sort((a, b) => (b.processed_at ?? '').localeCompare(a.processed_at ?? ''))
    .map(doneItem),
  last_batch: null,
}
sim.last_file_at = sim.recent[0]?.updated_at ?? null

const publish = () => emit({ type: 'pipeline_status', data: structuredClone(sim) })
let simTimer: number | null = null

/** One step for the first unfinished item; reschedules itself until the queue is idle or watching is paused. */
function runSim() {
  if (simTimer !== null || !sim.watching) return
  const item = sim.queue.find((q) => q.stage !== 'failed' && q.stage !== 'done')
  if (!item) return
  const step = () => {
    simTimer = null
    if (!sim.watching) return
    advance(item)
    item.updated_at = now()
    item.elapsed_s = (item.elapsed_s ?? 0) + 0.6
    publish()
    runSim()
  }
  simTimer = window.setTimeout(step, 600)
}

function advance(item: PipelineItem) {
  const p = item.progress ?? 0
  switch (item.stage) {
    case 'queued':
      Object.assign(item, { stage: 'transcribing', progress: 0.2, progress_note: null })
      break
    case 'transcribing':
      if (FAILS_AT_TRANSCRIPTION.test(item.call_id)) {
        const name = RECORDING.exec(item.call_id)?.[1] ?? item.call_id
        Object.assign(item, {
          stage: 'failed',
          progress: null,
          error: `Transcription failed for ${name}. The file is not 16 kHz mono. Convert it and drop it into the inbox again.`,
        })
      } else if (p < 0.8) item.progress = p + 0.3
      else Object.assign(item, { stage: 'diarizing', progress: null })
      break
    case 'diarizing':
      Object.assign(item, { stage: 'checking', progress: 1 / 6, progress_note: '1 of 6 checks' })
      break
    case 'checking': {
      const n = Math.round(p * 6) + 1
      if (n <= 6) Object.assign(item, { progress: n / 6, progress_note: `${n} of 6 checks` })
      else Object.assign(item, { stage: 'deciding', progress: null, progress_note: null })
      break
    }
    case 'deciding':
      finish(item)
      break
  }
}

/** Store the decided call (the C09 result, recorded with noise) and announce it. */
function finish(item: PipelineItem) {
  const base = structuredClone(detailFixtures['../fixtures/call_detail_Stufe2_C09-K3.json'])
  const id = item.call_id
  const m = RECORDING.exec(id)
  const t = now()
  const score = 88
  base.call = {
    ...base.call,
    call_id: id,
    file_name: item.file_name,
    dialogue_id: m ? m[1] : null,
    level: m ? (Number(m[2]) as 1 | 2 | 3) : null,
    variant: m ? (['1', '3'].includes(m[3]) ? 'clean' : 'noisy') : null,
    created_at: t,
    processed_at: t,
    score,
    expected_verdict: m ? base.call.expected_verdict : null,
    feedback_label: null,
  }
  base.decision = { ...base.decision!, score, decided_at: t }
  base.checks = base.checks.map((c) => (c.family === 'access' ? { ...c, score } : c))
  base.evidence = base.evidence.map((e) => ({
    ...e,
    snippet_url: `/api/calls/${encodeURIComponent(id)}/snippets/${e.seg_id}`,
  }))
  base.triggers = [
    { ...base.triggers[0], call_id: id, url: base.triggers[0].url.replace('Stufe2_C09-K3', id), created_at: t },
  ]
  base.twin = null
  simDetails.set(id, base)
  simScores.push({
    call_id: id,
    dialogue_id: base.call.dialogue_id,
    variant: base.call.variant,
    level: base.call.level,
    verdict: 'alarm',
    asr_uncertain: false,
    expected_verdict: base.call.expected_verdict,
    families: base.checks.map((c) => ({
      family: c.family,
      score: c.score,
      needs_human_votes: c.needs_human_votes,
      failed: false,
    })),
  })
  sim.queue = sim.queue.filter((q) => q !== item)
  sim.recent = [doneItem(base.call), ...sim.recent].slice(0, 20)
  emit({ type: 'call_updated', data: { call_id: id, status: 'done', verdict: 'alarm' } })
}

/** Fixture mode: a file lands in the inbox folder. Same file twice is skipped, like the watcher's hash check. */
function simEnqueue(fileName: string): 'queued' | 'duplicate' {
  const id = fileName.replace(/\.[^.]+$/, '')
  const known = fixtureItems().some((c) => c.call_id === id) || sim.queue.some((q) => q.call_id === id)
  if (known) return 'duplicate'
  sim.queue.push({
    ...doneItem({
      ...fixtureItems()[0],
      call_id: id,
      file_name: fileName,
      verdict: null,
      score: null,
      trigger_sent: false,
    }),
    stage: 'queued',
    progress: 0,
    elapsed_s: 0,
    updated_at: now(),
    duration_s: 192,
  })
  sim.last_file_at = now()
  publish()
  runSim()
  return 'queued'
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  if (!USE_FIXTURES) return request<PipelineStatus>('/pipeline/status')
  return structuredClone(sim)
}

export async function setWatching(enabled: boolean): Promise<WatchResponse> {
  if (!USE_FIXTURES) return send<WatchResponse>('POST', '/pipeline/watch', { enabled })
  sim.watching = enabled
  if (!enabled && simTimer !== null) {
    window.clearTimeout(simTimer)
    simTimer = null
  }
  publish()
  runSim()
  return { watching: enabled }
}

/** Fixture mode only (demo): a new recording lands in the inbox folder. Each press uses the next free noisy C09 copy. */
export function simulateIncomingCall(): string {
  if (!USE_FIXTURES) throw new ApiError(400, 'Simulation only exists in fixture mode.')
  for (let n = 4; ; n++) {
    const name = n === 4 ? 'Stufe2_C09-K4.wav' : `Stufe2_C09-K4-${n - 4}.wav`
    if (simEnqueue(name) === 'queued') return name
  }
}

export async function processFolder(path: string): Promise<ProcessFolderResponse> {
  if (!USE_FIXTURES) return send<ProcessFolderResponse>('POST', '/pipeline/process-folder', { path })
  const r = simEnqueue('Stufe2_C09-K4.wav')
  return { path, enqueued: r === 'queued' ? 1 : 0, skipped_duplicates: r === 'duplicate' ? 1 : 0, rejected: [] }
}

const AUDIO = /\.wav$/i
const MAX_UPLOAD = 200 * 1024 * 1024

/** Drop zone: copy one recording into the inbox folder (contract: POST /api/pipeline/inbox). The watcher does the rest. */
export async function uploadToInbox(file: File): Promise<UploadResponse> {
  if (!AUDIO.test(file.name))
    throw new ApiError(415, `${file.name} is not a WAV file. Convert it to WAV and drop it again.`)
  if (file.size > MAX_UPLOAD)
    throw new ApiError(413, `${file.name} is larger than 200 MB. Split or compress it and drop it again.`)
  if (!USE_FIXTURES) {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/pipeline/inbox', { method: 'POST', body }).catch(() => {
      throw new ApiError(0, UNREACHABLE)
    })
    if (!res.ok) throw await failure(res)
    return res.json() as Promise<UploadResponse>
  }
  const r = simEnqueue(file.name)
  return { file_name: file.name, queued: r === 'queued', duplicate: r === 'duplicate' }
}

export const exportUrl = (format: 'json' | 'csv') => `/api/pipeline/export?format=${format}`

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Results as CSV (contract: GET /pipeline/export?format=csv). Fixture mode builds it from the fixtures. */
export async function exportCsv(): Promise<Blob> {
  if (!USE_FIXTURES) {
    const res = await fetch(exportUrl('csv')).catch(() => {
      throw new ApiError(0, UNREACHABLE)
    })
    if (!res.ok) throw await failure(res)
    return res.blob()
  }
  const header = ['call_id', 'file_name', 'verdict', 'family', 'score', 'reason', 'open_question', 'evidence']
  const rows = await Promise.all(
    fixtureItems().map(async (c) => {
      const d = await getCall(c.call_id)
      const evidence = d.evidence.map((e) => `${e.role}:${e.start_s}-${e.end_s}`).join(';')
      return [c.call_id, c.file_name, c.verdict, c.family, c.score, c.reason, c.open_question, evidence]
    }),
  )
  return new Blob([[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'], { type: 'text/csv' })
}
/** Results as JSON (contract: GET /pipeline/export?format=json). */
export async function exportJson(): Promise<Blob> {
  if (!USE_FIXTURES) {
    const res = await fetch(exportUrl('json')).catch(() => {
      throw new ApiError(0, UNREACHABLE)
    })
    if (!res.ok) throw await failure(res)
    return res.blob()
  }
  const rows = await Promise.all(
    fixtureItems().map(async (c) => {
      const d = await getCall(c.call_id)
      const { call_id, file_name, verdict, family, score, reason, open_question } = c
      const evidence = d.evidence.map(({ role, start_s, end_s }) => ({ role, start_s, end_s }))
      return { call_id, file_name, verdict, family, score, reason, open_question, evidence }
    }),
  )
  return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
}

export const eventsUrl = '/api/events'
export async function getSettings(): Promise<SettingsResponse> {
  if (!USE_FIXTURES) return request<SettingsResponse>('/settings')
  const base = settingsFixture as unknown as SettingsResponse
  // Config versions follow edits made in this tab (fixture mode keeps them in memory).
  return {
    ...base,
    config_versions: {
      ...base.config_versions,
      keywords: fixtureKeywords.version_id,
      families: fixtureFamilies.version_id,
      thresholds: fixtureThresholds?.version_id ?? base.config_versions.thresholds,
    },
  }
}
/** GET /api/advisors (R12). Fixture mode groups the fixture calls with the same rules (lib/advisors.ts). */
export async function getAdvisors(since: string | null = null): Promise<AdvisorRow[]> {
  if (!USE_FIXTURES) return request<AdvisorRow[]>(`/advisors${since ? `?since=${encodeURIComponent(since)}` : ''}`)
  return advisorRows(fixtureItems(), since)
}
