import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { Pause, Play } from 'lucide-react'
import type { Evidence, Segment } from '@/lib/types'
import { formatDuration, formatTimestamp } from '@/lib/format'
import { Button } from '../ui/button'
import { speaker } from './labels'

export interface AudioPlayerHandle {
  /** Seek without playing. */
  seek: (t: number) => void
  /** Play [start, end] (a passage with its padding). */
  playRange: (start: number, end: number) => void
}

const RATES = [1, 1.5, 2, 0.75]
// 04_FRONTEND_GUIDELINES.md section 6: bars #C9CBCF, played part graphite, evidence signal at 85%.
const BAR = '#C9CBCF'
const PLAYED = '#1E2126'
const EVIDENCE = 'rgba(242, 199, 68, 0.85)'
const ROLE = { context: 'Context', trigger: 'Trigger', exclusion: 'Exclusion' }

function ticks(duration: number): number[] {
  const step = [15, 30, 45, 60, 120, 300].find((s) => duration / s <= 6) ?? 600
  const out: number[] = []
  for (let t = 0; t < duration - step / 3; t += step) out.push(t)
  return [...out, duration]
}

/**
 * Full-call waveform (wavesurfer.js + Regions): yellow evidence regions, played part graphite, speaker lanes
 * underneath. Click the waveform or a lane to seek; click a region to seek to its passage.
 */
export const AudioPlayer = forwardRef<
  AudioPlayerHandle,
  {
    url: string
    duration: number
    segments: Segment[]
    evidence: Evidence[]
    cue: number
    onTime: (t: number, playing: boolean) => void
    onRegionClick: (e: Evidence) => void
  }
>(({ url, duration, segments, evidence, cue, onTime, onRegionClick }, ref) => {
  const box = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const [time, setTime] = useState(cue)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [rate, setRate] = useState(0)
  const callbacks = useRef({ onTime, onRegionClick })
  callbacks.current = { onTime, onRegionClick }

  useEffect(() => {
    if (!box.current) return
    const regions = RegionsPlugin.create()
    const w = WaveSurfer.create({
      container: box.current,
      url,
      height: 72,
      waveColor: BAR,
      progressColor: PLAYED,
      cursorColor: PLAYED,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      barRadius: 1,
      normalize: true,
      dragToSeek: true,
      plugins: [regions],
    })
    ws.current = w
    w.on('ready', () => {
      setReady(true)
      w.setTime(Math.min(cue, w.getDuration()))
      for (const e of evidence) {
        const r = regions.addRegion({
          id: String(e.id),
          start: e.start_s,
          end: e.end_s,
          color: EVIDENCE,
          drag: false,
          resize: false,
        })
        const el = r.element
        if (!el) continue
        el.title = `${ROLE[e.role]} ${formatTimestamp(e.start_s)}–${formatTimestamp(e.end_s)}`
        // Multiply keeps the bars visible through the yellow fill.
        el.style.mixBlendMode = 'multiply'
        el.style.borderRadius = '4px'
      }
    })
    w.on('error', (err) => setFailed(String(err)))
    w.on('timeupdate', (t) => {
      setTime(t)
      callbacks.current.onTime(t, w.isPlaying())
    })
    w.on('play', () => setPlaying(true))
    w.on('pause', () => setPlaying(false))
    regions.on('region-clicked', (r, e) => {
      e.stopPropagation()
      const ev = evidence.find((x) => String(x.id) === r.id)
      w.setTime(r.start)
      if (ev) callbacks.current.onRegionClick(ev)
    })
    return () => w.destroy()
    // Recreate only when the recording changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useImperativeHandle(ref, () => ({
    seek: (t) => ws.current?.setTime(Math.max(0, t)),
    playRange: (start, end) => void ws.current?.play(Math.max(0, start), Math.min(end, ws.current.getDuration())),
  }))

  const lanes = useMemo(
    () => (['advisor', 'customer'] as const).map((role) => ({ role, segs: segments.filter((s) => s.role === role) })),
    [segments],
  )
  const clamp = (t: number) => Math.max(0, Math.min(duration, t))
  const pct = (t: number) => `${(clamp(t) / duration) * 100}%`
  // segments can run past the decoded audio (rounded ASR times); never draw beyond the time axis
  const span = (start: number, end: number) => `${((clamp(end) - clamp(start)) / duration) * 100}%`
  const regionText = evidence.map((e) => `${formatTimestamp(e.start_s)} to ${formatTimestamp(e.end_s)}`).join(', ')

  return (
    <section aria-label="Audio" className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            className="w-9 px-0"
            disabled={!ready}
            aria-label={playing ? 'Pause' : `Play call from ${formatTimestamp(time)}`}
            onClick={() => ws.current?.playPause()}
          >
            {playing ? <Pause strokeWidth={1.75} aria-hidden="true" /> : <Play strokeWidth={1.75} aria-hidden="true" />}
          </Button>
          <span className="tabular">
            <b className="font-semibold">{formatTimestamp(time)}</b>{' '}
            <span className="text-muted">/ {formatTimestamp(duration)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-small text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-signal" aria-hidden="true" />
            Evidence passage
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-graphite" aria-hidden="true" />
            Played
          </span>
          <Button
            size="sm"
            aria-label={`Playback speed ${RATES[rate]}×`}
            onClick={() => {
              const next = (rate + 1) % RATES.length
              setRate(next)
              ws.current?.setPlaybackRate(RATES[next], true)
            }}
          >
            {RATES[rate]}×
          </Button>
        </div>
      </div>

      <div
        ref={box}
        role="img"
        aria-label={`Waveform of the call.${evidence.length ? ` Evidence passages at ${regionText}.` : ''}`}
        className="relative h-[72px] cursor-pointer"
      />
      {failed && <p className="m-0 text-small text-alarm">The recording could not be loaded. {failed}</p>}

      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-y-1.5 text-small">
        {lanes.map(({ role, segs }) => (
          <div key={role} className="contents">
            <span className="text-muted">{speaker(role)}</span>
            <div className="relative h-2 rounded bg-canvas">
              {segs.map((s) => (
                <button
                  key={s.seg_id}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${speaker(role)} ${formatTimestamp(s.start_s)}`}
                  onClick={() => ws.current?.setTime(s.start_s)}
                  className={`absolute top-0 h-2 rounded ${role === 'advisor' ? 'bg-muted' : 'bg-[#A9ACB2]'}`}
                  style={{ left: pct(s.start_s), width: span(s.start_s, s.end_s) }}
                />
              ))}
            </div>
          </div>
        ))}
        <span />
        <div className="tabular relative h-[18px] text-muted" aria-hidden="true">
          {ticks(duration).map((t, i, all) => (
            <span
              key={t}
              className="absolute"
              style={{
                left: pct(t),
                transform: i === 0 ? undefined : i === all.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {formatDuration(t)}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
})
AudioPlayer.displayName = 'AudioPlayer'
