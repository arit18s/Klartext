import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

/** Underlined tabs with a count, keyboard like WAI-ARIA tabs (←/→, Home/End). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const next =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    e.preventDefault()
    const j = (next + tabs.length) % tabs.length
    onChange(tabs[j].value)
    refs.current[j]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 border-b border-line">
      {tabs.map((t, i) => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            id={`tab-${t.value}`}
            aria-selected={on}
            aria-controls={`panel-${t.value}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-1 pb-2.5 pt-1',
              on ? 'border-graphite text-graphite' : 'border-transparent text-muted hover:text-graphite',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="inline-flex h-5 items-center rounded-full border border-line px-1.5 text-[12px] text-muted">
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
