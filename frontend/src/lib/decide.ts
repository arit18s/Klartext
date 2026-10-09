// Decision rule, mirrored exactly from backend/app/pipeline/decide.py (05_BACKEND_STRUCTURE.md section 5).
// Change both together; shared/decision_cases.json must pass in both (npm test / python -m unittest).
// Runs on every slider move on the Tuning page, so it stays dependency-free.
import type { Verdict } from './types'

// Fixed family order: breaks ties for the top score and for the needs_human branch, whatever the input order.
export const FAMILY_ORDER = ['trade', 'splitting', 'access', 'disclosure', 'documentation']

export const NO_CHECKS_REASON = 'No checks enabled.'
export const FAILED_REASON = 'A check could not complete. Needs a human.'
export const ASR_REASON = 'Transcription unclear at the key passage.'

export interface FamilyScoreInput {
  family: string
  score: number | null // null when failed
  failed?: boolean
  needs_human_votes?: number
  open_question?: string | null
  reason?: string | null
}

export interface DecisionInput {
  families: FamilyScoreInput[] // enabled families only, helper excluded
  t_review?: number
  t_alarm?: number
  samples?: number // k
  asr_uncertain?: boolean
}

export type DecisionRule =
  | 'no_checks'
  | 'family_failed'
  | 'score_alarm'
  | 'score_review'
  | 'needs_human'
  | 'asr_uncertain'
  | 'no_alert'

export interface DecisionOutput {
  verdict: Verdict
  family: string | null
  score: number
  reason: string | null
  open_question: string | null
  rule: DecisionRule // which branch fired, for traceability
}

export function decide(inp: DecisionInput): DecisionOutput {
  const tReview = inp.t_review ?? 30
  const tAlarm = inp.t_alarm ?? 70
  const samples = inp.samples ?? 3
  const isFailed = (f: FamilyScoreInput) => !!f.failed || f.score === null
  const order = (family: string) => {
    const i = FAMILY_ORDER.indexOf(family)
    return i === -1 ? FAMILY_ORDER.length : i
  }
  // Array.prototype.sort is stable: unknown families keep input order.
  const families = [...inp.families].sort((a, b) => order(a.family) - order(b.family))
  if (families.length === 0)
    return { verdict: 'review', family: null, score: 0, reason: NO_CHECKS_REASON, open_question: null, rule: 'no_checks' }

  // First max wins ties (like Python max()): the fixed order decides.
  let top: FamilyScoreInput | null = null
  for (const f of families) if (!isFailed(f) && (top === null || f.score! > top.score!)) top = f
  const s = top ? top.score! : 0
  const fam = top ? top.family : null
  const out = (
    verdict: Verdict,
    family: string | null,
    reason: string | null | undefined,
    oq: string | null | undefined,
    rule: DecisionRule,
  ) => ({
    verdict,
    family,
    score: s,
    reason: reason ?? null,
    open_question: oq ?? null,
    rule,
  })

  const failed = families.filter(isFailed)
  if (top && s >= tAlarm) {
    const notes = failed.map((f) => `Note: the ${f.family} check could not complete.`)
    const reason = notes.length ? [top.reason, ...notes].filter(Boolean).join(' ') : top.reason
    return out('alarm', fam, reason, null, 'score_alarm')
  }
  if (failed.length) return out('review', failed[0].family, FAILED_REASON, null, 'family_failed')
  if (top && s >= tReview) return out('review', fam, top.reason, top.open_question, 'score_review')
  const human = families.find((f) => (f.needs_human_votes ?? 0) > samples / 2)
  if (human) return out('review', human.family, human.reason, human.open_question, 'needs_human')
  if (inp.asr_uncertain && s >= tReview / 2) return out('review', fam, ASR_REASON, null, 'asr_uncertain')
  return out('no_alert', fam, top ? top.reason : null, null, 'no_alert')
}
