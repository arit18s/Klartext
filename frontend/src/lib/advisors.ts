// Advisor patterns (R12). Fixture mode builds GET /api/advisors from the call list with the same rules as the
// backend (backend/app/api/advisors.py); the page uses needsAttention() for the highlight in both modes.
import type { AdvisorRow, CallSummary, Family } from './types'

const FAMILY_ORDER: Family[] = ['trade', 'splitting', 'access', 'disclosure', 'documentation']

/** Worth a conversation: the advisor's own behaviour was flagged, i.e. an advisor-raised alarm or two or more
 * advisor-raised reviews in the period (02_APP_FLOW screen 8). Customer requests alone never highlight a row. */
export const needsAttention = (r: AdvisorRow) => r.advisor_alarm > 0 || r.advisor_review >= 2

/** One row per advisor name; calls without a name are left out. `since`: processed at or after it. */
export function advisorRows(items: CallSummary[], since: string | null = null): AdvisorRow[] {
  const groups = new Map<string, CallSummary[]>()
  for (const c of items) {
    const name = c.advisor_name?.trim()
    if (!name) continue
    if (since && (!c.processed_at || c.processed_at < since)) continue
    groups.set(name, [...(groups.get(name) ?? []), c])
  }
  const rows = [...groups].map(([advisor_name, calls]): AdvisorRow => {
    const count = (v: string) => calls.filter((c) => c.verdict === v).length
    const byCustomer = (v: string) => calls.filter((c) => c.verdict === v && c.raised_by === 'customer').length
    const flagged = calls.filter((c) => c.verdict === 'alarm' || c.verdict === 'review')
    const stamp = (c: CallSummary) => c.processed_at ?? c.created_at ?? ''
    const last = calls.reduce((a, b) =>
      stamp(b) > stamp(a) || (stamp(b) === stamp(a) && b.call_id > a.call_id) ? b : a,
    )
    return {
      advisor_name,
      calls: calls.length,
      alarm: count('alarm'),
      review: count('review'),
      no_alert: count('no_alert'),
      advisor_alarm: count('alarm') - byCustomer('alarm'),
      advisor_review: count('review') - byCustomer('review'),
      customer_alarm: byCustomer('alarm'),
      customer_review: byCustomer('review'),
      families: FAMILY_ORDER.filter((f) => flagged.some((c) => c.family === f)),
      last_call_at: stamp(last) || null,
      last_call_id: last.call_id,
    }
  })
  return rows.sort(
    (a, b) =>
      b.advisor_alarm - a.advisor_alarm ||
      b.advisor_review - a.advisor_review ||
      b.alarm - a.alarm ||
      b.review - a.review ||
      b.calls - a.calls ||
      a.advisor_name.localeCompare(b.advisor_name, 'en', { sensitivity: 'base' }),
  )
}
