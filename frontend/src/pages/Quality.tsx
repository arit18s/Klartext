import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, Minus, Play, X } from 'lucide-react'
import { Page } from '@/app/Page'
import { ConfusionMatrix } from '@/components/ConfusionMatrix'
import { Segmented } from '@/components/Segmented'
import { useToast } from '@/components/Toast'
import { VerdictChip } from '@/components/VerdictChip'
import { Button } from '@/components/ui/button'
import { ApiError, getLatestEval, runEval } from '@/lib/api'
import { FAMILY_LABEL, FAMILY_SHORT, VARIANT_LABEL, VERDICT_LABEL, formatProcessed } from '@/lib/format'
import type { BreakdownRow, EvalMetrics, EvalRun, EvalSplit, Family, Variant } from '@/lib/types'
import { cn } from '@/lib/utils'

// Targets from 01_PRD.md section 8.
const TARGET = { recall: 0.95, precision: 0.8, evidence: 0.9, cleanNoisy: 0.9, pairs: 8 }
const SPLIT_LABEL: Record<EvalSplit, string> = { dev: 'Dev', holdout: 'Holdout', all: 'All' }
const LEVEL_LABEL: Record<string, string> = {
  '1': 'Stufe 1 · keyword calls',
  '2': 'Stufe 2 · context pairs',
  '3': 'Stufe 3 · open cases',
}
const two = (x: number | null) => (x === null ? '–' : x.toFixed(2))
const pct = (x: number) => `${Math.round(x * 100)}%`
const shortId = (id: string) => id.replace(/^Stufe\d_/, '')

type Status = 'meets' | 'below' | 'none' | 'unmeasured'

function StatusLine({ status }: { status: Status }) {
  if (status === 'meets')
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-medium text-clear">
        <Check size={14} strokeWidth={1.75} aria-hidden="true" />
        Meets target
      </span>
    )
  if (status === 'below')
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-medium text-alarm">
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
        Below target
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-muted">
      <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
      {status === 'none' ? 'No target set' : 'Not measured yet'}
    </span>
  )
}

function Kpi({ label, value, detail, status }: { label: string; value: string; detail: string; status: Status }) {
  return (
    <div className="flex flex-col gap-1 rounded-panel border border-line bg-paper p-4">
      <span className="text-muted">{label}</span>
      <span className="tabular mt-1 text-display">{value}</span>
      <span className="text-small text-muted">{detail}</span>
      <span className="mt-1">
        <StatusLine status={status} />
      </span>
    </div>
  )
}

function kpis(m: EvalMetrics) {
  const b = m.binary
  const cases = b.tp + b.fn
  const flagged = b.tp + b.fp
  const ev = m.evidence_overlap
  const cn_ = m.clean_noisy_agreement
  const meets = (v: number, t: number): Status => (v >= t ? 'meets' : 'below')
  return [
    {
      label: 'Recall',
      value: cases ? two(b.recall) : '–',
      detail: `${b.tp} of ${cases} cases caught · target ${TARGET.recall.toFixed(2)}`,
      status: cases ? meets(b.recall, TARGET.recall) : ('unmeasured' as Status),
    },
    {
      label: 'Precision',
      value: flagged ? two(b.precision) : '–',
      detail: `${b.tp} of ${flagged} flagged are real · target ${TARGET.precision.toFixed(2)}`,
      status: flagged ? meets(b.precision, TARGET.precision) : ('unmeasured' as Status),
    },
    {
      label: 'Exact verdict match',
      value: two(m.exact.accuracy),
      detail: `${m.exact.correct} of ${m.exact.total} calls`,
      status: 'none' as Status,
    },
    {
      label: 'Evidence overlap',
      value: ev && ev.measurable ? pct(ev.hit / ev.measurable) : '–',
      detail: ev
        ? `${ev.hit} of ${ev.measurable} alarms hit an expected turn · target ${pct(TARGET.evidence)}`
        : `Needs ASR turn alignment · target ${pct(TARGET.evidence)}`,
      status: ev && ev.measurable ? meets(ev.hit / ev.measurable, TARGET.evidence) : ('unmeasured' as Status),
    },
    {
      label: 'Clean vs noisy agreement',
      value: cn_.total ? pct(cn_.agree / cn_.total) : '–',
      detail: cn_.total
        ? `${cn_.agree} of ${cn_.total} scripts · target ${pct(TARGET.cleanNoisy)}`
        : `No noisy recordings in this run · target ${pct(TARGET.cleanNoisy)}`,
      status: cn_.total ? meets(cn_.agree / cn_.total, TARGET.cleanNoisy) : ('unmeasured' as Status),
    },
  ]
}

const GROUPS: { key: BreakdownRow['group']; label: string }[] = [
  { key: 'level', label: 'By level' },
  { key: 'family', label: 'By family' },
  { key: 'variant', label: 'By audio' },
]

function groupLabel(r: BreakdownRow): string {
  if (r.group === 'level') return LEVEL_LABEL[r.key] ?? `Stufe ${r.key}`
  if (r.group === 'family') return FAMILY_LABEL[r.key as Family] ?? r.key
  return VARIANT_LABEL[r.key as Variant] ?? r.key
}

const th = 'h-10 whitespace-nowrap border-b border-line px-4 text-left text-small font-medium text-muted'
const td = 'h-11 border-b border-line px-4'

function Breakdown({ m }: { m: EvalMetrics }) {
  const [show, setShow] = useState<'all' | BreakdownRow['group']>('all')
  const note = (r: BreakdownRow) =>
    r.note ??
    (r.group === 'level' && r.key === '3' && m.stufe3_review.total
      ? `${m.stufe3_review.reviewed} of ${m.stufe3_review.total} sent to review`
      : '')
  return (
    <section aria-label="Breakdown" className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">Breakdown</h3>
        <Segmented
          label="Breakdown"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'level', label: 'Level' },
            { value: 'family', label: 'Family' },
            { value: 'variant', label: 'Audio' },
          ]}
        />
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Group</th>
              <th className={cn(th, 'text-right')}>Calls</th>
              <th className={cn(th, 'text-right')}>Cases</th>
              <th className={cn(th, 'text-right')}>Recall</th>
              <th className={cn(th, 'text-right')}>Precision</th>
              <th className={th}>Note</th>
            </tr>
          </thead>
          {GROUPS.filter((g) => show === 'all' || show === g.key).map((g) => (
            <tbody key={g.key}>
              <tr>
                <th
                  colSpan={6}
                  scope="colgroup"
                  className="h-8 border-b border-line bg-canvas px-4 text-left text-small font-normal text-muted"
                >
                  {g.label}
                  {g.key === 'family' &&
                    m.family_accuracy.total > 0 &&
                    ` · family right on ${m.family_accuracy.correct} of ${m.family_accuracy.total} flagged calls`}
                </th>
              </tr>
              {m.breakdown
                .filter((r) => r.group === g.key)
                .map((r) => (
                  <tr key={`${r.group}-${r.key}`} className="hover:bg-canvas">
                    <td className={td}>{groupLabel(r)}</td>
                    <td className={cn(td, 'tabular text-right')}>{r.calls}</td>
                    <td className={cn(td, 'tabular text-right')}>{r.cases}</td>
                    <td className={cn(td, 'tabular text-right')}>{two(r.recall)}</td>
                    <td className={cn(td, 'tabular text-right')}>{two(r.precision)}</td>
                    <td className={cn(td, 'text-muted')}>{note(r)}</td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  )
}

function Pairs({ m }: { m: EvalMetrics }) {
  const right = m.stufe2_pairs.filter((p) => p.both_right).length
  return (
    <section
      aria-label="Stufe 2 pairs on clean audio"
      className="overflow-hidden rounded-panel border border-line bg-paper"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">Stufe 2 pairs on clean audio</h3>
        <span className="text-small text-muted">
          {right} of {m.stufe2_pairs.length} both sides right · target {TARGET.pairs}
        </span>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Pair</th>
              <th className={th}>Family</th>
              <th className={th}>Fraud side</th>
              <th className={th}>Harmless side</th>
              <th className={th}>Both right</th>
            </tr>
          </thead>
          <tbody>
            {m.stufe2_pairs.map((p) => (
              <tr key={p.pair.join()} className="hover:bg-canvas">
                <td className={cn(td, 'whitespace-nowrap')}>{p.pair.map(shortId).join(' · ')}</td>
                <td className={td}>{FAMILY_SHORT[p.family]}</td>
                <td className={td}>{p.fraud_side ? <VerdictChip verdict={p.fraud_side} /> : '–'}</td>
                <td className={td}>{p.harmless_side ? <VerdictChip verdict={p.harmless_side} /> : '–'}</td>
                <td className={td}>
                  {p.both_right ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-clear">
                      <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-medium text-alarm">
                      <X size={16} strokeWidth={1.75} aria-hidden="true" />
                      No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.stufe2_pairs.length === 0 && <p className="m-0 px-4 py-6 text-muted">No Stufe 2 pairs in this run.</p>}
      </div>
    </section>
  )
}

function Mismatches({ m }: { m: EvalMetrics }) {
  const name = (id: string) => {
    const k = /-K([1-4])$/.exec(id)
    const base = shortId(id.replace(/-K[1-4]$/, ''))
    return k ? `${base} · ${['1', '3'].includes(k[1]) ? 'Clean' : 'Noisy'}` : id
  }
  return (
    <section aria-label="Every mismatch" className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">Every mismatch</h3>
        <Link to="/calls?mismatches=1" className="text-small underline hover:text-muted">
          Show in All calls
        </Link>
      </div>
      {m.mismatches.length === 0 ? (
        <p className="m-0 border-t border-line px-4 py-6 text-muted">
          Every call in this run got its expected verdict.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Call</th>
                <th className={th}>Expected → Klartext</th>
                <th className={th}>Why</th>
              </tr>
            </thead>
            <tbody>
              {m.mismatches.map((x) => (
                <tr key={x.call_id} className="hover:bg-canvas">
                  <td className={cn(td, 'whitespace-nowrap font-medium')}>
                    <Link to={`/calls/${encodeURIComponent(x.call_id)}`} className="hover:text-muted">
                      {name(x.call_id)}
                    </Link>
                  </td>
                  <td className={cn(td, 'whitespace-nowrap', !x.caught && x.expected !== 'no_alert' && 'text-alarm')}>
                    {VERDICT_LABEL[x.expected]} → {VERDICT_LABEL[x.predicted]}
                  </td>
                  <td className={cn(td, 'py-2 text-muted')}>
                    {x.caught ? 'Caught. ' : ''}
                    {x.reason ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function KeywordBaseline({ m }: { m: EvalMetrics }) {
  const k = m.keyword_baseline
  const b = m.binary
  return (
    <section
      aria-label="Compared with a keyword filter"
      className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5"
    >
      <h3 className="text-subtitle font-medium">Compared with a keyword filter</h3>
      <dl className="m-0 grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-2">
        <span />
        <dt className="text-right text-small text-muted">Keyword filter</dt>
        <dt className="text-right text-small text-muted">Klartext</dt>
        {[
          ['Flagged calls', String(k.flagged), String(b.tp + b.fp)],
          ['Precision', two(k.precision), two(b.precision)],
          ['Recall', two(k.recall), two(b.recall)],
        ].map(([label, a, c]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="tabular m-0 text-right">{a}</dd>
            <dd className="tabular m-0 text-right font-semibold">{c}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-small text-muted">
        Same calls, same expected verdicts. The keyword filter flags any call where an enabled keyword is said.
      </p>
    </section>
  )
}

function downloadReport(run: EvalRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: `${run.run_id}.json` }).click()
  URL.revokeObjectURL(url)
}

export default function Quality() {
  const qc = useQueryClient()
  const toast = useToast()
  const latest = useQuery({ queryKey: ['eval'], queryFn: getLatestEval, retry: false })
  const [split, setSplit] = useState<EvalSplit>('dev')
  const run = useMutation({
    mutationFn: () => runEval({ split }),
    onSuccess: (r) => {
      qc.setQueryData(['eval'], r)
      toast(`Ran evaluation ${r.run_id} on ${SPLIT_LABEL[r.split].toLowerCase()}`)
    },
    onError: (e: Error) => toast(`The evaluation did not run. ${e.message}`, 'error'),
  })
  const data = latest.data
  const m = data?.metrics
  const missing = latest.error instanceof ApiError && latest.error.status === 404

  return (
    <Page title="Quality">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">Detection quality</h2>
          {data && m && (
            <p className="mt-1 max-w-[72ch] text-muted">
              {SPLIT_LABEL[data.split]} split, {m.n_calls} {m.n_calls === 1 ? 'call' : 'calls'} from{' '}
              {data.source === 'asr' ? 'speech recognition' : 'script text (development)'}. Last run {data.run_id}{' '}
              {formatProcessed(data.created_at)} on thresholds version {data.config_versions.thresholds ?? '–'}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <Button onClick={() => downloadReport(data)}>
              <Download strokeWidth={1.75} aria-hidden="true" />
              Download report
            </Button>
          )}
          <Segmented
            label="Split to evaluate"
            value={split}
            onChange={setSplit}
            options={(Object.keys(SPLIT_LABEL) as EvalSplit[]).map((s) => ({ value: s, label: SPLIT_LABEL[s] }))}
          />
          <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>
            <Play strokeWidth={1.75} aria-hidden="true" />
            {run.isPending ? 'Running…' : 'Run evaluation'}
          </Button>
        </div>
      </section>
      {split === 'holdout' && (
        <p className="-mt-4 m-0 text-small text-muted">
          Holdout numbers are for reporting only. Prompts and thresholds are never tuned on them.
        </p>
      )}

      {latest.isPending && <p className="text-muted">Loading the latest evaluation…</p>}
      {missing && (
        <p className="m-0 rounded-panel border border-line p-6 text-muted">
          No evaluation has run yet. Pick a split and run one.
        </p>
      )}
      {latest.error && !missing && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>Could not load the evaluation. {latest.error.message}</span>
          <Button onClick={() => latest.refetch()}>Try again</Button>
        </div>
      )}

      {m && (
        <>
          <section aria-label="Headline numbers" className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
            {kpis(m).map((k) => (
              <Kpi key={k.label} {...k} />
            ))}
          </section>

          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-0 flex-[3_1_520px] flex-col gap-6">
              <Breakdown m={m} />
            </div>
            <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-6">
              <ConfusionMatrix
                matrix={m.confusion.matrix}
                total={m.n_calls}
                highlightMissed
                caption="Rows: expected. Columns: Klartext. Red cells are missed cases."
              >
                <p className="m-0 rounded-panel bg-canvas px-4 py-3">
                  Alarms sent to review ({m.confusion.matrix[0][1]}) count as caught. Review is a hand-off, not a miss.
                </p>
              </ConfusionMatrix>
              <KeywordBaseline m={m} />
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-6">
            <Pairs m={m} />
            <Mismatches m={m} />
          </div>
        </>
      )}
    </Page>
  )
}
