import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PrPoint } from '@/lib/tuning'

const fmt = (n: number) => n.toFixed(2)

/** Precision vs recall as "Review from" sweeps 0–100; the dot is the current setting. One series, no legend. */
export function PrCurve({
  points,
  current,
}: {
  points: PrPoint[]
  current: { precision: number | null; recall: number | null; review: number }
}) {
  const data = [...points].sort((a, b) => a.recall - b.recall || b.precision - a.precision)
  const lows = data.flatMap((p) => [p.precision, p.recall])
  const lo = Math.min(0.5, Math.floor(Math.min(1, ...lows) * 4) / 4)
  const ticks = [lo, (lo + 1) / 2, 1]
  return (
    <section
      aria-label="Precision vs recall"
      className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-subtitle font-medium">Precision vs recall</h3>
        <span className="text-small text-muted">dot = review from {current.review}</span>
      </div>
      {data.length === 0 ? (
        <p className="m-0 text-muted">No expected verdicts to draw the curve from.</p>
      ) : (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
              <CartesianGrid stroke="rgb(var(--line))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                type="number"
                dataKey="recall"
                domain={[lo, 1]}
                ticks={ticks}
                tickFormatter={fmt}
                tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }}
                stroke="rgb(var(--line))"
                label={{
                  value: 'Recall',
                  position: 'insideBottom',
                  offset: -10,
                  fontSize: 11,
                  fill: 'rgb(var(--muted))',
                }}
              />
              <YAxis
                type="number"
                domain={[lo, 1]}
                ticks={ticks}
                tickFormatter={fmt}
                width={44}
                tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }}
                stroke="rgb(var(--line))"
                label={{
                  value: 'Precision',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 12,
                  fontSize: 11,
                  fill: 'rgb(var(--muted))',
                }}
              />
              <Tooltip
                cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  const p = active && (payload?.[0]?.payload as PrPoint | undefined)
                  if (!p) return null
                  return (
                    <div className="rounded-control border border-line bg-paper px-3 py-2 text-small shadow-modal">
                      <div className="font-medium">Review from {p.t_review}</div>
                      <div className="tabular text-muted">
                        Precision {fmt(p.precision)} · recall {fmt(p.recall)}
                      </div>
                    </div>
                  )
                }}
              />
              <Line
                type="stepAfter"
                dataKey="precision"
                stroke="rgb(var(--graphite))"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {current.precision !== null && current.recall !== null && (
                <ReferenceDot
                  x={current.recall}
                  y={current.precision}
                  r={5}
                  fill="rgb(var(--paper))"
                  stroke="rgb(var(--graphite))"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
