// Client-side re-decision for the Tuning page: every slider move re-runs decide() over GET /api/scores.
import { decide } from './decide'
import type { CallScores, Family, Thresholds, Verdict } from './types'

export const VERDICT_ORDER: Verdict[] = ['alarm', 'review', 'no_alert']

export interface Decided {
  call: CallScores
  verdict: Verdict
  score: number
}

export interface TuningResult {
  decided: Decided[]
  counts: Record<Verdict, number>
  /** Calls with an expected verdict (evaluation set). */
  evaluated: number
  positives: number // expected alarm or review
  caught: number // positives flagged as alarm or review (a review counts as caught)
  missed: number
  falseAlarms: number // expected no alert, Klartext alarm
  extraReviews: number // expected no alert, Klartext review
  precision: number | null
  recall: number | null
  /** confusion[expected][klartext], in VERDICT_ORDER. */
  confusion: number[][]
}

export function decideAll(calls: CallScores[], t: Thresholds, samples: number, enabled: Family[]): Decided[] {
  return calls.map((call) => {
    const out = decide({
      families: call.families
        .filter((f) => enabled.includes(f.family))
        .map((f) => ({ family: f.family, score: f.score, failed: f.failed, needs_human_votes: f.needs_human_votes })),
      t_review: t.review,
      t_alarm: t.alarm,
      samples,
      asr_uncertain: call.asr_uncertain,
    })
    return { call, verdict: out.verdict, score: out.score }
  })
}

export function evaluate(calls: CallScores[], t: Thresholds, samples: number, enabled: Family[]): TuningResult {
  const decided = decideAll(calls, t, samples, enabled)
  const counts = { alarm: 0, review: 0, no_alert: 0 }
  const confusion = VERDICT_ORDER.map(() => VERDICT_ORDER.map(() => 0))
  let tp = 0
  let fp = 0
  let fn = 0
  let falseAlarms = 0
  let extraReviews = 0
  let evaluated = 0
  for (const d of decided) {
    counts[d.verdict]++
    const exp = d.call.expected_verdict
    if (!exp) continue
    evaluated++
    confusion[VERDICT_ORDER.indexOf(exp)][VERDICT_ORDER.indexOf(d.verdict)]++
    const positive = exp !== 'no_alert'
    const flagged = d.verdict !== 'no_alert'
    if (positive && flagged) tp++
    else if (positive) fn++
    else if (flagged) {
      fp++
      if (d.verdict === 'alarm') falseAlarms++
      else extraReviews++
    }
  }
  return {
    decided,
    counts,
    evaluated,
    positives: tp + fn,
    caught: tp,
    missed: fn,
    falseAlarms,
    extraReviews,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    confusion,
  }
}

export interface PrPoint {
  t_review: number
  precision: number
  recall: number
}

/** Sweep "Review from" 0–100 (alarm held at max(alarm, review)); one point per distinct precision/recall pair. */
export function prCurve(calls: CallScores[], t: Thresholds, samples: number, enabled: Family[]): PrPoint[] {
  const points: PrPoint[] = []
  for (let review = 0; review <= 100; review++) {
    const r = evaluate(calls, { review, alarm: Math.max(t.alarm, review) }, samples, enabled)
    if (r.precision === null || r.recall === null) continue
    const last = points.at(-1)
    if (last && last.precision === r.precision && last.recall === r.recall) continue
    points.push({ t_review: review, precision: r.precision, recall: r.recall })
  }
  return points
}

export const PRESETS: { key: string; label: string; value: Thresholds }[] = [
  { key: 'catch', label: 'Catch everything', value: { review: 15, alarm: 70 } },
  { key: 'balanced', label: 'Balanced', value: { review: 30, alarm: 70 } },
  { key: 'fewer', label: 'Fewer reviews', value: { review: 50, alarm: 80 } },
]
