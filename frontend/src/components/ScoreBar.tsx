import type { Verdict } from '@/lib/types'
import { cn } from '@/lib/utils'
import { VERDICT_FILL } from './VerdictChip'

/** 48 × 4 px track, fill in the verdict colour, number on the right. Accepts any score 0–100. */
export function ScoreBar({
  score,
  verdict,
  wide = false,
  label,
}: {
  score: number | null
  verdict: Verdict | null
  wide?: boolean
  label?: string
}) {
  if (score === null) return <span className="text-muted">–</span>
  const value = Math.max(0, Math.min(100, Math.round(score)))
  return (
    <span className="tabular inline-flex items-center gap-2">
      <span className={cn('block h-1 overflow-hidden rounded-sm bg-line', wide ? 'w-16' : 'w-12')} aria-hidden="true">
        <span
          className={cn('block h-1 rounded-sm', verdict ? VERDICT_FILL[verdict] : 'bg-muted')}
          style={{ width: `${value}%` }}
        />
      </span>
      {label ? (
        <span>
          {label} <b className="font-semibold">{value}</b>
        </span>
      ) : (
        value
      )}
    </span>
  )
}
