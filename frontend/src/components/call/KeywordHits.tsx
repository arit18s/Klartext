import type { KeywordHit } from '@/lib/types'
import { FAMILY_SHORT, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { t, tn } from '@/i18n'

const th = 'h-10 whitespace-nowrap border-b border-line px-4 text-left text-small font-medium text-muted'
const td = 'h-11 border-b border-line px-4'

/** Keyword hits are hints, never verdicts: phrase, family, time and what the model made of it. */
export function KeywordHits({ hits, onSelect }: { hits: KeywordHit[]; onSelect: (segId: string) => void }) {
  return (
    <section aria-label={t('keywords.label')} className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-subtitle font-medium">{t('keywords.label')}</h3>
        <span className="text-small text-muted">{tn('keywords.hits', hits.length)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('keywords.phrase')}</th>
              <th className={th}>{t('keywords.family')}</th>
              <th className={cn(th, 'text-right')}>{t('keywords.time')}</th>
              <th className={th}>{t('keywords.modelSays')}</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h, i) => (
              <tr key={`${h.keyword_id}-${h.seg_id}-${i}`} className="hover:bg-canvas">
                <td className={cn(td, 'font-quote text-[15px] italic')}>{h.phrase}</td>
                <td className={td}>{FAMILY_SHORT[h.family]}</td>
                <td className={cn(td, 'text-right')}>
                  <button
                    type="button"
                    className="tabular hover:underline"
                    onClick={() => onSelect(h.seg_id)}
                    aria-label={t('keywords.jump', { time: formatTimestamp(h.start_s) })}
                  >
                    {formatTimestamp(h.start_s)}
                  </button>
                </td>
                <td className={cn(td, h.label !== 'relevant' && 'text-muted')}>
                  {h.label === 'relevant' ? t('keywords.relevant') : h.label === 'benign' ? t('keywords.harmless') : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
