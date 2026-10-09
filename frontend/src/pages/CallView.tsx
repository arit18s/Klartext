import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Hourglass, TriangleAlert } from 'lucide-react'
import { Page } from '@/app/Page'
import { PageTitle } from '@/app/TopBar'
import { Tag } from '@/components/Tag'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { ChecksTable } from '@/components/call/ChecksTable'
import { EvidenceCard } from '@/components/call/EvidenceCard'
import { KeywordHits } from '@/components/call/KeywordHits'
import { Transcript } from '@/components/call/Transcript'
import { VerdictHeader, type FeedbackAction } from '@/components/call/VerdictHeader'
import { WhyUnclear, isUnclear } from '@/components/call/WhyUnclear'
import { getCall, retryCall } from '@/lib/api'
import { evidenceForTime, parseT } from '@/lib/deeplink'
import { formatDuration, formatProcessed, formatTimestamp, recordingName } from '@/lib/format'
import { useFeedback } from '@/lib/hooks'
import type { CallDetail } from '@/lib/types'

function NotDecided({ detail }: { detail: CallDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const retry = useMutation({
    mutationFn: () => retryCall(detail.call.call_id),
    onSuccess: () => {
      toast('Retried')
      qc.invalidateQueries({ queryKey: ['call', detail.call.call_id] })
    },
    onError: (e: Error) => toast(`Retry failed. ${e.message}`, 'error'),
  })
  const failed = detail.call.status === 'failed'
  return (
    <section className="flex items-start gap-3 rounded-panel border border-line p-6">
      {failed ? (
        <TriangleAlert size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 flex-none text-alarm" />
      ) : (
        <Hourglass size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 flex-none text-muted" />
      )}
      <div className="flex flex-col gap-3">
        <p className="m-0">
          {failed
            ? (detail.call.error ?? 'Processing failed for this call.')
            : 'Klartext is still checking this call. The verdict appears here when it is ready.'}
        </p>
        {failed && (
          <div>
            <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

export default function CallView() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { data, error, isPending } = useQuery({ queryKey: ['call', id], queryFn: () => getCall(id) })
  const feedback = useFeedback()

  const call = data?.call
  const rec = recordingName(call ?? { call_id: id, dialogue_id: null, variant: null })

  // Deep link: ?t= cues the call; the matching evidence card is focused. Clicks keep ?t= in sync.
  const t = parseT(params.get('t'))
  const [fromLink, setFromLink] = useState(() => t !== null)
  const [activeSeg, setActiveSeg] = useState<string | null>(null)
  const cardRefs = useRef(new Map<number, HTMLElement>())
  // From a link: the card matching t. After a click: the card of the clicked line, if it is evidence.
  const linked = useMemo(() => (data && t !== null ? evidenceForTime(data.evidence, t) : null), [data, t])
  const focused = fromLink ? linked : (data?.evidence.find((e) => e.seg_id === activeSeg) ?? null)
  const evidenceSegs = useMemo(() => new Set(data?.evidence.map((e) => e.seg_id)), [data])

  useEffect(() => {
    if (!fromLink || !linked) return
    setActiveSeg(linked.seg_id)
    const el = cardRefs.current.get(linked.id)
    el?.scrollIntoView({ block: 'center' })
    el?.focus({ preventScroll: true })
    // Only when the link first resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked?.id])

  const cue = (seconds: number) => {
    params.set('t', String(Math.max(0, Math.floor(seconds))))
    setParams(params, { replace: true })
  }

  const selectSegment = (segId: string) => {
    const seg = data?.segments.find((s) => s.seg_id === segId)
    if (!seg) return
    setFromLink(false)
    setActiveSeg(segId)
    cue(seg.start_s)
  }

  const onFeedback = (a: FeedbackAction) => feedback.mutate({ callId: id, label: a.label, note: a.note })

  const title = (
    <>
      <Link to="/" className="inline-flex items-center gap-1 text-muted hover:text-graphite">
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        Inbox
      </Link>
      <span className="text-line" aria-hidden="true">
        /
      </span>
      <PageTitle>{rec.name}</PageTitle>
      {rec.variant && <Tag>{rec.variant}</Tag>}
      {call && (
        <span className="text-small text-muted">
          {[formatDuration(call.duration_s), call.advisor_name, `processed ${formatProcessed(call.processed_at)}`]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </>
  )

  if (isPending || error || !data) {
    return (
      <Page title={title}>
        {isPending && <p className="text-muted">Loading call…</p>}
        {error && (
          <p role="alert">
            Could not open {id}. {error.message} Open it again from{' '}
            <Link to="/calls" className="underline">
              All calls
            </Link>
            .
          </p>
        )}
      </Page>
    )
  }

  if (!data.decision) {
    return (
      <Page title={title}>
        <NotDecided detail={data} />
      </Page>
    )
  }

  const decision = data.decision
  const decidedCheck = data.checks.find((c) => c.family === decision.family)
  const cueSeconds = t ?? 0

  return (
    <Page title={title}>
      <VerdictHeader
        detail={data}
        busy={feedback.isPending}
        onFeedback={onFeedback}
        onOpenFullCall={() => {
          setFromLink(false)
          setActiveSeg(null)
          cue(0)
        }}
      />

      <div className="-mt-2 flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[4_1_480px] flex-col gap-4">
          <section aria-label="Audio" className="flex flex-col gap-2 rounded-panel border border-line bg-paper p-5">
            <span className="tabular">
              <b className="font-semibold">{formatTimestamp(cueSeconds)}</b>{' '}
              <span className="text-muted">/ {formatTimestamp(data.call.duration_s ?? 0)}</span>
            </span>
            <p className="m-0 text-small text-muted">Waveform and playback are built in step F4.</p>
          </section>

          <div className="flex items-baseline justify-between gap-3 pt-2">
            <h3 className="text-subtitle font-medium">Evidence, in time order</h3>
            <span className="text-small text-muted">
              {data.evidence.length} {data.evidence.length === 1 ? 'passage' : 'passages'} · play adds 10 s before and
              after
            </span>
          </div>
          {data.evidence.length === 0 && (
            <p className="m-0 rounded-panel border border-line p-4 text-muted">No passages were cited for this call.</p>
          )}
          {data.evidence.map((e) => (
            <EvidenceCard
              key={e.id}
              ref={(el) => {
                if (el) cardRefs.current.set(e.id, el)
                else cardRefs.current.delete(e.id)
              }}
              evidence={e}
              focused={focused?.id === e.id}
              fromLink={fromLink}
            />
          ))}
        </div>

        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-4">
          <ChecksTable checks={data.checks} decision={decision} />
          {decision.verdict === 'review' && isUnclear(decidedCheck) && <WhyUnclear check={decidedCheck!} />}
          {data.keyword_hits.length > 0 && <KeywordHits hits={data.keyword_hits} onSelect={selectSegment} />}
          <Transcript
            segments={data.segments}
            evidenceSegs={evidenceSegs}
            activeSeg={activeSeg}
            onSelect={selectSegment}
          />
        </div>
      </div>
    </Page>
  )
}
