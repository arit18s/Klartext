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

const STAGES: PipelineStage[] = ['transcribing', 'diarizing', 'checking', 'deciding']
const STAGE_LABEL: Record<PipelineStage, string> = {
  queued: 'Waiting',
  transcribing: 'Transcribing',
  diarizing: 'Separating speakers',
  checking: 'Checking',
  deciding: 'Deciding',
  done: 'Done',
  failed: 'Failed',
  waiting_for_asr: 'Waiting for speech service',
}

function ago(iso: string | null): string {
  if (!iso) return 'no file yet'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'last file just now'
  const m = Math.round(s / 60)
  if (m < 60) return `last file ${m} min ago`
  return `last file at ${formatClock(iso)}`
}

function took(s: number | null) {
  if (s === null) return null
  const r = Math.round(s)
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`
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
      <span className="block min-w-[260px] whitespace-normal text-graphite">{item.error ?? 'Processing failed.'}</span>
    )
  if (item.stage === 'done')
    return (
      <span className="text-small text-muted">
        {[took(item.elapsed_s), item.trigger_sent ? 'sent to Outcept' : null].filter(Boolean).join(' · ') || '–'}
      </span>
    )
  if (item.progress === null || item.progress === undefined)
    return <span className="text-small text-muted">{item.progress_note ?? 'Working…'}</span>
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
    <section aria-label="Queue" className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">Queue</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-small text-muted">
          Stages
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
              <th className={th}>File</th>
              <th className={th}>Stage</th>
              <th className={th}>Progress</th>
              <th className={cn(th, 'text-right')}>Length</th>
              <th className={th}>Result</th>
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
                      Failed
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
                      Retry
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
            Nothing processed yet. Drop a WAV file or process a folder.
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
      aria-label="Drop a recording"
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
      <span className="font-medium">Drop a WAV file here</span>
      <span className="max-w-[44ch] text-small text-muted">
        It is copied into the inbox folder. The watcher picks it up like any other recording.
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
        Choose file
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
        `${r.enqueued} queued`,
        r.skipped_duplicates ? `${r.skipped_duplicates} already processed` : null,
        r.rejected.length ? `${r.rejected.length} rejected` : null,
      ]
      toast(`Processing ${r.path}: ${parts.filter(Boolean).join(', ')}`)
      for (const x of r.rejected) toast(`${x.file_name}: ${x.error}`, 'error')
    },
    onError: (e: Error) => toast(`The folder was not processed. ${e.message}`, 'error'),
  })
  const download = (format: 'json' | 'csv') => async () => {
    try {
      save(format === 'json' ? await exportJson() : await exportCsv(), `klartext-results.${format}`)
      toast(`Downloaded ${format.toUpperCase()}`)
    } catch (e) {
      toast(`The download failed. ${(e as Error).message}`, 'error')
    }
  }
  const b = status.last_batch
  return (
    <section aria-label="Batch mode" className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5">
      <h3 className="text-subtitle font-medium">Batch mode</h3>
      <p className="m-0 text-muted">
        For the hidden test set. Point Klartext at a folder, process every file, then download one results file.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">Folder</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="h-9 rounded-control border border-line px-3"
          spellCheck={false}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!path.trim() || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Processing…' : 'Process folder'}
        </Button>
        <Button onClick={download('json')}>
          <Download strokeWidth={1.75} aria-hidden="true" />
          Download JSON
        </Button>
        <Button onClick={download('csv')}>
          <Download strokeWidth={1.75} aria-hidden="true" />
          Download CSV
        </Button>
      </div>
      <span className="text-small text-muted">
        {b ? `Last batch: ${b.files} files, ${took(b.duration_s)}, ${b.failed} failed` : 'No batch has run yet.'}
      </span>
    </section>
  )
}

function RecentRuns({ status }: { status: PipelineStatus }) {
  const items = [...status.queue.filter((q) => q.stage === 'failed'), ...status.recent].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )
  return (
    <section aria-label="Recent runs" className="flex flex-col gap-1 rounded-panel border border-line bg-paper p-5">
      <h3 className="mb-2 text-subtitle font-medium">Recent runs</h3>
      {items.length === 0 && <p className="m-0 text-muted">No runs yet.</p>}
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
                ? ' · transcription failed'
                : ` · ${q.verdict ? VERDICT_LABEL[q.verdict] : 'Done'}${q.score !== null ? `, score ${Math.round(q.score)}` : ''}${q.trigger_sent ? ' · posted to Outcept' : ''}`}
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
      toast(r.watching ? 'Resumed watching' : 'Paused watching')
      qc.setQueryData<PipelineStatus>(['pipeline'], (old) => (old ? { ...old, watching: r.watching } : old))
    },
    onError: (e: Error) => toast(`Watching did not change. ${e.message}`, 'error'),
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const r = await uploadToInbox(f)
        toast(
          r.duplicate ? `${r.file_name} was processed before. Skipped.` : `Copied ${r.file_name} into the inbox folder`,
        )
      }
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const retry = useMutation({
    mutationFn: (id: string) => retryCall(id),
    onSuccess: (r) => toast(`Retrying ${r.call_id}`),
    onError: (e: Error) => toast(`Retry failed. ${e.message}`, 'error'),
  })
  const s = status.data

  return (
    <Page
      title="Pipeline"
      heading="Runs on its own"
      intro="Klartext watches the inbox folder. Every recording that lands there is transcribed, checked and decided with no one clicking anything."
    >
      {USE_FIXTURES && (
        <p className="-mt-4 m-0 text-small text-muted">
          Fixture mode: no backend is running. A dropped file or a processed folder plays back a stored result through
          every stage.
        </p>
      )}
      {status.isPending && <p className="m-0 text-muted">Loading the pipeline…</p>}
      {status.error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>The pipeline is not reachable. {status.error.message} Start the backend and try again.</span>
          <Button onClick={() => status.refetch()}>Try again</Button>
        </div>
      )}
      {s && (
        <>
          <section
            aria-label="Inbox folder"
            className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-paper p-5"
          >
            <div className="flex items-center gap-4">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-panel bg-canvas">
                <Folder size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Inbox folder</span>
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
                    {s.watching ? 'Watching' : 'Paused'}
                  </span>
                </div>
                <span className="text-muted">
                  {s.inbox_dir} · checked every {s.poll_interval_s} s · {ago(s.last_file_at)}
                </span>
              </div>
            </div>
            <Button onClick={() => watch.mutate(!s.watching)} disabled={watch.isPending}>
              {s.watching ? (
                <Pause strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Play strokeWidth={1.75} aria-hidden="true" />
              )}
              {s.watching ? 'Pause watching' : 'Resume watching'}
            </Button>
          </section>
          {!s.watching && s.queue.some((q) => q.stage === 'queued') && (
            <p className="-mt-4 m-0 text-small text-muted">
              Watching is paused. New files wait in the queue until you resume.
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
