import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { Page } from '@/app/Page'
import { ConfusionMatrix } from '@/components/ConfusionMatrix'
import { PrCurve } from '@/components/PrCurve'
import { ThresholdSlider } from '@/components/ThresholdSlider'
import { useToast } from '@/components/Toast'
import { VerdictChip } from '@/components/VerdictChip'
import { Button } from '@/components/ui/button'
import { getScores, getThresholdSuggestion, putThresholds } from '@/lib/api'
import { PRESETS, evaluate, prCurve, type TuningResult } from '@/lib/tuning'
import type { ThresholdSuggestion, Thresholds, Verdict } from '@/lib/types'
import { cn } from '@/lib/utils'

const calls = (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`
const ratio = (x: number | null) => (x === null ? '–' : x.toFixed(2))

/** "At these settings Klartext catches 35 of 36 cases and sends 3 harmless calls to review." */
function summary(r: TuningResult): string {
  if (r.evaluated === 0) {
    return `At these settings Klartext raises ${r.counts.alarm} ${r.counts.alarm === 1 ? 'alert' : 'alerts'} and sends ${calls(r.counts.review)} to review.`
  }
  const costs = [
    r.extraReviews ? `sends ${r.extraReviews} harmless ${r.extraReviews === 1 ? 'call' : 'calls'} to review` : null,
    r.falseAlarms ? `raises ${r.falseAlarms} false ${r.falseAlarms === 1 ? 'alert' : 'alerts'}` : null,
  ].filter(Boolean)
  const cases = `catches ${r.caught} of ${r.positives} ${r.positives === 1 ? 'case' : 'cases'}`
  return `At these settings Klartext ${cases} and ${costs.length ? costs.join(' and ') : 'flags no harmless call'}.`
}

/** One tick per call at its score: tall dark = should be caught, short light = harmless, mid = no expected verdict. */
function ScoreStrip({ r }: { r: TuningResult }) {
  return (
    <div className="relative mx-2.5 h-8" aria-hidden="true">
      {r.decided.map(({ call, score }) => {
        const exp = call.expected_verdict
        const cls = !exp ? 'h-5 bg-muted' : exp === 'no_alert' ? 'h-4 bg-[#C9CBCF]' : 'h-6 bg-graphite'
        return (
          <span
            key={call.call_id}
            title={`${call.call_id}: score ${Math.round(score)}`}
            className={cn('absolute bottom-0 w-0.5 -translate-x-1/2 rounded-sm', cls)}
            style={{ left: `${Math.max(0, Math.min(100, score))}%` }}
          />
        )
      })}
    </div>
  )
}

function CountTile({ verdict, n }: { verdict: Verdict; n: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-panel border border-line bg-paper p-4">
      <span>
        <VerdictChip verdict={verdict} />
      </span>
      <span className="tabular mt-1 text-display">{n}</span>
      <span className="text-small text-muted">{n === 1 ? 'call' : 'calls'}</span>
    </div>
  )
}

function RatioTile({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-panel border border-line bg-paper p-4">
      <span className="text-muted">{label}</span>
      <span className="tabular mt-1 text-display">{ratio(value)}</span>
      <span className="text-small text-muted">{note}</span>
    </div>
  )
}

export default function Tuning() {
  const qc = useQueryClient()
  const toast = useToast()
  const scores = useQuery({ queryKey: ['scores'], queryFn: getScores })
  const saved = scores.data?.thresholds
  const [value, setValue] = useState<Thresholds | null>(null)

  useEffect(() => {
    if (saved && value === null) setValue({ review: saved.review, alarm: saved.alarm })
  }, [saved, value])

  const t = value ?? (saved ? { review: saved.review, alarm: saved.alarm } : { review: 30, alarm: 70 })
  const data = scores.data
  const result = useMemo(
    () => (data ? evaluate(data.calls, t, data.samples_per_check, data.enabled_families) : null),
    [data, t.review, t.alarm], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const curve = useMemo(
    () => (data ? prCurve(data.calls, t, data.samples_per_check, data.enabled_families) : []),
    [data, t.alarm], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const dirty = !!saved && (saved.review !== t.review || saved.alarm !== t.alarm)

  // R11: a suggestion only moves the handles; the officer still applies it (never automatic).
  const suggest = useMutation({
    mutationFn: getThresholdSuggestion,
    onError: (e: Error) => toast(`No suggestion. ${e.message}`, 'error'),
  })

  const apply = useMutation({
    mutationFn: () => putThresholds({ review: t.review, alarm: t.alarm }),
    onSuccess: (v) => {
      toast(`Applied thresholds: review from ${v.review}, alert from ${v.alarm}`)
      qc.invalidateQueries({ queryKey: ['scores'] })
      qc.invalidateQueries({ queryKey: ['calls'] })
    },
    onError: (e: Error) => toast(`Thresholds were not applied. ${e.message}`, 'error'),
  })

  return (
    <Page title="Tuning">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">How strict Klartext is</h2>
          <p className="mt-1 max-w-[72ch] text-muted">
            Drag the handles. Every number on this page updates as you move them. Nothing changes for real until you
            apply.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
          {PRESETS.map((p) => {
            const on = p.value.review === t.review && p.value.alarm === t.alarm
            return (
              <Button
                key={p.key}
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                onClick={() => setValue(p.value)}
              >
                {p.label}
              </Button>
            )
          })}
        </div>
      </section>

      {scores.isPending && <p className="text-muted">Loading scores…</p>}
      {scores.error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>Could not load the scores. {scores.error.message}</span>
          <Button onClick={() => scores.refetch()}>Try again</Button>
        </div>
      )}

      {result && saved && (
        <>
          <section
            aria-label="Thresholds"
            className="flex flex-col gap-4 rounded-panel border border-line bg-paper p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-subtitle font-medium">Thresholds on the score (0–100)</h3>
              <div className="flex gap-4 text-small text-muted" aria-hidden="true">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-0.5 rounded-sm bg-graphite" />
                  Should be caught
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-0.5 rounded-sm bg-[#C9CBCF]" />
                  Harmless
                </span>
              </div>
            </div>
            <ScoreStrip r={result} />
            <ThresholdSlider value={t} onChange={setValue} />
            <div className="mt-14 flex justify-between text-small text-muted">
              <span>0 · no alert</span>
              <span>100 · certain</span>
            </div>
            <p className="m-0 rounded-panel bg-canvas px-4 py-4 text-subtitle" aria-live="polite">
              {summary(result)}
            </p>
            <p className="m-0 text-small text-muted">
              Current saved version {saved.version_id}: review from {saved.review}, alert from {saved.alarm}. Every
              apply writes a new version to the audit log.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!dirty} onClick={() => setValue({ review: saved.review, alarm: saved.alarm })}>
                Reset to saved
              </Button>
              <Button onClick={() => suggest.mutate()} disabled={suggest.isPending}>
                <Sparkles strokeWidth={1.75} aria-hidden="true" />
                {suggest.isPending ? 'Looking at feedback…' : 'Suggest from feedback'}
              </Button>
              <Button variant="primary" disabled={!dirty || apply.isPending} onClick={() => apply.mutate()}>
                Apply thresholds
              </Button>
            </div>
            {suggest.data && (
              <SuggestionCard s={suggest.data} current={t} onUse={setValue} onClose={() => suggest.reset()} />
            )}
          </section>

          <section aria-label="Live counts" className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
            <CountTile verdict="alarm" n={result.counts.alarm} />
            <CountTile verdict="review" n={result.counts.review} />
            <CountTile verdict="no_alert" n={result.counts.no_alert} />
            <RatioTile label="Precision" value={result.precision} note="of flagged calls are real cases" />
            <RatioTile label="Recall" value={result.recall} note="of real cases are flagged" />
          </section>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6">
            <section
              aria-label="On the test set"
              className="flex flex-col rounded-panel border border-line bg-paper p-5"
            >
              <h3 className="mb-2 text-subtitle font-medium">On the test set</h3>
              {result.evaluated === 0 ? (
                <p className="m-0 text-muted">No expected verdicts for these calls.</p>
              ) : (
                <dl className="m-0">
                  {[
                    ['Caught', `${result.caught} of ${result.positives}`, false],
                    ['Missed', result.missed, result.missed > 0],
                    ['False alerts', result.falseAlarms, false],
                    ['Extra reviews on harmless calls', result.extraReviews, false],
                  ].map(([label, v, bad]) => (
                    <div
                      key={String(label)}
                      className="flex items-center justify-between border-b border-line py-3 last:border-b-0"
                    >
                      <dt>{label}</dt>
                      <dd className={cn('tabular m-0 font-semibold', bad && 'text-alarm')}>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
            <ConfusionMatrix matrix={result.confusion} total={result.evaluated} />
            <PrCurve
              points={curve}
              current={{ precision: result.precision, recall: result.recall, review: t.review }}
            />
          </div>
        </>
      )}
    </Page>
  )
}

/** The suggestion from feedback, with its effect. "Use suggestion" only moves the handles. */
function SuggestionCard({
  s,
  current,
  onUse,
  onClose,
}: {
  s: ThresholdSuggestion
  current: Thresholds
  onUse: (t: Thresholds) => void
  onClose: () => void
}) {
  const sug = s.suggestion
  const inUse = !!sug && sug.review === current.review && sug.alarm === current.alarm
  return (
    <div role="status" className="flex flex-col gap-3 rounded-panel border border-line bg-canvas p-4">
      <div className="flex items-start gap-3">
        <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 flex-none" />
        <div className="flex flex-col gap-1">
          {sug ? (
            <span className="font-semibold">
              Suggested from feedback on {calls(s.labelled_calls)}: review from {sug.review}, alert from {sug.alarm}
            </span>
          ) : (
            <span className="font-semibold">
              {s.labelled_calls ? `Feedback on ${calls(s.labelled_calls)}` : 'No feedback yet'}
            </span>
          )}
          <span>{s.summary}</span>
          {sug && s.suggested_effect && (
            <span className="text-small text-muted">
              Flags {calls(s.suggested_effect.flagged)} in total, now {s.current_effect.flagged}. Only calls with
              feedback are judged; the counts below show the effect on every call once you use it.
            </span>
          )}
          {sug && s.dev_recall?.suggested != null && (
            <span className="text-small text-muted">
              Recall on the latest Dev run stays {s.dev_recall.suggested.toFixed(2)} (now{' '}
              {s.dev_recall.current?.toFixed(2) ?? '–'}). Suggestions never lower it.
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {sug && (
          <Button variant="primary" disabled={inUse} onClick={() => onUse({ review: sug.review, alarm: sug.alarm })}>
            {inUse ? 'Suggestion in use' : 'Use suggestion'}
          </Button>
        )}
        <Button onClick={onClose}>Dismiss</Button>
        {sug && <span className="self-center text-small text-muted">Nothing is saved until you apply.</span>}
      </div>
    </div>
  )
}
