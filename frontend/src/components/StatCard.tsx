import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Summary tile from the Inbox header: label, big number, icon, and a footer link. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  footer,
  to,
  onClick,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: 'alarm' | 'review'
  footer: string
  to?: string
  onClick?: () => void
}) {
  const footClass =
    'flex h-10 items-center justify-between border-t border-line bg-canvas px-4 text-[13px] text-muted hover:text-graphite text-left w-full'
  return (
    <div className="flex flex-col overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex items-start justify-between p-4">
        <div>
          <div className="text-muted">{label}</div>
          <div className="tabular mt-2 text-display">{value}</div>
        </div>
        <span
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-control',
            tone === 'alarm'
              ? 'bg-alarm-soft text-alarm'
              : tone === 'review'
                ? 'bg-review-soft text-review'
                : 'bg-canvas text-graphite',
          )}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
      </div>
      {to ? (
        <Link to={to} className={footClass}>
          {footer}
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={footClass}>
          {footer}
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
