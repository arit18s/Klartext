import { useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Page } from '@/app/Page'
import { Segmented } from '@/components/Segmented'
import { Tag } from '@/components/Tag'
import { Button } from '@/components/ui/button'
import { needsAttention } from '@/lib/advisors'
import { getAdvisors } from '@/lib/api'
import { DATE_LABEL, sinceFor, type DateRange } from '@/lib/filters'
import { FAMILY_LABEL, formatProcessed } from '@/lib/format'
import type { AdvisorRow } from '@/lib/types'
import { cn } from '@/lib/utils'

const PERIODS: DateRange[] = ['7d', '30d', 'all']
const th =
  'sticky top-0 z-[1] h-10 whitespace-nowrap border-b border-line bg-paper px-4 text-left text-small font-medium text-muted'
const td = 'h-11 whitespace-nowrap border-b border-line px-4 group-last:border-b-0'
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Why the row is highlighted, in words (the coloured edge alone would not be enough). */
function pattern(r: AdvisorRow): { text: string; tone: 'alarm' | 'review' } | null {
  if (r.alarm > 0) return { text: plural(r.alarm, 'alarm', 'alarms'), tone: 'alarm' }
  if (r.review >= 2) return { text: `${r.review} reviews`, tone: 'review' }
  return null
}

/** Patterns across calls per advisor (stretch goal R12, 02_APP_FLOW screen 8). */
export default function Advisors() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<DateRange>('all')
  // sinceFor() moves with the clock: key on the period, compute the time when the query runs
  const advisors = useQuery({ queryKey: ['advisors', period], queryFn: () => getAdvisors(sinceFor(period)) })
  const rows = advisors.data ?? []
  const flagged = rows.filter(needsAttention).length
  const open = (r: AdvisorRow) => navigate(`/calls?advisor=${encodeURIComponent(r.advisor_name)}`)
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, r: AdvisorRow) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    open(r)
  }

  return (
    <Page title="Advisors">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">Patterns per advisor</h2>
          <p className="mt-1 max-w-[72ch] text-muted">
            One call can be a mistake. An alarm, or repeated reviews for the same advisor, are worth a conversation.
          </p>
        </div>
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: DATE_LABEL[p] }))}
        />
      </section>

      {advisors.data && rows.length > 0 && (
        <p className="-mt-2 m-0 text-muted">
          {plural(rows.length, 'advisor', 'advisors')} ·{' '}
          {flagged ? `${plural(flagged, 'advisor', 'advisors')} worth a look` : 'none with an alarm or 2+ reviews'} ·{' '}
          {DATE_LABEL[period].toLowerCase()}
        </p>
      )}

      <section aria-label="Advisors" className="overflow-hidden rounded-panel border border-line bg-paper">
        {advisors.isPending && <p className="m-0 px-4 py-6 text-muted">Loading advisors…</p>}
        {advisors.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-4">
            <span>Could not load the advisors. {advisors.error.message}</span>
            <Button onClick={() => advisors.refetch()}>Try again</Button>
          </div>
        )}
        {advisors.data && rows.length === 0 && (
          <p className="m-0 px-4 py-10 text-center text-muted">
            {period === 'all'
              ? 'No advisor names yet. They appear once calls are transcribed and the advisor is recognised.'
              : `No calls with a recognised advisor in the ${DATE_LABEL[period].toLowerCase()}.`}
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" aria-label="Advisors">
              <thead>
                <tr>
                  <th className={th}>Advisor</th>
                  <th className={cn(th, 'text-right')}>Calls</th>
                  <th className={cn(th, 'text-right')}>Alarms</th>
                  <th className={cn(th, 'text-right')}>Reviews</th>
                  <th className={cn(th, 'text-right')}>No alert</th>
                  <th className={th}>Families involved</th>
                  <th className={th}>Last call</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = pattern(r)
                  return (
                    <tr
                      key={r.advisor_name}
                      tabIndex={0}
                      onClick={() => open(r)}
                      onKeyDown={(e) => onKey(e, r)}
                      aria-label={`${r.advisor_name}: open all calls of this advisor`}
                      className={cn(
                        'group cursor-pointer hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2',
                        p?.tone === 'alarm' && 'shadow-[inset_3px_0_0_rgb(var(--alarm))]',
                        p?.tone === 'review' && 'shadow-[inset_3px_0_0_rgb(var(--review))]',
                      )}
                    >
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.advisor_name}</span>
                          {p && (
                            <Tag
                              className={cn(
                                'border-transparent',
                                p.tone === 'alarm' ? 'bg-alarm-soft text-alarm' : 'bg-review-soft text-review',
                              )}
                            >
                              {p.text}
                            </Tag>
                          )}
                        </div>
                      </td>
                      <td className={cn(td, 'tabular text-right')}>{r.calls}</td>
                      <td className={cn(td, 'tabular text-right', r.alarm === 0 && 'text-muted')}>{r.alarm}</td>
                      <td className={cn(td, 'tabular text-right', r.review === 0 && 'text-muted')}>{r.review}</td>
                      <td className={cn(td, 'tabular text-right text-muted')}>{r.no_alert}</td>
                      <td className={cn(td, 'whitespace-normal')}>
                        {r.families.length ? (
                          r.families.map((f) => FAMILY_LABEL[f]).join(', ')
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td className={cn(td, 'text-muted')}>{formatProcessed(r.last_call_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  )
}
