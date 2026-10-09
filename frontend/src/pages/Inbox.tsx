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
import { Button, buttonVariants } from '@/components/ui/button'
import { USE_FIXTURES, getCalls, getPipelineStatus } from '@/lib/api'
import { INBOX_FILTERS, applyFilters, filterChips, removeChip, sortCalls, type FilterState } from '@/lib/filters'
import { recordingName } from '@/lib/format'
import { useFeedback } from '@/lib/hooks'
import type { PipelineStatus } from '@/lib/types'

function pipelineLine(status: PipelineStatus | undefined): string {
  if (!status) return 'Open pipeline'
  if (!status.watching) return 'Watching paused'
  const waiting = status.queue.filter((q) => q.stage !== 'failed').length
  return waiting ? `${waiting} ${waiting === 1 ? 'call' : 'calls'} in the queue` : 'Pipeline idle, inbox folder empty'
}

export default function Inbox() {
  const [filters, setFilters] = useState<FilterState>(INBOX_FILTERS)
  const calls = useQuery({
    queryKey: ['calls', { flagged_only: true }],
    queryFn: () => getCalls({ flagged_only: true }),
  })
  const pipeline = useQuery({ queryKey: ['pipeline'], queryFn: getPipelineStatus, enabled: !USE_FIXTURES })
  const feedback = useFeedback()

  const flagged = useMemo(() => sortCalls(calls.data?.items ?? []), [calls.data])
  const shown = useMemo(() => applyFilters(flagged, filters), [flagged, filters])
  const counts = calls.data?.counts
  const chips = filterChips(filters)
  const withoutFeedback = flagged.filter((c) => c.verdict === 'alarm' && !c.feedback_label).length

  const header = (
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-display">Needs attention</h2>
        <p className="mt-1 text-muted">Alarms first, then reviews, highest score on top.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <DateRangeButton value={filters.date} onChange={(date) => setFilters({ ...filters, date })} />
        <FilterModal value={filters} onApply={setFilters} items={flagged} verdicts={['alarm', 'review']} />
      </div>
    </section>
  )

  if (calls.isPending) {
    return (
      <Page title="Inbox">
        {header}
        <p className="text-muted">Loading calls…</p>
      </Page>
    )
  }

  if (calls.error) {
    return (
      <Page title="Inbox">
        {header}
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>Could not load the calls. {calls.error.message}</span>
          <Button onClick={() => calls.refetch()}>Try again</Button>
        </div>
      </Page>
    )
  }

  if (counts && counts.flagged === 0) {
    return (
      <Page title="Inbox">
        <EmptyState
          icon={Check}
          title="No calls need attention."
          actions={
            <>
              <Link to="/calls" className={buttonVariants({ variant: 'primary' })}>
                View all calls
              </Link>
              <Link to="/pipeline" className={buttonVariants()}>
                Open pipeline
              </Link>
            </>
          }
        >
          {counts.done} of {counts.total} calls checked. New recordings appear here as soon as the pipeline decides they
          need a look.
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page title="Inbox">
      {header}

      {counts && (
        <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
          <StatCard
            label="Alarms"
            value={counts.alarm}
            icon={Siren}
            tone="alarm"
            footer={`${withoutFeedback} without feedback`}
            onClick={() => setFilters({ ...filters, verdict: ['alarm'] })}
          />
          <StatCard
            label="Reviews"
            value={counts.review}
            icon={UserSearch}
            tone="review"
            footer="Each with an open question"
            onClick={() => setFilters({ ...filters, verdict: ['review'] })}
          />
          <StatCard
            label="Checked today"
            value={counts.checked_today}
            icon={Check}
            footer="View all calls"
            to="/calls"
          />
          <StatCard
            label="Coverage"
            value={`${counts.done} of ${counts.total}`}
            icon={Clock}
            footer={pipelineLine(pipeline.data)}
            to="/pipeline"
          />
        </section>
      )}

      <section aria-label="Flagged calls" className="overflow-hidden rounded-panel border border-line bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{chips.length ? 'Active filters' : 'No filters'}</span>
            {chips.map((chip) => (
              <Tag
                key={chip.key}
                className="text-graphite"
                onRemove={() => setFilters(removeChip(filters, chip.key))}
                removeLabel={`Remove filter ${chip.label}`}
              >
                {chip.label}
              </Tag>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-small text-muted" aria-label="Keyboard shortcuts">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move <Kbd>Enter</Kbd> open <Kbd>A</Kbd> correct <Kbd>F</Kbd> false alarm
          </div>
        </div>
        <div className="border-t border-line">
          <CallsTable
            items={shown}
            variant="inbox"
            noun="flagged calls"
            label="Flagged calls"
            onFeedback={(call, label) =>
              feedback.mutate({ callId: call.call_id, label, name: recordingName(call).name })
            }
            empty={
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="m-0 text-muted">No flagged calls match these filters.</p>
                <Button onClick={() => setFilters({ ...INBOX_FILTERS, verdict: [], variant: [], date: 'all' })}>
                  Clear filters
                </Button>
              </div>
            }
          />
        </div>
      </section>
    </Page>
  )
}
