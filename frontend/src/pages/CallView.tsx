import { PrintFooter, PrintHeader, PrintTranscript } from '@/components/call/PrintReport'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Hourglass, TriangleAlert } from 'lucide-react'
import { Page } from '@/app/Page'
import { PageTitle } from '@/app/TopBar'
import { Tag } from '@/components/Tag'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { AudioPlayer, type AudioPlayerHandle } from '@/components/call/AudioPlayer'
import { ChecksTable } from '@/components/call/ChecksTable'
import { TwinBox } from '@/components/call/TwinBox'
import { EvidenceCard } from '@/components/call/EvidenceCard'
import { KeywordHits } from '@/components/call/KeywordHits'
import { Transcript } from '@/components/call/Transcript'
import { VerdictHeader, type FeedbackAction } from '@/components/call/VerdictHeader'
import { WhyUnclear, isUnclear } from '@/components/call/WhyUnclear'
import { ApiError, audioSource, getCall, retryCall } from '@/lib/api'
import { PAD_S, evidenceForTime, parseT, segmentAt } from '@/lib/deeplink'
import { formatDuration, formatProcessed, recordingName } from '@/lib/format'
import { useFeedback } from '@/lib/hooks'
import type { CallDetail, Evidence } from '@/lib/types'
import { t, tn } from '@/i18n'

function NotDecided({ detail }: { detail: CallDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const retry = useMutation({
    mutationFn: () => retryCall(detail.call.call_id),
    onSuccess: () => {
      toast(t('call.retried'))
      qc.invalidateQueries({ queryKey: ['call', detail.call.call_id] })
    },
    onError: (e: Error) => toast(t('call.retryFailed', { message: e.message }), 'error'),
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
            ? (detail.call.error ?? t('call.processingFailed'))
            : detail.call.status === 'waiting_for_asr'
              ? t('call.waitingAsr')
              : t('call.stillChecking')}
        </p>
        {failed && (
          <div>
            <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

/** Keyed by call ID, so moving to the twin call starts with a fresh player and focus state. */
export default function CallView() {
  const { id = '' } = useParams()
  return <CallPage key={id} id={id} />
}

function CallPage({ id }: { id: string }) {
  const [params, setParams] = useSearchParams()
  const { data, error, isPending } = useQuery({ queryKey: ['call', id], queryFn: () => getCall(id) })
  const feedback = useFeedback()

  const call = data?.call
  const rec = recordingName(call ?? { call_id: id, dialogue_id: null, variant: null })

  // Deep link: ?t= cues the call; the matching evidence card is focused. Clicks keep ?t= in sync.
  const linkT = parseT(params.get('t'))
  const [fromLink, setFromLink] = useState(() => linkT !== null)
  const [activeSeg, setActiveSeg] = useState<string | null>(null)
  const cardRefs = useRef(new Map<number, HTMLElement>())
  // From a link: the card matching t. After a click: the card of the clicked line, if it is evidence.
  const linked = useMemo(() => (data && linkT !== null ? evidenceForTime(data.evidence, linkT) : null), [data, linkT])
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

  const player = useRef<AudioPlayerHandle>(null)

  const cue = (seconds: number) => {
    params.set('t', String(Math.max(0, Math.floor(seconds))))
    setParams(params, { replace: true })
  }

  /** Transcript line or keyword hit: highlight the line and seek the audio there. */
  const selectSegment = (segId: string) => {
    const seg = data?.segments.find((s) => s.seg_id === segId)
    if (!seg) return
    setFromLink(false)
    setActiveSeg(segId)
    cue(seg.start_s)
    player.current?.seek(seg.start_s)
  }

  /** "Play passage": the passage with 10 s before and after. */
  const playPassage = (e: Evidence) => {
    setFromLink(false)
    setActiveSeg(e.seg_id)
    player.current?.playRange(e.start_s - PAD_S, e.end_s + PAD_S)
  }

  // While playing, the transcript follows the audio.
  const segments = data?.segments
  const onTime = useCallback(
    (time: number, playing: boolean) => {
      if (!playing || !segments) return
      const seg = segmentAt(segments, time)
      if (seg) setActiveSeg((cur) => (cur === seg.seg_id ? cur : seg.seg_id))
    },
    [segments],
  )

  const onFeedback = (a: FeedbackAction) => feedback.mutate({ callId: id, label: a.label, note: a.note })

  const title = (
    <>
      <Link to="/" className="inline-flex items-center gap-1 text-muted hover:text-graphite">
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        {t('nav.inbox')}
      </Link>
      <span className="text-line" aria-hidden="true">
        /
      </span>
      <PageTitle>{rec.name}</PageTitle>
      {rec.variant && <Tag>{rec.variant}</Tag>}
      {call && (
        <span className="text-small text-muted">
          {[formatDuration(call.duration_s), call.advisor_name, t('call.processedAt', { when: formatProcessed(call.processed_at) })]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </>
  )

  if (isPending || error || !data) {
    return (
      <Page title={title}>
        {isPending && <p className="text-muted">{t('call.loading')}</p>}
        {error && (
          <p role="alert">
            {t('call.openError', { id, message: error.message })}{' '}
            {error instanceof ApiError && error.status === 404 && (
              <>
                {t('call.checkLink')}{' '}
                <Link to="/calls" className="underline">
                  {t('nav.allCalls')}
                </Link>
                .
              </>
            )}
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
  const cueSeconds = linkT ?? 0

  return (
    <Page title={title}>
      <PrintHeader detail={data} />
      <VerdictHeader
        detail={data}
        busy={feedback.isPending}
        onFeedback={onFeedback}
        onOpenFullCall={() => {
          setFromLink(false)
          setActiveSeg(null)
          cue(0)
          player.current?.playRange(0, data.call.duration_s ?? Infinity)
        }}
      />

      <div className="-mt-2 flex flex-wrap items-start gap-6 print:mt-0 print:flex-col print:gap-5">
        <div className="flex min-w-0 flex-[4_1_480px] flex-col gap-4 print:w-full print:flex-none">
          <div className="print:hidden">
            <AudioPlayer
              ref={player}
              url={audioSource(data)}
              duration={data.call.duration_s ?? 0}
              segments={data.segments}
              evidence={data.evidence}
              cue={cueSeconds}
              onTime={onTime}
              onRegionClick={(e) => {
                setFromLink(false)
                setActiveSeg(e.seg_id)
              }}
            />
          </div>

          <div className="flex items-baseline justify-between gap-3 pt-2">
            <h3 className="text-subtitle font-medium">{t('call.evidenceTitle')}</h3>
            <span className="text-small text-muted">
              {tn('call.passages', data.evidence.length)}
              <span className="print:hidden">{t('call.playPadding')}</span>
            </span>
          </div>
          {data.evidence.length === 0 && (
            <p className="m-0 rounded-panel border border-line p-4 text-muted">{t('call.noPassages')}</p>
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
              onPlay={playPassage}
            />
          ))}
          {data.twin && <TwinBox twin={data.twin} verdict={decision.verdict} />}
        </div>

        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-4 print:w-full print:flex-none">
          <ChecksTable checks={data.checks} decision={decision} />
          {decision.verdict === 'review' && isUnclear(decidedCheck) && <WhyUnclear check={decidedCheck!} />}
          {data.keyword_hits.length > 0 && <KeywordHits hits={data.keyword_hits} onSelect={selectSegment} />}
          <Transcript
            segments={data.segments}
            evidenceSegs={evidenceSegs}
            activeSeg={activeSeg}
            onSelect={selectSegment}
          />
          <PrintTranscript segments={data.segments} evidenceSegs={evidenceSegs} />
        </div>
      </div>
      <PrintFooter />
    </Page>
  )
}
