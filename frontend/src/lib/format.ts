import type { CallSummary, CheckEvent, Family, HelperFamily, Variant, Verdict } from './types'

// Display names from 04_FRONTEND_GUIDELINES.md section 8.
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
