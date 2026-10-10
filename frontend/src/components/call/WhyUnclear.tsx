import type { CheckResult } from '@/lib/types'
import { FAMILY_CHECK, formatAgreement } from '@/lib/format'
import { t } from '@/i18n'

/** True when the decided check is split or undetermined; the panel explains why a person decides. */
export const isUnclear = (c: CheckResult | undefined) =>
  !!c && (c.event_majority === 'undetermined' || (c.agreement !== null && c.agreement < 1))

/** "Why the access check is unclear": built from agreement, benign_explanation and open_question. */
export function WhyUnclear({ check }: { check: CheckResult }) {
  const agree = formatAgreement(check.agreement, check.samples)
  const runs =
    check.event_majority === 'undetermined'
      ? t('unclear.undetermined', { agree })
      : t('unclear.split', { agree })
  return (
    <section aria-label={t('unclear.label')} className="flex flex-col gap-2 rounded-panel border border-line bg-paper p-4">
      <h3 className="text-subtitle font-medium">{t('unclear.title', { check: FAMILY_CHECK[check.family] })}</h3>
      <p className="m-0 max-w-[72ch] text-muted">
        {runs}
        {check.benign_explanation && t('unclear.harmless', { text: check.benign_explanation })}
        {check.open_question && t('unclear.handOff')}
      </p>
    </section>
  )
}
