import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Clock, Siren, UserSearch } from 'lucide-react'
import { Page } from '@/app/Page'
import { CallsTable } from '@/components/CallsTable'
import { DateRangeButton } from '@/components/DateRangeButton'
import { EmptyState } from '@/components/EmptyState'
import { FilterModal } from '@/components/FilterModal'
import { Kbd } from '@/components/Kbd'
import { StatCard } from '@/components/StatCard'
import { Tag } from '@/components/Tag'
import { useToast } from '@/components/Toast'
import { Button, buttonVariants } from '@/components/ui/button'
import { USE_FIXTURES, getCalls, getPipelineStatus, simulateIncomingCall } from '@/lib/api'
import { INBOX_FILTERS, applyFilters, filterChips, removeChip, sortCalls, type FilterState } from '@/lib/filters'
import { recordingName } from '@/lib/format'
import { useFeedback } from '@/lib/hooks'
import type { PipelineStatus } from '@/lib/types'
import { t, tn } from '@/i18n'

function pipelineLine(status: PipelineStatus | undefined): string {
  if (!status) return t('inbox.openPipeline')
  if (!status.watching) return t('inbox.watchingPaused')
  const waiting = status.queue.filter((q) => q.stage !== 'failed').length
  return waiting ? tn('inbox.inQueue', waiting) : t('inbox.idle')
}

export default function Inbox() {
  const [filters, setFilters] = useState<FilterState>(INBOX_FILTERS)
  const calls = useQuery({
    queryKey: ['calls', { flagged_only: true }],
    queryFn: () => getCalls({ flagged_only: true }),
  })
  const pipeline = useQuery({ queryKey: ['pipeline'], queryFn: getPipelineStatus, retry: false })
  const feedback = useFeedback()
  const toast = useToast()

  const flagged = useMemo(() => sortCalls(calls.data?.items ?? []), [calls.data])
  const shown = useMemo(() => applyFilters(flagged, filters), [flagged, filters])
  const counts = calls.data?.counts
  const chips = filterChips(filters)
  const withoutFeedback = flagged.filter((c) => c.verdict === 'alarm' && !c.feedback_label).length

  const header = (
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-display">{t('inbox.heading')}</h2>
        <p className="mt-1 text-muted">{t('inbox.intro')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {USE_FIXTURES && (
          <Button
            variant="ghost"
            title={t('inbox.simulateTitle')}
            onClick={() => toast(t('inbox.simulating', { id: simulateIncomingCall() }))}
          >
            {t('inbox.simulate')}
          </Button>
        )}
        <DateRangeButton value={filters.date} onChange={(date) => setFilters({ ...filters, date })} />
        <FilterModal value={filters} onApply={setFilters} items={flagged} verdicts={['alarm', 'review']} />
      </div>
    </section>
  )

  if (calls.isPending) {
    return (
      <Page title={t('nav.inbox')}>
        {header}
        <p className="text-muted">{t('inbox.loading')}</p>
      </Page>
    )
  }

  if (calls.error) {
    return (
      <Page title={t('nav.inbox')}>
        {header}
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>{t('inbox.loadError', { message: calls.error.message })}</span>
          <Button onClick={() => calls.refetch()}>{t('common.tryAgain')}</Button>
        </div>
      </Page>
    )
  }

  if (counts && counts.flagged === 0) {
    return (
      <Page title={t('nav.inbox')}>
        <EmptyState
          icon={Check}
          title={t('inbox.emptyTitle')}
          actions={
            <>
              <Link to="/calls" className={buttonVariants({ variant: 'primary' })}>
                {t('inbox.viewAll')}
              </Link>
              <Link to="/pipeline" className={buttonVariants()}>
                {t('inbox.openPipeline')}
              </Link>
            </>
          }
        >
          {t('inbox.emptyBody', { done: counts.done, total: counts.total })}
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page title={t('nav.inbox')}>
      {header}

      {counts && (
        <section aria-label={t('inbox.summary')} className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
          <StatCard
            label={t('inbox.alerts')}
            value={counts.alarm}
            icon={Siren}
            tone="alarm"
            footer={t('inbox.withoutFeedback', { n: withoutFeedback })}
            onClick={() => setFilters({ ...filters, verdict: ['alarm'] })}
          />
          <StatCard
            label={t('inbox.reviews')}
            value={counts.review}
            icon={UserSearch}
            tone="review"
            footer={t('inbox.openQuestion')}
            onClick={() => setFilters({ ...filters, verdict: ['review'] })}
          />
          <StatCard
            label={t('inbox.checkedToday')}
            value={counts.checked_today}
            icon={Check}
            footer={t('inbox.viewAll')}
            to="/calls"
          />
          <StatCard
            label={t('inbox.coverage')}
            value={t('common.ofTotal', { a: counts.done, b: counts.total })}
            icon={Clock}
            footer={pipelineLine(pipeline.data)}
            to="/pipeline"
          />
        </section>
      )}

      <section aria-label={t('inbox.flaggedCalls')} className="overflow-hidden rounded-panel border border-line bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{chips.length ? t('inbox.activeFilters') : t('inbox.noFilters')}</span>
            {chips.map((chip) => (
              <Tag
                key={chip.key}
                className="text-graphite"
                onRemove={() => setFilters(removeChip(filters, chip.key))}
                removeLabel={t('inbox.removeFilter', { label: chip.label })}
              >
                {chip.label}
              </Tag>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-small text-muted" aria-label={t('inbox.shortcuts')}>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t('inbox.kbdMove')} <Kbd>Enter</Kbd> {t('inbox.kbdOpen')} <Kbd>A</Kbd> {t('inbox.kbdCorrect')}{' '}
            <Kbd>F</Kbd> {t('inbox.kbdFalse')}
          </div>
        </div>
        <div className="border-t border-line">
          <CallsTable
            items={shown}
            variant="inbox"
            noun={t('inbox.flaggedNoun')}
            label={t('inbox.flaggedCalls')}
            onFeedback={(call, label) =>
              feedback.mutate({ callId: call.call_id, label, name: recordingName(call).name })
            }
            empty={
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="m-0 text-muted">{t('inbox.noMatch')}</p>
                <Button onClick={() => setFilters({ ...INBOX_FILTERS, verdict: [], variant: [], date: 'all' })}>
                  {t('common.clearFilters')}
                </Button>
              </div>
            }
          />
        </div>
      </section>
    </Page>
  )
}
