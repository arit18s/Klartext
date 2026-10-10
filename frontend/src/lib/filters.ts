import type { CallSummary, Family, Level, Variant, Verdict } from './types'
import { FAMILY_LABEL, VERDICT_LABEL, startOfTodayIso } from './format'

export type DateRange = 'today' | '7d' | '30d' | 'all'

export const DATE_LABEL: Record<DateRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
}

/** What the filter modal edits. Empty list = no restriction. A list with every option = no restriction too. */
export interface FilterState {
  verdict: Verdict[]
  family: Family[]
  level: Level | null
  variant: Variant[]
  advisor: string | null
  date: DateRange
}

export const VERDICTS: Verdict[] = ['alarm', 'review', 'no_alert']
export const FAMILIES: Family[] = ['trade', 'splitting', 'access', 'disclosure', 'documentation']
export const VARIANTS: Variant[] = ['clean', 'noisy']

export const EMPTY_FILTERS: FilterState = {
  verdict: [],
  family: [],
  level: null,
  variant: [],
  advisor: null,
  date: 'all',
}

/** Inbox default as in the design: "Verdict: alert, review" and "Audio: clean and noisy", last 7 days. */
export const INBOX_FILTERS: FilterState = {
  ...EMPTY_FILTERS,
  verdict: ['alarm', 'review'],
  variant: ['clean', 'noisy'],
  date: '7d',
}

export function sinceFor(range: DateRange, now = new Date()): string | null {
  if (range === 'all') return null
  if (range === 'today') return startOfTodayIso(now)
  const days = range === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

const restricts = <T>(picked: T[], all: T[]) => picked.length > 0 && picked.length < all.length

/**
 * Client-side filtering, same semantics as the API's query params. Calls with unknown file names have no
 * variant or level: they only drop out when one specific variant or level is picked.
 */
export function applyFilters(items: CallSummary[], f: FilterState, now = new Date()): CallSummary[] {
  const since = sinceFor(f.date, now)
  return items.filter((c) => {
    if (restricts(f.verdict, VERDICTS) && (!c.verdict || !f.verdict.includes(c.verdict))) return false
    if (restricts(f.family, FAMILIES) && (!c.family || !f.family.includes(c.family))) return false
    if (f.level !== null && c.level !== f.level) return false
    if (restricts(f.variant, VARIANTS) && (!c.variant || !f.variant.includes(c.variant))) return false
    if (f.advisor !== null && c.advisor_name !== f.advisor) return false
    if (since && (!c.processed_at || c.processed_at < since)) return false
    return true
  })
}

const VERDICT_ORDER: Record<Verdict, number> = { alarm: 0, review: 1, no_alert: 2 }

/** Alarms first, then reviews, then no alert, undecided last; highest score on top. */
export function sortCalls(items: CallSummary[]): CallSummary[] {
  return [...items].sort(
    (a, b) =>
      (a.verdict ? VERDICT_ORDER[a.verdict] : 3) - (b.verdict ? VERDICT_ORDER[b.verdict] : 3) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.call_id.localeCompare(b.call_id),
  )
}

export interface FilterChip {
  key: 'verdict' | 'family' | 'level' | 'variant' | 'advisor'
  label: string
}

const list = (words: string[]) =>
  words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

/** Chips for the "Active filters" row. The date range has its own button and no chip. */
export function filterChips(f: FilterState): FilterChip[] {
  const chips: FilterChip[] = []
  if (f.verdict.length)
    chips.push({ key: 'verdict', label: `Verdict: ${f.verdict.map((v) => VERDICT_LABEL[v].toLowerCase()).join(', ')}` })
  if (f.family.length && f.family.length < FAMILIES.length) {
    chips.push({ key: 'family', label: `Family: ${f.family.map((x) => FAMILY_LABEL[x].toLowerCase()).join(', ')}` })
  }
  if (f.level !== null) chips.push({ key: 'level', label: `Level: Stufe ${f.level}` })
  if (f.variant.length) chips.push({ key: 'variant', label: `Audio: ${list(f.variant)}` })
  if (f.advisor !== null) chips.push({ key: 'advisor', label: `Advisor: ${f.advisor}` })
  return chips
}

export function removeChip(f: FilterState, key: FilterChip['key']): FilterState {
  switch (key) {
    case 'level':
      return { ...f, level: null }
    case 'advisor':
      return { ...f, advisor: null }
    default:
      return { ...f, [key]: [] }
  }
}
