import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** Empty states invite action (04_FRONTEND_GUIDELINES.md section 8). */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="mx-auto flex max-w-[440px] flex-col items-center gap-4 py-12 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-modal bg-clear-soft text-clear">
        <Icon size={26} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h2 className="text-title">{title}</h2>
      <p className="m-0 text-muted">{children}</p>
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </section>
  )
}
