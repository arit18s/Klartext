// Decision rule, mirrored exactly from backend/app/pipeline/decide.py (05_BACKEND_STRUCTURE.md section 5).
// Change both together; shared/decision_cases.json must pass in both (npm test / python -m unittest).
// Runs on every slider move on the Tuning page, so it stays dependency-free.
import type { Verdict } from './types'

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

  // First max wins ties: input order is stable (Python max()).
  let top: FamilyScoreInput | null = null
  for (const f of inp.families) if (!isFailed(f) && (top === null || f.score! > top.score!)) top = f
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

  const failed = inp.families.find(isFailed)
  if (failed) return out('review', failed.family, FAILED_REASON, null, 'family_failed')
  if (top && s >= tAlarm) return out('alarm', fam, top.reason, null, 'score_alarm')
  if (top && s >= tReview) return out('review', fam, top.reason, top.open_question, 'score_review')
  const human = inp.families.find((f) => (f.needs_human_votes ?? 0) > samples / 2)
  if (human) return out('review', human.family, human.reason, human.open_question, 'needs_human')
  if (inp.asr_uncertain && s >= tReview / 2) return out('review', fam, ASR_REASON, null, 'asr_uncertain')
  return out('no_alert', fam, top ? top.reason : null, null, 'no_alert')
}
