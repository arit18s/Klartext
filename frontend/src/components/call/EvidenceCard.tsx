import { forwardRef, type ReactNode } from 'react'
import type { Evidence } from '@/lib/types'
import { FAMILY_LABEL, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { speaker } from './labels'

const ROLE_LABEL = { context: 'Context', trigger: 'Trigger', exclusion: 'Exclusion' }

/** Bold the family name inside the note, as in "Supports **Access code shared**: …". */
function withFamily(note: string, family: Evidence['family']): ReactNode {
  const name = FAMILY_LABEL[family]
  const i = note.indexOf(name)
  if (i < 0) return note
  return (
    <>
      {note.slice(0, i)}
      <b className="font-semibold">{name}</b>
      {note.slice(i + name.length)}
    </>
  )
}

/** Evidence card (04_FRONTEND_GUIDELINES.md section 6). Trigger: yellow bar and quote. Focused: 2 px outline. */
export const EvidenceCard = forwardRef<HTMLElement, { evidence: Evidence; focused: boolean; fromLink: boolean }>(
  ({ evidence: e, focused, fromLink }, ref) => {
    const trigger = e.role === 'trigger'
    const time = `${formatTimestamp(e.start_s)}–${formatTimestamp(e.end_s)}`
    return (
      <article
        ref={ref}
        tabIndex={-1}
        aria-label={`${ROLE_LABEL[e.role]} ${formatTimestamp(e.start_s)} to ${formatTimestamp(e.end_s)}, ${speaker(e.speaker_role)}`}
        className={cn(
          'relative flex flex-col gap-2 overflow-hidden rounded-panel border border-line bg-paper py-4 pl-[19px] pr-4 scroll-mt-24',
          focused && 'outline outline-2 outline-graphite',
        )}
      >
        <span
          className={cn('absolute inset-y-0 left-0 w-[3px]', trigger ? 'bg-signal' : 'bg-line')}
          aria-hidden="true"
        />
        <div className="flex flex-wrap items-center gap-2 text-small text-muted">
          <span
            className={cn(
              'inline-flex h-[22px] items-center rounded-full border px-2 text-[12px] leading-4 text-graphite',
              trigger ? 'border-signal-soft bg-signal-soft' : 'border-line bg-paper',
            )}
          >
            {ROLE_LABEL[e.role]}
          </span>
          <span className="tabular">{time}</span>
          <span aria-hidden="true">·</span>
          <span>{speaker(e.speaker_role)}</span>
          {focused && fromLink && <span className="ml-auto">Opened from Outcept link</span>}
        </div>
        <p className={cn('m-0 font-quote text-quote italic', trigger && 'rounded bg-signal-soft px-2 py-1')}>
          «{e.quote}»
        </p>
        {e.note && (
          <span className={cn('max-w-[72ch] text-small', !trigger && 'text-muted')}>
            {withFamily(e.note, e.family)}
          </span>
        )}
      </article>
    )
  },
)
EvidenceCard.displayName = 'EvidenceCard'
