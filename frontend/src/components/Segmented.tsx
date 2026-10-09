import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: string
}

/** Segmented buttons (filter modal, language toggle). Each option is a toggle button with aria-pressed. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex rounded-control border border-line bg-canvas p-[3px]', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-[30px] flex-1 rounded px-3 text-[13px] font-medium leading-5 text-muted',
            o.value === value && 'bg-paper text-graphite shadow-[0_0_0_1px_rgb(var(--line))]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
