// Call list order, shared by Inbox and All calls; no app imports so npm test can load it.
import type { CallSummary, Verdict } from './types'

const VERDICT_ORDER: Record<Verdict, number> = { alarm: 0, review: 1, no_alert: 2 }

/** Minute the call was checked; calls checked in the same minute (a batch) share it. Unchecked: oldest. */
const checkedMinute = (c: CallSummary) => (c.processed_at ? Math.floor(Date.parse(c.processed_at) / 60000) : 0)

/** Alerts first, then reviews, then no alert, undecided last; within each the newest first (by minute, so a new
 *  call is always on top), then the highest score. Mirrors the order of GET /api/calls (backend/app/api/calls.py). */
export function sortCalls(items: CallSummary[]): CallSummary[] {
  return [...items].sort(
    (a, b) =>
      (a.verdict ? VERDICT_ORDER[a.verdict] : 3) - (b.verdict ? VERDICT_ORDER[b.verdict] : 3) ||
      checkedMinute(b) - checkedMinute(a) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.call_id.localeCompare(b.call_id),
  )
}
