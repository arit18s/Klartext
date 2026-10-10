import type { CallSummary, Family, Level, Variant, Verdict } from './types'
import { FAMILY_LABEL, VARIANT_LABEL, VERDICT_LABEL, startOfTodayIso } from './format'
import { joinList, labels, lc, t } from '@/i18n'

export type DateRange = 'today' | '7d' | '30d' | 'all'

export const DATE_LABEL: Record<DateRange, string> = labels({
  today: 'date.today',
  '7d': 'date.7d',
  '30d': 'date.30d',
  all: 'date.all',
})

/** The range inside a sentence: "No calls … in the last 7 days." */
export const DATE_IN: Record<DateRange, string> = labels({
  today: 'date.inThe.today',
  '7d': 'date.inThe.7d',
  '30d': 'date.inThe.30d',
  all: 'date.inThe.all',
})

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


export { sortCalls } from './sort'

export interface FilterChip {
  key: 'verdict' | 'family' | 'level' | 'variant' | 'advisor'
  label: string
}

/** Chips for the "Active filters" row. The date range has its own button and no chip. */
export function filterChips(f: FilterState): FilterChip[] {
  const chips: FilterChip[] = []
  if (f.verdict.length)
    chips.push({ key: 'verdict', label: t('chip.verdict', { list: f.verdict.map((v) => lc(VERDICT_LABEL[v])).join(', ') }) })
  if (f.family.length && f.family.length < FAMILIES.length) {
    chips.push({ key: 'family', label: t('chip.family', { list: f.family.map((x) => lc(FAMILY_LABEL[x])).join(', ') }) })
  }
  if (f.level !== null) chips.push({ key: 'level', label: t('chip.level', { level: f.level }) })
  if (f.variant.length)
    chips.push({ key: 'variant', label: t('chip.audio', { list: joinList(f.variant.map((v) => lc(VARIANT_LABEL[v]))) }) })
  if (f.advisor !== null) chips.push({ key: 'advisor', label: t('chip.advisor', { name: f.advisor }) })
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
