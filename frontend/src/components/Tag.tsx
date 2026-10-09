import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Small outlined pill, e.g. the Clean/Noisy chip next to a recording, or an active filter. */
export function Tag({
  children,
  className,
  onRemove,
  removeLabel,
}: {
  children: ReactNode
  className?: string
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border border-line bg-paper px-2 text-[12px] leading-4 text-muted',
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-canvas"
        >
          <X size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
