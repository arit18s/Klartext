import type { ReactNode } from 'react'
import type { Verdict } from '@/lib/types'
import { VERDICT_LABEL } from '@/lib/format'
import { VERDICT_ORDER } from '@/lib/tuning'
import { cn } from '@/lib/utils'
import { lc, t, tn } from '@/i18n'

// Sequential, one hue (graphite), light → dark by count. Ink switches to white only on the two darkest steps.
const STEPS = ['bg-canvas', 'bg-line', 'bg-[#C9CBCF]', 'bg-muted', 'bg-graphite-soft']
const DARK = new Set([3, 4])

function step(n: number, max: number): number {
  if (n === 0 || max === 0) return 0
  return Math.max(1, Math.ceil((n / max) * (STEPS.length - 1)))
}

/** 3×3 expected vs Klartext. A real table: rows expected, columns Klartext; each cell says what it counts. */
export function ConfusionMatrix({
  matrix,
  total,
  highlightMissed = false,
  caption = t('confusion.caption'),
  children,
}: {
  matrix: number[][]
  total: number
  /** Quality page: missed cases (expected alarm or review, Klartext no alert) in alarm colour; the caption says so. */
  highlightMissed?: boolean
  caption?: string
  children?: ReactNode
}) {
  const max = Math.max(0, ...matrix.flat())
  return (
    <section
      aria-label={t('confusion.title')}
      className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-subtitle font-medium">{t('confusion.title')}</h3>
        <span className="text-small text-muted">{tn('common.calls', total)}</span>
      </div>
      <table className="w-full border-separate border-spacing-0.5">
        <thead>
          <tr>
            <td />
            {VERDICT_ORDER.map((v) => (
              <th key={v} scope="col" className="pb-1 text-center text-small font-normal text-muted">
                {VERDICT_LABEL[v]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VERDICT_ORDER.map((exp: Verdict, i) => (
            <tr key={exp}>
              <th scope="row" className="w-[84px] pr-2 text-left text-small font-normal text-muted">
                {VERDICT_LABEL[exp]}
              </th>
              {VERDICT_ORDER.map((got, j) => {
                const n = matrix[i][j]
                const s = step(n, max)
                const missed = highlightMissed && n > 0 && exp !== 'no_alert' && got === 'no_alert'
                const label = tn('confusion.cell', n, { exp: lc(VERDICT_LABEL[exp]), got: lc(VERDICT_LABEL[got]) })
                return (
                  <td
                    key={got}
                    title={label}
                    aria-label={label}
                    className={cn(
                      'tabular h-14 rounded-control text-center text-subtitle font-semibold',
                      missed ? 'bg-alarm-soft text-alarm' : STEPS[s],
                      !missed && (DARK.has(s) ? 'text-paper' : 'text-graphite'),
                    )}
                  >
                    {n}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 text-small text-muted">{caption}</p>
      {children}
    </section>
  )
}
