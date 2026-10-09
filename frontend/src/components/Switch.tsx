import { cn } from '@/lib/utils'

/** On/off switch inside a bordered label, as in the All calls header. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex h-9 items-center gap-2.5 rounded-control border border-line bg-paper px-3 font-medium hover:bg-canvas"
    >
      <span
        className={cn('relative h-5 w-9 flex-none rounded-full transition-colors', checked ? 'bg-graphite' : 'bg-line')}
        aria-hidden="true"
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-[left]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  )
}
