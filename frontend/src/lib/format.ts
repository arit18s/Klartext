import type { CallSummary, CheckEvent, Family, HelperFamily, RaisedBy, Variant, Verdict } from './types'

// Display names from 04_FRONTEND_GUIDELINES.md section 8.
/** Who raised a flagged call (CallSummary.raised_by), for "Raised by: …". */
export const RAISED_BY_LABEL: Record<RaisedBy, string> = { advisor: 'Advisor', customer: 'Customer', unclear: 'Unclear' }

export const FAMILY_LABEL: Record<Family | HelperFamily, string> = {
  trade: 'Trading on non-public information',
  splitting: 'Splitting to avoid approval',
  access: 'Access code shared',
  disclosure: 'Information given to a third party',
  documentation: 'Relevant information left out',
  numbers: 'Number type',
}

export const EVENT_LABEL: Record<CheckEvent, string> = {
  present: 'Happened',
  absent: 'Did not happen',
  undetermined: 'Unclear from the call',
  not_applicable: 'Not relevant',
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  alarm: 'Alarm',
  review: 'Review',
  no_alert: 'No alert',
}

export const VARIANT_LABEL: Record<Variant, string> = { clean: 'Clean', noisy: 'Noisy' }

/** 101.4 → "01:41" (timestamps inside a call). */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 192 → "3:12" (call length). */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '–'
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * How a recording is named in the UI: dialogue ID plus a Clean/Noisy chip.
 * Unknown file names (hidden test set) show the file stem and no chip.
 */
export function recordingName(call: Pick<CallSummary, 'call_id' | 'dialogue_id' | 'variant'>): {
  name: string
  variant: string | null
} {
  if (call.dialogue_id && call.variant) return { name: call.dialogue_id, variant: VARIANT_LABEL[call.variant] }
  return { name: call.call_id, variant: null }
}

// The officer works in Zurich; show times there regardless of the machine's zone.
const DISPLAY_TZ = 'Europe/Zurich'
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: DISPLAY_TZ })

/** ISO time → "today 10:42" or "8 Oct, 16:40". */
export function formatProcessed(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '–'
  const d = new Date(iso)
  const time = d.toLocaleTimeString('de-CH', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit' })
  if (dayKey(d) === dayKey(now)) return `today ${time}`
  const day = d.toLocaleDateString('en-GB', { timeZone: DISPLAY_TZ, day: 'numeric', month: 'short' })
  return `${day}, ${time}`
}

/** Short family names for dense tables (Rules design: "Access", "Third party"). */
export const FAMILY_SHORT: Record<Family | HelperFamily, string> = {
  trade: 'Trading',
  splitting: 'Splitting',
  access: 'Access',
  disclosure: 'Third party',
  documentation: 'Left out',
  numbers: 'Number type',
}

/** Name of a check in running text: "Why the access check is unclear". */
export const FAMILY_CHECK: Record<Family, string> = {
  trade: 'trading',
  splitting: 'splitting',
  access: 'access',
  disclosure: 'third-party',
  documentation: 'documentation',
}

/** ISO time → "10:42" today, otherwise "8 Oct". For table columns. */
export function formatProcessedShort(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (dayKey(d) === dayKey(now)) {
    return d.toLocaleTimeString('de-CH', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-GB', { timeZone: DISPLAY_TZ, day: 'numeric', month: 'short' })
}

/** ISO time → "10:43" (Zurich). */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-CH', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit' })
}

/** Start of today in Zurich, as an ISO string. */
export function startOfTodayIso(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: DISPLAY_TZ,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  )
  const elapsed = ((parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)) * 1000
  return new Date(now.getTime() - elapsed - now.getMilliseconds()).toISOString()
}

export const roundScore = (score: number | null) => (score === null ? '–' : String(Math.round(score)))

/** "3 of 3" from agreement share and valid sample count. */
export function formatAgreement(agreement: number | null, samples: number): string {
  if (agreement === null || samples === 0) return '–'
  return `${Math.round(agreement * samples)} of ${samples}`
}

export type MatchKind = 'match' | 'extra_review' | 'false_alarm' | 'caught_as_review' | 'caught_as_alarm' | 'missed'

/** Evaluation-mode comparison (01_PRD.md section 7: a fraud call sent to review counts as caught). */
export function matchKind(expected: Verdict | null, actual: Verdict | null): MatchKind | null {
  if (!expected || !actual) return null
  if (expected === actual) return 'match'
  const flagged = actual !== 'no_alert'
  if (expected === 'no_alert') return actual === 'review' ? 'extra_review' : 'false_alarm'
  if (!flagged) return 'missed'
  return actual === 'review' ? 'caught_as_review' : 'caught_as_alarm'
}

export const MATCH_LABEL: Record<MatchKind, string> = {
  match: 'Match',
  extra_review: 'Extra review',
  false_alarm: 'False alarm',
  caught_as_review: 'Caught as review',
  caught_as_alarm: 'Caught as alarm',
  missed: 'Missed',
}
