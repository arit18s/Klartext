import { useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudUpload, Download, Folder, Pause, Play, RotateCw, TriangleAlert } from 'lucide-react'
import { Page } from '@/app/Page'
import { useToast } from '@/components/Toast'
import { VerdictChip } from '@/components/VerdictChip'
import { Button } from '@/components/ui/button'
import {
  USE_FIXTURES,
  exportCsv,
  exportJson,
  getPipelineStatus,
  processFolder,
  retryCall,
  setWatching,
  uploadToInbox,
} from '@/lib/api'
import { VERDICT_LABEL, formatClock, formatDuration } from '@/lib/format'
import type { PipelineItem, PipelineStage, PipelineStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { labels, t } from '@/i18n'

const STAGES: PipelineStage[] = ['transcribing', 'diarizing', 'checking', 'deciding']
const STAGE_LABEL: Record<PipelineStage, string> = labels({
  queued: 'stage.queued',
  transcribing: 'stage.transcribing',
  diarizing: 'stage.diarizing',
  checking: 'stage.checking',
  deciding: 'stage.deciding',
  done: 'stage.done',
  failed: 'stage.failed',
  waiting_for_asr: 'stage.waiting_for_asr',
})

function ago(iso: string | null): string {
  if (!iso) return t('pipeline.noFile')
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return t('pipeline.justNow')
  const m = Math.round(s / 60)
  if (m < 60) return t('pipeline.minAgo', { n: m })
  return t('pipeline.lastAt', { time: formatClock(iso) })
}

function took(s: number | null) {
  if (s === null) return null
  const r = Math.round(s)
  return r < 60
    ? t('pipeline.seconds', { s: r })
    : t('pipeline.minutes', { m: Math.floor(r / 60), s: String(r % 60).padStart(2, '0') })
}

/** Four segments, one per stage: done segments graphite, the current one mid grey. */
function StageBar({ stage }: { stage: PipelineStage }) {
  const at = stage === 'done' ? STAGES.length : STAGES.indexOf(stage)
  return (
    <span className="flex gap-1" aria-hidden="true">
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={cn('h-[3px] w-4 rounded-full', i < at ? 'bg-graphite' : i === at ? 'bg-muted' : 'bg-line')}
        />
      ))}
    </span>
  )
}

function ProgressCell({ item }: { item: PipelineItem }) {
  if (item.stage === 'failed')
    return (
      <span className="block min-w-[260px] whitespace-normal text-graphite">{item.error ?? t('pipeline.failedProcessing')}</span>
    )
  if (item.stage === 'done')
    return (
      <span className="text-small text-muted">
        {[took(item.elapsed_s), item.trigger_sent ? t('pipeline.sentToOutcept') : null].filter(Boolean).join(' · ') || '–'}
      </span>
    )
  if (item.progress === null || item.progress === undefined)
    return <span className="text-small text-muted">{item.progress_note ?? t('pipeline.working')}</span>
  const pct = Math.round(item.progress * 100)
  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${STAGE_LABEL[item.stage]} ${item.file_name}`}
        className="block h-1 w-28 overflow-hidden rounded-sm bg-line"
      >
        <span className="block h-1 rounded-sm bg-graphite transition-[width]" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-small text-muted">
        {pct}%{item.progress_note ? ` · ${item.progress_note}` : ''}
      </span>
    </span>
  )
}

const th = 'h-10 whitespace-nowrap border-b border-line px-4 text-left text-small font-medium text-muted'
const td = 'h-12 whitespace-nowrap border-b border-line px-4'

function Queue({
  status,
  onRetry,
  retrying,
}: {
  status: PipelineStatus
  onRetry: (id: string) => void
  retrying: boolean
}) {
  // Working and failed items first, then the latest finished ones.
  const rows = [...status.queue, ...status.recent.slice(0, 5)]
  return (
    <section aria-label={t('pipeline.queue')} className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">{t('pipeline.queue')}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-small text-muted">
          {t('pipeline.stages')}
          {STAGES.map((s) => (
            <span
              key={s}
              className="inline-flex h-[22px] items-center rounded-full border border-line px-2 text-[12px]"
            >
              {STAGE_LABEL[s]}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('pipeline.file')}</th>
              <th className={th}>{t('pipeline.stage')}</th>
              <th className={th}>{t('pipeline.progress')}</th>
              <th className={cn(th, 'text-right')}>{t('pipeline.length')}</th>
              <th className={th}>{t('pipeline.result')}</th>
            </tr>
          </thead>
          <tbody aria-live="polite">
            {rows.map((q) => (
              <tr
                key={`${q.call_id}-${q.stage === 'done' ? 'done' : 'q'}`}
                className={q.stage === 'failed' ? 'bg-alarm-soft' : 'hover:bg-canvas'}
              >
                <td className={cn(td, 'font-medium')}>{q.file_name}</td>
                <td className={td}>
                  {q.stage === 'failed' ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-alarm">
                      <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                      {STAGE_LABEL.failed}
                    </span>
                  ) : (
                    <span className="flex min-w-[150px] items-center gap-2.5 whitespace-normal">
                      <StageBar stage={q.stage} />
                      {STAGE_LABEL[q.stage]}
                    </span>
                  )}
                </td>
                <td className={cn(td, 'max-w-[380px] py-2')}>
                  <ProgressCell item={q} />
                </td>
                <td className={cn(td, 'tabular text-right')}>{formatDuration(q.duration_s)}</td>
                <td className={td}>
                  {q.stage === 'failed' ? (
                    <Button size="sm" onClick={() => onRetry(q.call_id)} disabled={retrying}>
                      <RotateCw strokeWidth={1.75} aria-hidden="true" />
                      {t('common.retry')}
                    </Button>
                  ) : q.verdict ? (
                    <VerdictChip verdict={q.verdict} />
                  ) : (
                    <span className="text-muted">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="m-0 px-4 py-8 text-center text-muted">
            {t('pipeline.nothing')}
          </p>
        )}
      </div>
    </section>
  )
}

function DropZone({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    onFiles([...e.dataTransfer.files])
  }
  return (
    <section
      aria-label={t('pipeline.dropLabel')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-panel border border-dashed p-6 text-center',
        over ? 'border-graphite bg-canvas' : 'border-[#C9CBCF]',
      )}
    >
      <CloudUpload size={24} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
      <span className="font-medium">{t('pipeline.dropTitle')}</span>
      <span className="max-w-[44ch] text-small text-muted">
        {t('pipeline.dropBody')}
      </span>
      <input
        ref={input}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <Button className="mt-1" onClick={() => input.current?.click()} disabled={busy}>
        {t('pipeline.choose')}
      </Button>
    </section>
  )
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  URL.revokeObjectURL(url)
}

function Batch({ status }: { status: PipelineStatus }) {
  const toast = useToast()
  const [path, setPath] = useState('/data/klartext/hidden_test')
  const run = useMutation({
    mutationFn: () => processFolder(path.trim()),
    onSuccess: (r) => {
      const parts = [
        t('pipeline.queued', { n: r.enqueued }),
        r.skipped_duplicates ? t('pipeline.already', { n: r.skipped_duplicates }) : null,
        r.rejected.length ? t('pipeline.rejected', { n: r.rejected.length }) : null,
      ]
      toast(t('pipeline.processingPath', { path: r.path, parts: parts.filter(Boolean).join(', ') }))
      for (const x of r.rejected) toast(`${x.file_name}: ${x.error}`, 'error')
    },
    onError: (e: Error) => toast(t('pipeline.folderFailed', { message: e.message }), 'error'),
  })
  const download = (format: 'json' | 'csv') => async () => {
    try {
      save(format === 'json' ? await exportJson() : await exportCsv(), `klartext-results.${format}`)
      toast(t('pipeline.downloaded', { format: format.toUpperCase() }))
    } catch (e) {
      toast(t('pipeline.downloadFailed', { message: (e as Error).message }), 'error')
    }
  }
  const b = status.last_batch
  return (
    <section aria-label={t('pipeline.batch')} className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5">
      <h3 className="text-subtitle font-medium">{t('pipeline.batch')}</h3>
      <p className="m-0 text-muted">{t('pipeline.batchIntro')}</p>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">{t('pipeline.folder')}</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="h-9 rounded-control border border-line px-3"
          spellCheck={false}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!path.trim() || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? t('pipeline.processing') : t('pipeline.processFolder')}
        </Button>
        <Button onClick={download('json')}>
          <Download strokeWidth={1.75} aria-hidden="true" />
          {t('pipeline.downloadJson')}
        </Button>
        <Button onClick={download('csv')}>
          <Download strokeWidth={1.75} aria-hidden="true" />
          {t('pipeline.downloadCsv')}
        </Button>
      </div>
      <span className="text-small text-muted">
        {b
          ? t('pipeline.lastBatch', { files: b.files, took: took(b.duration_s) ?? '–', failed: b.failed })
          : t('pipeline.noBatch')}
      </span>
    </section>
  )
}

function RecentRuns({ status }: { status: PipelineStatus }) {
  const items = [...status.queue.filter((q) => q.stage === 'failed'), ...status.recent].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )
  return (
    <section aria-label={t('pipeline.recent')} className="flex flex-col gap-1 rounded-panel border border-line bg-paper p-5">
      <h3 className="mb-2 text-subtitle font-medium">{t('pipeline.recent')}</h3>
      {items.length === 0 && <p className="m-0 text-muted">{t('pipeline.noRuns')}</p>}
      <ol className="m-0 list-none p-0">
        {items.slice(0, 8).map((q) => (
          <li
            key={`${q.call_id}-${q.updated_at}`}
            className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 border-b border-line py-3 last:border-b-0"
          >
            <span className="tabular text-small text-muted">{formatClock(q.updated_at)}</span>
            <span className={q.stage === 'failed' ? 'text-alarm' : ''}>
              {q.file_name}
              {q.stage === 'failed'
                ? t('pipeline.transcriptionFailed')
                : ` · ${q.verdict ? VERDICT_LABEL[q.verdict] : STAGE_LABEL.done}${q.score !== null ? t('pipeline.scoreN', { n: Math.round(q.score) }) : ''}${q.trigger_sent ? t('pipeline.posted') : ''}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function Pipeline() {
  const qc = useQueryClient()
  const toast = useToast()
  const status = useQuery({ queryKey: ['pipeline'], queryFn: getPipelineStatus, retry: false })
  const watch = useMutation({
    mutationFn: (enabled: boolean) => setWatching(enabled),
    onSuccess: (r) => {
      toast(r.watching ? t('pipeline.resumed') : t('pipeline.paused'))
      qc.setQueryData<PipelineStatus>(['pipeline'], (old) => (old ? { ...old, watching: r.watching } : old))
    },
    onError: (e: Error) => toast(t('pipeline.watchFailed', { message: e.message }), 'error'),
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const r = await uploadToInbox(f)
        toast(
          r.duplicate ? t('pipeline.duplicate', { name: r.file_name }) : t('pipeline.copied', { name: r.file_name }),
        )
      }
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const retry = useMutation({
    mutationFn: (id: string) => retryCall(id),
    onSuccess: (r) => toast(t('pipeline.retrying', { id: r.call_id })),
    onError: (e: Error) => toast(t('call.retryFailed', { message: e.message }), 'error'),
  })
  const s = status.data

  return (
    <Page
      title={t('nav.pipeline')}
      heading={t('pipeline.heading')}
      intro={t('pipeline.intro')}
    >
      {USE_FIXTURES && (
        <p className="-mt-4 m-0 text-small text-muted">
          {t('pipeline.fixture')}
        </p>
      )}
      {status.isPending && <p className="m-0 text-muted">{t('pipeline.loading')}</p>}
      {status.error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>{t('pipeline.loadError', { message: status.error.message })}</span>
          <Button onClick={() => status.refetch()}>{t('common.tryAgain')}</Button>
        </div>
      )}
      {s && (
        <>
          <section
            aria-label={t('pipeline.inbox')}
            className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-paper p-5"
          >
            <div className="flex items-center gap-4">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-panel bg-canvas">
                <Folder size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t('pipeline.inbox')}</span>
                  <span
                    className={cn(
                      'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium',
                      s.watching ? 'bg-clear-soft text-clear' : 'bg-canvas text-muted',
                    )}
                  >
                    <span
                      className={cn('h-1.5 w-1.5 rounded-full', s.watching ? 'bg-clear' : 'bg-muted')}
                      aria-hidden="true"
                    />
                    {s.watching ? t('pipeline.watching') : t('pipeline.pausedChip')}
                  </span>
                </div>
                <span className="text-muted">
                  {s.inbox_dir} · {t('pipeline.checkedEvery', { n: s.poll_interval_s })} · {ago(s.last_file_at)}
                </span>
              </div>
            </div>
            <Button onClick={() => watch.mutate(!s.watching)} disabled={watch.isPending}>
              {s.watching ? (
                <Pause strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Play strokeWidth={1.75} aria-hidden="true" />
              )}
              {s.watching ? t('pipeline.pause') : t('pipeline.resume')}
            </Button>
          </section>
          {!s.watching && s.queue.some((q) => q.stage === 'queued') && (
            <p className="-mt-4 m-0 text-small text-muted">
              {t('pipeline.pausedNote')}
            </p>
          )}

          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-0 flex-[4_1_840px] flex-col gap-6">
              <Queue status={s} onRetry={(id) => retry.mutate(id)} retrying={retry.isPending} />
            </div>
            <div className="grid min-w-0 flex-[1_1_360px] grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-6">
              <DropZone onFiles={(f) => f.length && upload.mutate(f)} busy={upload.isPending} />
              <Batch status={s} />
              <RecentRuns status={s} />
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
