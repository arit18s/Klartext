import type { KeywordHit } from '@/lib/types'
import { FAMILY_SHORT, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

const th = 'h-10 whitespace-nowrap border-b border-line px-4 text-left text-small font-medium text-muted'
const td = 'h-11 border-b border-line px-4'

/** Keyword hits are hints, never verdicts: phrase, family, time and what the model made of it. */
export function KeywordHits({ hits, onSelect }: { hits: KeywordHit[]; onSelect: (segId: string) => void }) {
  return (
    <section aria-label="Keyword hits" className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-subtitle font-medium">Keyword hits</h3>
        <span className="text-small text-muted">
          {hits.length} {hits.length === 1 ? 'hit' : 'hits'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Phrase</th>
              <th className={th}>Family</th>
              <th className={cn(th, 'text-right')}>Time</th>
              <th className={th}>Model says</th>
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
                    aria-label={`Jump to ${formatTimestamp(h.start_s)}`}
                  >
                    {formatTimestamp(h.start_s)}
                  </button>
                </td>
                <td className={cn(td, h.label !== 'relevant' && 'text-muted')}>
                  {h.label === 'relevant' ? 'Relevant' : h.label === 'benign' ? 'Harmless' : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
