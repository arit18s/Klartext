import type { CheckResult } from '@/lib/types'
import { FAMILY_CHECK, formatAgreement } from '@/lib/format'

/** True when the decided check is split or undetermined; the panel explains why a person decides. */
export const isUnclear = (c: CheckResult | undefined) =>
  !!c && (c.event_majority === 'undetermined' || (c.agreement !== null && c.agreement < 1))

/** "Why the access check is unclear": built from agreement, benign_explanation and open_question. */
export function WhyUnclear({ check }: { check: CheckResult }) {
  const agree = formatAgreement(check.agreement, check.samples)
  const runs =
    check.event_majority === 'undetermined'
      ? `${agree} runs found that the call does not settle it.`
      : `Only ${agree} runs agree on the outcome.`
  return (
    <section aria-label="Check reasoning" className="flex flex-col gap-2 rounded-panel border border-line bg-paper p-4">
      <h3 className="text-subtitle font-medium">Why the {FAMILY_CHECK[check.family]} check is unclear</h3>
      <p className="m-0 max-w-[72ch] text-muted">
        {runs}
        {check.benign_explanation && ` Harmless reading: ${check.benign_explanation}`}
        {check.open_question && ' With the key fact missing, Klartext hands the call to a person instead of guessing.'}
      </p>
    </section>
  )
}
