// Typed client for the backend API (docs/API_CONTRACT.md). With VITE_USE_FIXTURES=true the read endpoints
// that have fixtures answer from src/fixtures; every other call needs the backend.
import type {
  AdvisorRow,
  CallDetail,
  CallListResponse,
  CallSummary,
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
} from './types'

import callsFixture from '@/fixtures/calls.json'
import scoresFixture from '@/fixtures/scores.json'

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true'

const detailFixtures = import.meta.glob<CallDetail>('../fixtures/call_detail_*.json', { eager: true, import: 'default' })

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, body?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

const send = <T>(method: 'POST' | 'PUT', path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

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
    const detail = detailFixtures[`../fixtures/call_detail_${c.call_id}.json`]
    const transcript = detail?.segments.map((s) => s.text).join(' ').toLowerCase() ?? ''
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
  const all = callsFixture as unknown as CallListResponse
  return { items: all.items.filter((c) => matches(c, filters)), counts: all.counts }
}

export async function getCall(callId: string): Promise<CallDetail> {
  if (!USE_FIXTURES) return request(`/calls/${encodeURIComponent(callId)}`)
  const detail = detailFixtures[`../fixtures/call_detail_${callId}.json`]
  if (!detail) throw new ApiError(404, `Call ${callId} not found.`)
  return detail
}

export const audioUrl = (callId: string) => `/api/calls/${encodeURIComponent(callId)}/audio`
export const snippetUrl = (callId: string, segId: string) =>
  `/api/calls/${encodeURIComponent(callId)}/snippets/${encodeURIComponent(segId)}`

export const postFeedback = (callId: string, body: FeedbackRequest) =>
  USE_FIXTURES ? noFixture('Feedback') : send<Feedback>('POST', `/calls/${encodeURIComponent(callId)}/feedback`, body)

export const recheckCall = (callId: string) =>
  USE_FIXTURES ? noFixture('Recheck') : send<RecheckResponse>('POST', `/calls/${encodeURIComponent(callId)}/recheck`)

export const retryCall = (callId: string) =>
  USE_FIXTURES ? noFixture('Retry') : send<RetryResponse>('POST', `/calls/${encodeURIComponent(callId)}/retry`)

export const getCallHistory = (callId: string) =>
  USE_FIXTURES ? noFixture('Call history') : request<HistoryEntry[]>(`/calls/${encodeURIComponent(callId)}/history`)

// ---------- Scores ----------

export async function getScores(): Promise<ScoresResponse> {
  if (!USE_FIXTURES) return request('/scores')
  return scoresFixture as unknown as ScoresResponse
}

// ---------- Config ----------

export const getThresholds = () => (USE_FIXTURES ? noFixture('Thresholds') : request<ThresholdsConfig>('/config/thresholds'))
export const putThresholds = (body: ThresholdsUpdate) => send<ThresholdsConfig>('PUT', '/config/thresholds', body)
export const getFamilies = () => (USE_FIXTURES ? noFixture('Families') : request<FamiliesConfig>('/config/families'))
export const putFamilies = (body: FamiliesUpdate) => send<FamiliesConfig>('PUT', '/config/families', body)
export const getKeywords = () => (USE_FIXTURES ? noFixture('Keywords') : request<KeywordsConfig>('/config/keywords'))
export const putKeywords = (body: KeywordsUpdate) => send<KeywordsConfig>('PUT', '/config/keywords', body)
export const suggestKeywordVariants = (keywordId: string) =>
  send<KeywordSuggestResponse>('POST', '/config/keywords/suggest', { keyword_id: keywordId })
export const rescanKeywords = () => send<RescanResponse>('POST', '/keywords/rescan')

// ---------- Evaluation, pipeline, settings ----------

export const runEval = (body: EvalRunRequest) => send<EvalRun>('POST', '/eval/run', body)
export const getLatestEval = () => (USE_FIXTURES ? noFixture('Evaluation') : request<EvalRun>('/eval/latest'))
export const getPipelineStatus = () => (USE_FIXTURES ? noFixture('Pipeline status') : request<PipelineStatus>('/pipeline/status'))
export const setWatching = (enabled: boolean) => send<WatchResponse>('POST', '/pipeline/watch', { enabled })
export const processFolder = (path: string) => send<ProcessFolderResponse>('POST', '/pipeline/process-folder', { path })
export const exportUrl = (format: 'json' | 'csv') => `/api/pipeline/export?format=${format}`
export const eventsUrl = '/api/events'
export const getSettings = () => (USE_FIXTURES ? noFixture('Settings') : request<SettingsResponse>('/settings'))
export const getAdvisors = () => (USE_FIXTURES ? noFixture('Advisors') : request<AdvisorRow[]>('/advisors'))
