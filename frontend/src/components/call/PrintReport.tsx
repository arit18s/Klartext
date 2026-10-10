import type { CallDetail, Segment } from '@/lib/types'
import { FAMILY_LABEL, VERDICT_LABEL, formatDuration, formatTimestamp, recordingName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { speaker } from './labels'

// Print-only parts of the call report (D30: "Download report" = browser print to PDF, A4 portrait).
// Hidden on screen; the rest of the report is the call view itself with its controls hidden in print.

const CONTEXT_LINES = 1 // transcript lines kept before and after each evidence line

const absolute = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(
        new Date(iso),
      )
    : '–'

/** Title block: what was checked, when, and with which thresholds. */
export function PrintHeader({ detail }: { detail: CallDetail }) {
  const { call, decision } = detail
  const rec = recordingName(call)
  const rows: [string, string][] = [
    ['Recording', `${call.call_id}${rec.variant ? ` (${rec.variant})` : ''}`],
    ['Advisor', call.advisor_name ?? '–'],
    ['Length', formatDuration(call.duration_s)],
    ['Processed', absolute(call.processed_at)],
    [
      'Decided',
      `${absolute(decision?.decided_at ?? null)} · thresholds version ${decision?.thresholds_version_id ?? '–'}`,
    ],
    ['Printed', absolute(new Date().toISOString())],
  ]
  return (
    <section aria-hidden="true" className="hidden print:block">
      <div className="flex items-baseline justify-between border-b border-graphite pb-2">
        <span className="text-title font-semibold">Klartext call report</span>
        <span className="text-small text-muted">
          {decision ? VERDICT_LABEL[decision.verdict] : 'Not decided'}
          {decision?.family ? ` · ${FAMILY_LABEL[decision.family]}` : ''}
        </span>
      </div>
      <dl className="m-0 mt-3 grid grid-cols-[96px_1fr_96px_1fr] gap-x-3 gap-y-1 text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Evidence lines with their neighbours, in time order; skipped stretches show as "…". */
export function excerpt(segments: Segment[], evidenceSegs: Set<string>, context = CONTEXT_LINES): (Segment | null)[] {
  const keep = new Set<number>()
  segments.forEach((s, i) => {
    if (!evidenceSegs.has(s.seg_id)) return
    for (let j = Math.max(0, i - context); j <= Math.min(segments.length - 1, i + context); j++) keep.add(j)
  })
  const out: (Segment | null)[] = []
  let last = -1
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1) out.push(null)
    out.push(segments[i])
    last = i
  }
  if (out.length && last < segments.length - 1) out.push(null)
  return out
}

export function PrintTranscript({ segments, evidenceSegs }: { segments: Segment[]; evidenceSegs: Set<string> }) {
  const lines = excerpt(segments, evidenceSegs)
  if (lines.length === 0) return null
  return (
    <section aria-hidden="true" className="hidden break-before-auto print:block">
      <h3 className="text-subtitle font-medium">Transcript around the evidence</h3>
      <p className="m-0 mb-2 text-small text-muted">
        Evidence lines highlighted, one line before and after each. As transcribed; listen before acting.
      </p>
      <div className="flex flex-col">
        {lines.map((s, i) =>
          s ? (
            <div
              key={s.seg_id}
              className={cn(
                'grid break-inside-avoid grid-cols-[44px_68px_minmax(0,1fr)] gap-2 rounded-control px-2 py-1.5',
                evidenceSegs.has(s.seg_id) && 'bg-signal-soft',
              )}
            >
              <span className="tabular text-small text-muted">{formatTimestamp(s.start_s)}</span>
              <span className="text-small font-medium text-graphite-soft">{speaker(s.role)}</span>
              <span>
                {s.text}
                {s.low_confidence && <span className="text-small text-muted"> (low transcription confidence)</span>}
              </span>
            </div>
          ) : (
            <div key={`gap-${i}`} className="px-2 py-0.5 text-muted">
              …
            </div>
          ),
        )}
      </div>
    </section>
  )
}

export function PrintFooter() {
  return (
    <p aria-hidden="true" className="m-0 hidden border-t border-line pt-2 text-small text-muted print:block">
      The verdict is computed by Klartext&apos;s decision rule from the check results; it is a hint for a compliance
      officer, not a finding. Quotes are shown as transcribed.
    </p>
  )
}
