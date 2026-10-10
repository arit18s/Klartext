import { Link } from 'react-router-dom'
import type { Twin, Verdict } from '@/lib/types'
import { VERDICT_LABEL, recordingName } from '@/lib/format'
import { buttonVariants } from '../ui/button'
import { lc, t } from '@/i18n'

/**
 * Twin call (05_BACKEND_STRUCTURE.md section 6): the most similar call with a different verdict.
 * Alarm ↔ no alert get the design's wording; a review's twin is only "the closest call".
 */
export function TwinBox({ twin, verdict }: { twin: Twin; verdict: Verdict }) {
  const name = recordingName(twin).name
  const href = `/calls/${encodeURIComponent(twin.call_id)}`
  const title =
    verdict === 'review'
      ? t('twin.noneForReview')
      : twin.verdict === 'no_alert'
        ? t('twin.withoutAlert', { name })
        : twin.verdict === 'alarm'
          ? t('twin.withAlert', { name })
          : t('twin.other', { verdict: lc(VERDICT_LABEL[twin.verdict]), name })
  return (
    <section
      aria-label={title}
      className="flex break-inside-avoid flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-canvas p-4"
    >
      <div className="flex max-w-[72ch] flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="text-muted">{twin.note}</span>
      </div>
      {verdict !== 'review' && (
        <Link to={href} className={buttonVariants({ className: 'print:hidden' })}>
          {t('twin.open', { name })}
        </Link>
      )}
    </section>
  )
}
