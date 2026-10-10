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
import { joinList, t, tn } from '@/i18n'

const calls = (n: number) => tn('common.calls', n)
const ratio = (x: number | null) => (x === null ? '–' : x.toFixed(2))

/** "At these settings Klartext catches 35 of 36 cases and sends 3 harmless calls to review." */
function summary(r: TuningResult): string {
  if (r.evaluated === 0) {
    return tn('tuning.summaryNoEval', r.counts.review, { alerts: tn('common.alerts', r.counts.alarm) })
  }
  const costs = [
    r.extraReviews ? tn('tuning.costExtra', r.extraReviews) : null,
    r.falseAlarms ? tn('tuning.costFalse', r.falseAlarms) : null,
  ].filter((x): x is string => x !== null)
  const cases = tn('tuning.cases', r.positives, { caught: r.caught })
  return t('tuning.summary', { cases, costs: costs.length ? joinList(costs) : t('tuning.noHarmless') })
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
            title={t('tuning.tickTitle', { id: call.call_id, score: Math.round(score) })}
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
      <span className="text-small text-muted">{tn('common.callWord', n)}</span>
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

  const cur = value ?? (saved ? { review: saved.review, alarm: saved.alarm } : { review: 30, alarm: 70 })
  const data = scores.data
  const result = useMemo(
    () => (data ? evaluate(data.calls, cur, data.samples_per_check, data.enabled_families) : null),
    [data, cur.review, cur.alarm], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const curve = useMemo(
    () => (data ? prCurve(data.calls, cur, data.samples_per_check, data.enabled_families) : []),
    [data, cur.alarm], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const dirty = !!saved && (saved.review !== cur.review || saved.alarm !== cur.alarm)

  // R11: a suggestion only moves the handles; the officer still applies it (never automatic).
  const suggest = useMutation({
    mutationFn: getThresholdSuggestion,
    onError: (e: Error) => toast(t('tuning.noSuggestion', { message: e.message }), 'error'),
  })

  const apply = useMutation({
    mutationFn: () => putThresholds({ review: cur.review, alarm: cur.alarm }),
    onSuccess: (v) => {
      toast(t('tuning.applied', { review: v.review, alarm: v.alarm }))
      qc.invalidateQueries({ queryKey: ['scores'] })
      qc.invalidateQueries({ queryKey: ['calls'] })
    },
    onError: (e: Error) => toast(t('tuning.notApplied', { message: e.message }), 'error'),
  })

  return (
    <Page title={t('nav.tuning')}>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">{t('tuning.heading')}</h2>
          <p className="mt-1 max-w-[72ch] text-muted">{t('tuning.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('tuning.presets')}>
          {PRESETS.map((p) => {
            const on = p.value.review === cur.review && p.value.alarm === cur.alarm
            return (
              <Button
                key={p.key}
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                onClick={() => setValue(p.value)}
              >
                {t(`tuning.preset.${p.key}`)}
              </Button>
            )
          })}
        </div>
      </section>

      {scores.isPending && <p className="text-muted">{t('tuning.loading')}</p>}
      {scores.error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>{t('tuning.loadError', { message: scores.error.message })}</span>
          <Button onClick={() => scores.refetch()}>{t('common.tryAgain')}</Button>
        </div>
      )}

      {result && saved && (
        <>
          <section
            aria-label={t('tuning.thresholds')}
            className="flex flex-col gap-4 rounded-panel border border-line bg-paper p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-subtitle font-medium">{t('tuning.thresholdsTitle')}</h3>
              <div className="flex gap-4 text-small text-muted" aria-hidden="true">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-0.5 rounded-sm bg-graphite" />
                  {t('tuning.shouldCatch')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-0.5 rounded-sm bg-[#C9CBCF]" />
                  {t('tuning.harmless')}
                </span>
              </div>
            </div>
            <ScoreStrip r={result} />
            <ThresholdSlider value={cur} onChange={setValue} />
            <div className="mt-14 flex justify-between text-small text-muted">
              <span>{t('tuning.scaleLow')}</span>
              <span>{t('tuning.scaleHigh')}</span>
            </div>
            <p className="m-0 rounded-panel bg-canvas px-4 py-4 text-subtitle" aria-live="polite">
              {summary(result)}
            </p>
            <p className="m-0 text-small text-muted">
              {t('tuning.savedVersion', { version: saved.version_id, review: saved.review, alarm: saved.alarm })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!dirty} onClick={() => setValue({ review: saved.review, alarm: saved.alarm })}>
                {t('tuning.reset')}
              </Button>
              <Button onClick={() => suggest.mutate()} disabled={suggest.isPending}>
                <Sparkles strokeWidth={1.75} aria-hidden="true" />
                {suggest.isPending ? t('tuning.looking') : t('tuning.suggest')}
              </Button>
              <Button variant="primary" disabled={!dirty || apply.isPending} onClick={() => apply.mutate()}>
                {t('tuning.apply')}
              </Button>
            </div>
            {suggest.data && (
              <SuggestionCard s={suggest.data} current={cur} onUse={setValue} onClose={() => suggest.reset()} />
            )}
          </section>

          <section aria-label={t('tuning.liveCounts')} className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
            <CountTile verdict="alarm" n={result.counts.alarm} />
            <CountTile verdict="review" n={result.counts.review} />
            <CountTile verdict="no_alert" n={result.counts.no_alert} />
            <RatioTile label={t('tuning.precision')} value={result.precision} note={t('tuning.precisionNote')} />
            <RatioTile label={t('tuning.recall')} value={result.recall} note={t('tuning.recallNote')} />
          </section>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6">
            <section
              aria-label={t('tuning.testSet')}
              className="flex flex-col rounded-panel border border-line bg-paper p-5"
            >
              <h3 className="mb-2 text-subtitle font-medium">{t('tuning.testSet')}</h3>
              {result.evaluated === 0 ? (
                <p className="m-0 text-muted">{t('tuning.noExpected')}</p>
              ) : (
                <dl className="m-0">
                  {[
                    [t('tuning.caught'), t('common.ofTotal', { a: result.caught, b: result.positives }), false],
                    [t('tuning.missed'), result.missed, result.missed > 0],
                    [t('tuning.falseAlerts'), result.falseAlarms, false],
                    [t('tuning.extraReviews'), result.extraReviews, false],
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
              current={{ precision: result.precision, recall: result.recall, review: cur.review }}
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
  onUse: (th: Thresholds) => void
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
              {t('tuning.suggested', { calls: calls(s.labelled_calls), review: sug.review, alarm: sug.alarm })}
            </span>
          ) : (
            <span className="font-semibold">
              {s.labelled_calls ? t('tuning.feedbackOn', { calls: calls(s.labelled_calls) }) : t('tuning.noFeedback')}
            </span>
          )}
          <span>{s.summary}</span>
          {sug && s.suggested_effect && (
            <span className="text-small text-muted">
              {t('tuning.effect', { calls: calls(s.suggested_effect.flagged), now: s.current_effect.flagged })}
            </span>
          )}
          {sug && s.dev_recall?.suggested != null && (
            <span className="text-small text-muted">
              {t('tuning.devRecall', {
                after: s.dev_recall.suggested.toFixed(2),
                now: s.dev_recall.current?.toFixed(2) ?? '–',
              })}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {sug && (
          <Button variant="primary" disabled={inUse} onClick={() => onUse({ review: sug.review, alarm: sug.alarm })}>
            {inUse ? t('tuning.inUse') : t('tuning.use')}
          </Button>
        )}
        <Button onClick={onClose}>{t('tuning.dismiss')}</Button>
        {sug && <span className="self-center text-small text-muted">{t('tuning.nothingSaved')}</span>}
      </div>
    </div>
  )
}
