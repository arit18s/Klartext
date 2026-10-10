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
import { labels, t, tn } from '@/i18n'

// Targets from 01_PRD.md section 8.
const TARGET = { recall: 0.95, precision: 0.8, evidence: 0.9, cleanNoisy: 0.9, pairs: 8 }
const SPLIT_LABEL: Record<EvalSplit, string> = labels({
  dev: 'quality.split.dev',
  holdout: 'quality.split.holdout',
  all: 'quality.split.all',
})
const LEVEL_LABEL: Record<string, string> = labels({
  '1': 'quality.level.1',
  '2': 'quality.level.2',
  '3': 'quality.level.3',
})
const two = (x: number | null) => (x === null ? '–' : x.toFixed(2))
const pct = (x: number) => `${Math.round(x * 100)}%`
const shortId = (id: string) => id.replace(/^Stufe\d_/, '')

type Status = 'meets' | 'below' | 'none' | 'unmeasured'

function StatusLine({ status }: { status: Status }) {
  if (status === 'meets')
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-medium text-clear">
        <Check size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('quality.meets')}
      </span>
    )
  if (status === 'below')
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-medium text-alarm">
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('quality.below')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-muted">
      <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
      {status === 'none' ? t('quality.noTarget') : t('quality.unmeasured')}
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
  const meets = (v: number, target: number): Status => (v >= target ? 'meets' : 'below')
  return [
    {
      label: t('quality.recall'),
      value: cases ? two(b.recall) : '–',
      detail: t('quality.recallDetail', { tp: b.tp, cases, target: TARGET.recall.toFixed(2) }),
      status: cases ? meets(b.recall, TARGET.recall) : ('unmeasured' as Status),
    },
    {
      label: t('quality.precision'),
      value: flagged ? two(b.precision) : '–',
      detail: t('quality.precisionDetail', { tp: b.tp, flagged, target: TARGET.precision.toFixed(2) }),
      status: flagged ? meets(b.precision, TARGET.precision) : ('unmeasured' as Status),
    },
    {
      label: t('quality.exact'),
      value: two(m.exact.accuracy),
      detail: t('quality.exactDetail', { a: m.exact.correct, b: m.exact.total }),
      status: 'none' as Status,
    },
    {
      label: t('quality.evidence'),
      value: ev && ev.measurable ? pct(ev.hit / ev.measurable) : '–',
      detail: ev
        ? t('quality.evidenceDetail', { hit: ev.hit, n: ev.measurable, target: pct(TARGET.evidence) })
        : t('quality.evidenceNone', { target: pct(TARGET.evidence) }),
      status: ev && ev.measurable ? meets(ev.hit / ev.measurable, TARGET.evidence) : ('unmeasured' as Status),
    },
    {
      label: t('quality.cleanNoisy'),
      value: cn_.total ? pct(cn_.agree / cn_.total) : '–',
      detail: cn_.total
        ? t('quality.cleanNoisyDetail', { a: cn_.agree, b: cn_.total, target: pct(TARGET.cleanNoisy) })
        : t('quality.cleanNoisyNone', { target: pct(TARGET.cleanNoisy) }),
      status: cn_.total ? meets(cn_.agree / cn_.total, TARGET.cleanNoisy) : ('unmeasured' as Status),
    },
  ]
}

const GROUPS: { key: BreakdownRow['group']; label: 'quality.byLevel' | 'quality.byFamily' | 'quality.byAudio' }[] = [
  { key: 'level', label: 'quality.byLevel' },
  { key: 'family', label: 'quality.byFamily' },
  { key: 'variant', label: 'quality.byAudio' },
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
      ? t('quality.sentToReview', { a: m.stufe3_review.reviewed, b: m.stufe3_review.total })
      : '')
  return (
    <section aria-label={t('quality.breakdown')} className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">{t('quality.breakdown')}</h3>
        <Segmented
          label={t('quality.breakdown')}
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'level', label: t('quality.level') },
            { value: 'family', label: t('quality.family') },
            { value: 'variant', label: t('quality.audio') },
          ]}
        />
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('quality.group')}</th>
              <th className={cn(th, 'text-right')}>{t('quality.calls')}</th>
              <th className={cn(th, 'text-right')}>{t('quality.cases')}</th>
              <th className={cn(th, 'text-right')}>{t('quality.recall')}</th>
              <th className={cn(th, 'text-right')}>{t('quality.precision')}</th>
              <th className={th}>{t('quality.note')}</th>
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
                  {t(g.label)}
                  {g.key === 'family' &&
                    m.family_accuracy.total > 0 &&
                    t('quality.familyRight', { a: m.family_accuracy.correct, b: m.family_accuracy.total })}
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
      aria-label={t('quality.pairs')}
      className="overflow-hidden rounded-panel border border-line bg-paper"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">{t('quality.pairs')}</h3>
        <span className="text-small text-muted">
          {t('quality.pairsRight', { a: right, b: m.stufe2_pairs.length, target: TARGET.pairs })}
        </span>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t('quality.pair')}</th>
              <th className={th}>{t('quality.family')}</th>
              <th className={th}>{t('quality.fraudSide')}</th>
              <th className={th}>{t('quality.harmlessSide')}</th>
              <th className={th}>{t('quality.bothRight')}</th>
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
                      {t('common.yes')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-medium text-alarm">
                      <X size={16} strokeWidth={1.75} aria-hidden="true" />
                      {t('common.no')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.stufe2_pairs.length === 0 && <p className="m-0 px-4 py-6 text-muted">{t('quality.noPairs')}</p>}
      </div>
    </section>
  )
}

function Mismatches({ m }: { m: EvalMetrics }) {
  const name = (id: string) => {
    const k = /-K([1-4])$/.exec(id)
    const base = shortId(id.replace(/-K[1-4]$/, ''))
    return k ? `${base} · ${VARIANT_LABEL[['1', '3'].includes(k[1]) ? 'clean' : 'noisy']}` : id
  }
  return (
    <section aria-label={t('quality.mismatches')} className="overflow-hidden rounded-panel border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
        <h3 className="text-subtitle font-medium">{t('quality.mismatches')}</h3>
        <Link to="/calls?mismatches=1" className="text-small underline hover:text-muted">
          {t('quality.showInAll')}
        </Link>
      </div>
      {m.mismatches.length === 0 ? (
        <p className="m-0 border-t border-line px-4 py-6 text-muted">
          {t('quality.noMismatch')}
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{t('quality.call')}</th>
                <th className={th}>{t('quality.expectedVs')}</th>
                <th className={th}>{t('quality.why')}</th>
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
                    {x.caught ? t('quality.caught') : ''}
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
      aria-label={t('quality.baseline')}
      className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5"
    >
      <h3 className="text-subtitle font-medium">{t('quality.baseline')}</h3>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <td />
            <th scope="col" className="pb-1 text-right text-small font-normal text-muted">
              {t('quality.keywordFilter')}
            </th>
            <th scope="col" className="pb-1 pl-6 text-right text-small font-normal text-muted">
              Klartext
            </th>
          </tr>
        </thead>
        <tbody>
          {[
            [t('quality.flaggedCalls'), String(k.flagged), String(b.tp + b.fp)],
            [t('quality.precision'), two(k.precision), two(b.precision)],
            [t('quality.recall'), two(k.recall), two(b.recall)],
          ].map(([label, a, c]) => (
            <tr key={label}>
              <th scope="row" className="py-1 text-left font-normal">
                {label}
              </th>
              <td className="tabular py-1 text-right">{a}</td>
              <td className="tabular py-1 pl-6 text-right font-semibold">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 text-small text-muted">
        {t('quality.baselineNote')}
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

type RunView = 'holdout' | 'dev'

export default function Quality() {
  const qc = useQueryClient()
  const toast = useToast()
  // The B29 holdout run is shown read-only; new runs from this page are Dev only (rule 4: holdout runs once).
  const holdout = useQuery({ queryKey: ['eval', 'holdout'], queryFn: () => getLatestEval('holdout'), retry: false })
  const dev = useQuery({ queryKey: ['eval', 'dev'], queryFn: () => getLatestEval('dev'), retry: false })
  const is404 = (e: Error | null) => e instanceof ApiError && e.status === 404
  const [picked, setPicked] = useState<RunView>('holdout')
  const view: RunView = picked === 'holdout' && is404(holdout.error) ? 'dev' : picked
  const latest = view === 'holdout' ? holdout : dev
  const run = useMutation({
    mutationFn: () => runEval({ split: 'dev' }),
    onSuccess: (r) => {
      qc.setQueryData(['eval', 'dev'], r)
      qc.invalidateQueries({ queryKey: ['eval'] })
      setPicked('dev')
      toast(t('quality.ran', { id: r.run_id }))
    },
    onError: (e: Error) => toast(t('quality.notRun', { message: e.message }), 'error'),
  })
  const data = latest.data
  const m = data?.metrics
  const missing = is404(latest.error)

  return (
    <Page title={t('nav.quality')}>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">{t('quality.heading')}</h2>
          {data && m && (
            <p className="mt-1 max-w-[72ch] text-muted">
              {tn(data.source === 'asr' ? 'quality.introAsr' : 'quality.introScript', m.n_calls, {
                split: SPLIT_LABEL[data.split],
                id: data.run_id,
                when: formatProcessed(data.created_at),
                version: data.config_versions.thresholds ?? '–',
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <Button onClick={() => downloadReport(data)}>
              <Download strokeWidth={1.75} aria-hidden="true" />
              {t('quality.download')}
            </Button>
          )}
          <Segmented
            label={t('quality.runShown')}
            value={view}
            onChange={setPicked}
            options={[
              { value: 'holdout', label: t('quality.holdoutFinal'), disabled: is404(holdout.error) },
              { value: 'dev', label: t('quality.devLatest') },
            ]}
          />
          <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>
            <Play strokeWidth={1.75} aria-hidden="true" />
            {run.isPending ? t('quality.running') : t('quality.runDev')}
          </Button>
        </div>
      </section>
      <p className="-mt-4 m-0 text-small text-muted">
        {view === 'holdout'
          ? t('quality.holdoutNote')
          : t('quality.devNote')}
      </p>

      {latest.isPending && <p className="text-muted">{t('quality.loading')}</p>}
      {missing && (
        <p className="m-0 rounded-panel border border-line p-6 text-muted">
          {t('quality.noDevRun')} <b className="font-medium">{t('quality.runDev')}</b>.
        </p>
      )}
      {latest.error && !missing && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>{t('quality.loadError', { message: latest.error.message })}</span>
          <Button onClick={() => latest.refetch()}>{t('common.tryAgain')}</Button>
        </div>
      )}

      {m && (
        <>
          <section aria-label={t('quality.headline')} className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4">
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
                caption={t('quality.confusionCaption')}
              >
                <p className="m-0 rounded-panel bg-canvas px-4 py-3">
                  {t('quality.reviewNote', { n: m.confusion.matrix[0][1] })}
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
