import { useEffect, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { Segment } from '@/lib/types'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { speaker } from './labels'

/** Speaker-labelled segments. Evidence lines are yellow; the active line has an inset ring. Click to jump there. */
export function Transcript({
  segments,
  evidenceSegs,
  activeSeg,
  onSelect,
}: {
  segments: Segment[]
  evidenceSegs: Set<string>
  activeSeg: string | null
  onSelect: (segId: string) => void
}) {
  const refs = useRef(new Map<string, HTMLDivElement>())
  const box = useRef<HTMLDivElement>(null)

  // Scroll only the transcript box, never the page (the page scroll belongs to the deep-linked evidence card).
  useEffect(() => {
    const el = activeSeg ? refs.current.get(activeSeg) : null
    const container = box.current
    if (!el || !container) return
    const top = el.offsetTop // the box is the offsetParent (position: relative)
    if (top < container.scrollTop || top + el.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 3)
    }
  }, [activeSeg])

  return (
    <section aria-label="Transcript" className="flex flex-col print:hidden rounded-panel border border-line bg-paper">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-subtitle font-medium">Transcript</h3>
        <span className="text-small text-muted">Click a line to jump there</span>
      </div>
      <div ref={box} className="relative flex max-h-[560px] flex-col overflow-y-auto px-1 pb-3 pt-1">
        {segments.map((s) => {
          const hl = evidenceSegs.has(s.seg_id)
          const active = s.seg_id === activeSeg
          return (
            <div
              key={s.seg_id}
              ref={(el) => {
                if (el) refs.current.set(s.seg_id, el)
                else refs.current.delete(s.seg_id)
              }}
              role="button"
              tabIndex={0}
              aria-current={active ? 'true' : undefined}
              aria-label={`${formatTimestamp(s.start_s)} ${speaker(s.role)}: ${s.text}`}
              onClick={() => onSelect(s.seg_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(s.seg_id)
                }
              }}
              className={cn(
                'grid cursor-pointer grid-cols-[48px_72px_minmax(0,1fr)] gap-2 rounded-control px-3 py-2.5',
                hl ? 'bg-signal-soft' : 'hover:bg-canvas',
                active && 'shadow-[inset_0_0_0_2px_rgb(var(--graphite))]',
              )}
            >
              <span className={cn('tabular text-small', hl ? 'text-graphite' : 'text-muted')}>
                {formatTimestamp(s.start_s)}
              </span>
              <span className="text-small font-medium text-graphite-soft">{speaker(s.role)}</span>
              <span className="flex flex-col gap-1">
                <span>{s.text}</span>
                {s.low_confidence && (
                  <span className="inline-flex items-center gap-1.5 text-small text-muted">
                    <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
                    Low transcription confidence. Listen to confirm.
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
