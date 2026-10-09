import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, MessageSquareCheck, Send, X } from 'lucide-react'
import type { CallSummary, FeedbackLabel } from '@/lib/types'
import {
  FAMILY_LABEL,
  MATCH_LABEL,
  VERDICT_LABEL,
  formatDuration,
  formatProcessedShort,
  matchKind,
  recordingName,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { VerdictChip } from './VerdictChip'
import { ScoreBar } from './ScoreBar'
import { Tag } from './Tag'
import { Button } from './ui/button'

type Variant = 'inbox' | 'all'

const th =
  'sticky top-0 z-[1] h-10 whitespace-nowrap border-b border-line bg-paper px-4 text-left text-small font-medium text-muted'
const td = 'h-11 whitespace-nowrap border-b border-line px-4 group-last:border-b-0'

function MatchCell({ call }: { call: CallSummary }) {
  const kind = matchKind(call.expected_verdict, call.verdict)
  if (!kind) return <span className="text-muted">–</span>
  const good = kind === 'match' || kind === 'caught_as_review' || kind === 'caught_as_alarm'
  const Icon = good ? Check : X
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        kind === 'match' ? 'text-clear' : good ? 'text-review' : 'text-alarm',
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      {MATCH_LABEL[kind]}
    </span>
  )
}

/**
 * Calls as table rows (never cards). Keyboard: ↑/↓ move, Enter opens; with onFeedback also A = correct,
 * F = false alarm. Rows use a roving tabindex so Tab enters the table once.
 */
export function CallsTable({
  items,
  variant,
  evalMode = false,
  pageSize = 20,
  noun,
  onFeedback,
  empty,
  label,
}: {
  items: CallSummary[]
  variant: Variant
  evalMode?: boolean
  pageSize?: number
  noun: string
  onFeedback?: (call: CallSummary, label: FeedbackLabel) => void
  empty?: ReactNode
  label: string
}) {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [active, setActive] = useState(0)
  const rows = useRef<(HTMLTableRowElement | null)[]>([])
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = items.slice(current * pageSize, (current + 1) * pageSize)

  useEffect(() => {
    setPage(0)
    setActive(0)
  }, [items.length])

  const focusRow = (i: number) => {
    const next = Math.max(0, Math.min(visible.length - 1, i))
    setActive(next)
    rows.current[next]?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, call: CallSummary, i: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const key = e.key.toLowerCase()
    if (e.key === 'ArrowDown') focusRow(i + 1)
    else if (e.key === 'ArrowUp') focusRow(i - 1)
    else if (e.key === 'Enter') navigate(`/calls/${encodeURIComponent(call.call_id)}`)
    else if (onFeedback && key === 'a') onFeedback(call, 'correct')
    else if (onFeedback && key === 'f') onFeedback(call, 'false_alarm')
    else return
    e.preventDefault()
  }

  const showEval = variant === 'all' && evalMode

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" aria-label={label}>
          <thead>
            <tr>
              <th className={th}>Verdict</th>
              <th className={th}>Call</th>
              <th className={th}>Family</th>
              <th className={th}>Reason</th>
              <th className={cn(th, 'text-right')}>Score</th>
              {showEval && <th className={th}>Expected</th>}
              {showEval && <th className={th}>Match</th>}
              <th className={cn(th, 'text-right')}>Duration</th>
              {variant === 'inbox' && <th className={cn(th, 'text-right')}>Processed</th>}
              {variant === 'inbox' && <th className={th}>Status</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const rec = recordingName(c)
              const href = `/calls/${encodeURIComponent(c.call_id)}`
              return (
                <tr
                  key={c.call_id}
                  ref={(el) => (rows.current[i] = el)}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  onKeyDown={(e) => onKey(e, c, i)}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('a')) navigate(href)
                  }}
                  className="group cursor-pointer hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2"
                >
                  <td className={td}>
                    {c.verdict ? <VerdictChip verdict={c.verdict} /> : <span className="text-muted">Checking…</span>}
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <Link to={href} tabIndex={-1} className="font-medium no-underline hover:text-muted">
                        {rec.name}
                      </Link>
                      {rec.variant && <Tag>{rec.variant}</Tag>}
                    </div>
                  </td>
                  <td className={td}>{c.family ? FAMILY_LABEL[c.family] : '–'}</td>
                  <td
                    className={cn(td, 'max-w-[340px] overflow-hidden text-ellipsis text-muted')}
                    title={c.reason ?? undefined}
                  >
                    {c.reason ?? c.error ?? '–'}
                  </td>
                  <td className={cn(td, 'text-right')}>
                    <ScoreBar score={c.score} verdict={c.verdict} />
                  </td>
                  {showEval && <td className={td}>{c.expected_verdict ? VERDICT_LABEL[c.expected_verdict] : '–'}</td>}
                  {showEval && (
                    <td className={td}>
                      <MatchCell call={c} />
                    </td>
                  )}
                  <td className={cn(td, 'tabular text-right')}>{formatDuration(c.duration_s)}</td>
                  {variant === 'inbox' && (
                    <td className={cn(td, 'tabular text-right text-muted')}>{formatProcessedShort(c.processed_at)}</td>
                  )}
                  {variant === 'inbox' && (
                    <td className={td}>
                      <div className="flex gap-2 text-muted">
                        {c.feedback_label && (
                          <MessageSquareCheck size={16} strokeWidth={1.75} role="img" aria-label="Feedback given" />
                        )}
                        {c.trigger_sent && (
                          <Send size={16} strokeWidth={1.75} role="img" aria-label="Sent to Outcept" />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {items.length === 0 && empty}
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-small text-muted">
          <span>
            Showing {visible.length} of {items.length} {noun}
          </span>
          <div className="flex gap-2">
            <Button size="md" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <Button size="md" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
