import { Check, Siren, UserSearch } from 'lucide-react'
import type { Verdict } from '@/lib/types'
import { VERDICT_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICON = { alarm: Siren, review: UserSearch, no_alert: Check }
const TONE = {
  alarm: 'bg-alarm-soft text-alarm',
  review: 'bg-review-soft text-review',
  no_alert: 'bg-clear-soft text-clear',
}

/** Verdict pill: always icon + label, never colour alone. */
export function VerdictChip({ verdict, size = 'default' }: { verdict: Verdict; size?: 'default' | 'lg' }) {
  const Icon = ICON[verdict]
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-medium',
        size === 'lg' ? 'h-9 gap-2 px-3.5 text-title' : 'h-6 gap-1.5 px-2.5 text-small',
        TONE[verdict],
      )}
    >
      <Icon size={size === 'lg' ? 18 : 14} strokeWidth={1.75} aria-hidden="true" />
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

export const VERDICT_FILL: Record<Verdict, string> = { alarm: 'bg-alarm', review: 'bg-review', no_alert: 'bg-clear' }
