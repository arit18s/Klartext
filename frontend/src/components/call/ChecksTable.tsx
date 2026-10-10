import { Fragment, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { CheckResult, Decision } from '@/lib/types'
import { EVENT_LABEL, FAMILY_LABEL, formatAgreement, roundScore } from '@/lib/format'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

const th =
  'h-10 whitespace-nowrap border-b border-line px-3 first:pl-4 last:pr-4 text-left text-small font-medium text-muted'
const td = 'h-11 whitespace-nowrap border-b border-line px-3 py-2 first:pl-4 last:pr-4'

function EventCell({ check, decided, decision }: { check: CheckResult; decided: boolean; decision: Decision }) {
  if (check.event_majority === 'failed') return <span className="text-alarm">{t('checks.failed')}</span>
  const label = EVENT_LABEL[check.event_majority]
  if (decided) {
    const tone =
      decision.verdict === 'alarm'
        ? 'bg-alarm-soft text-alarm'
        : decision.verdict === 'review'
          ? 'bg-review-soft text-review'
          : 'bg-clear-soft text-clear'
    return (
      <span
        className={cn(
          'inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-small font-medium',
          tone,
        )}
      >
        {label}
      </span>
    )
  }
  return <span className={check.event_majority === 'undetermined' ? 'text-review' : 'text-muted'}>{label}</span>
}

/** One row per family, decided family first. Click a family to see that check's reasoning. */
export function ChecksTable({ checks, decision }: { checks: CheckResult[]; decision: Decision }) {
  const [open, setOpen] = useState<string | null>(null)
  const ordered = [...checks].sort(
    (a, b) => Number(b.family === decision.family) - Number(a.family === decision.family),
  )
  const runs = Math.max(0, ...checks.map((c) => c.samples))

  return (
    <section
      aria-label={t('checks.title')}
      className="break-inside-avoid overflow-hidden rounded-panel border border-line bg-paper"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-subtitle font-medium">{t('checks.title')}</h3>
        <span className="text-small text-muted">{t('checks.runs', { n: runs })}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('checks.family')}</th>
              <th className={th}>{t('checks.event')}</th>
              <th className={cn(th, 'text-right')}>{t('checks.score')}</th>
              <th className={cn(th, 'text-right')}>{t('checks.agreement')}</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((c) => {
              const decided = c.family === decision.family
              const expanded = open === c.family
              const noScore = c.event_majority === 'not_applicable' || c.event_majority === 'failed'
              return (
                <Fragment key={c.family}>
                  <tr className="hover:bg-canvas">
                    <td className={cn(td, 'min-w-[144px] whitespace-normal')}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : c.family)}
                        className={cn('inline-flex items-center gap-1 text-left', decided && 'font-medium')}
                      >
                        <ChevronRight
                          size={14}
                          strokeWidth={1.75}
                          aria-hidden="true"
                          className={cn('flex-none text-muted transition-transform', expanded && 'rotate-90')}
                        />
                        {FAMILY_LABEL[c.family]}
                      </button>
                    </td>
                    <td className={td}>
                      <EventCell check={c} decided={decided} decision={decision} />
                    </td>
                    <td className={cn(td, 'tabular text-right')}>{noScore ? '–' : roundScore(c.score)}</td>
                    <td className={cn(td, 'tabular whitespace-nowrap text-right text-muted')}>
                      {formatAgreement(c.agreement, c.samples)}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={4} className="border-b border-line bg-canvas px-4 py-3">
                        <dl className="m-0 grid max-w-[72ch] gap-2 text-small">
                          {c.reason && (
                            <div>
                              <dt className="font-medium">{t('checks.reason')}</dt>
                              <dd className="m-0">{c.reason}</dd>
                            </div>
                          )}
                          {c.benign_explanation && (
                            <div>
                              <dt className="font-medium">{t('checks.harmless')}</dt>
                              <dd className="m-0">{c.benign_explanation}</dd>
                            </div>
                          )}
                          {c.open_question && (
                            <div>
                              <dt className="font-medium">{t('checks.missing')}</dt>
                              <dd className="m-0">{c.open_question}</dd>
                            </div>
                          )}
                          {c.needs_human_votes > 0 && (
                            <div className="text-muted">
                              {t('checks.humanVotes', { n: c.needs_human_votes, total: c.samples })}
                            </div>
                          )}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
