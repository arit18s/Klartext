import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Info } from 'lucide-react'
import { Page } from '@/app/Page'
import { CallsTable } from '@/components/CallsTable'
import { FilterModal } from '@/components/FilterModal'
import { Switch } from '@/components/Switch'
import { Tag } from '@/components/Tag'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { exportCsv, getCalls } from '@/lib/api'
import { EMPTY_FILTERS, applyFilters, sortCalls, type FilterState } from '@/lib/filters'
import { matchKind } from '@/lib/format'
import { readFlag, writeFlag } from '@/lib/storage'
import { t, tn } from '@/i18n'

const EVAL_KEY = 'klartext.evalMode'

export default function AllCalls() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  // ?advisor=… (from the Advisors page) opens with that advisor's calls
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...EMPTY_FILTERS,
    advisor: params.get('advisor') || null,
  }))
  const [evalMode, setEvalMode] = useState(() => params.get('mismatches') === '1' || readFlag(EVAL_KEY, true))
  // ?mismatches=1 (from the Quality page) opens with evaluation mode and only mismatches on.
  const [onlyMismatches, setOnlyMismatches] = useState(() => params.get('mismatches') === '1')
  const toast = useToast()

  const calls = useQuery({ queryKey: ['calls', { q }], queryFn: () => getCalls(q ? { q } : {}) })
  const all = useMemo(() => sortCalls(calls.data?.items ?? []), [calls.data])
  const isMismatch = (c: (typeof all)[number]) => {
    const kind = matchKind(c.expected_verdict, c.verdict)
    return kind !== null && kind !== 'match'
  }
  const mismatches = all.filter(isMismatch).length
  const shown = useMemo(() => {
    const filtered = applyFilters(all, filters)
    return evalMode && onlyMismatches ? filtered.filter(isMismatch) : filtered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filters, evalMode, onlyMismatches])
  const counts = calls.data?.counts

  const download = async () => {
    try {
      const blob = await exportCsv()
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: 'klartext-results.csv' })
      a.click()
      URL.revokeObjectURL(url)
      toast(t('all.exported'))
    } catch (e) {
      toast(t('all.exportFailed', { message: (e as Error).message }), 'error')
    }
  }

  return (
    <Page title={t('nav.allCalls')}>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">{t('all.heading')}</h2>
          {counts && (
            <p className="mt-1 text-muted">
              {tn('common.calls', counts.total)} · {tn('common.alerts', counts.alarm)} ·{' '}
              {tn('common.reviews', counts.review)} · {t('all.noAlert', { n: counts.no_alert })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={evalMode}
            onChange={(v) => {
              setEvalMode(v)
              writeFlag(EVAL_KEY, v)
            }}
            label={t('all.evalMode')}
          />
          {evalMode && (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-control border border-line px-3 hover:bg-canvas">
              <input
                type="checkbox"
                className="h-4 w-4 accent-graphite"
                checked={onlyMismatches}
                onChange={(e) => setOnlyMismatches(e.target.checked)}
              />
              {t('all.onlyMismatches')} <Tag className="h-5">{mismatches}</Tag>
            </label>
          )}
          <FilterModal value={filters} onApply={setFilters} items={all} />
          <Button onClick={download}>
            <Download strokeWidth={1.75} aria-hidden="true" />
            {t('all.exportCsv')}
          </Button>
        </div>
      </section>

      {evalMode && (
        <div className="-mt-2 flex items-center gap-3 rounded-panel bg-canvas px-4 py-3">
          <Info size={16} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
          <span>{t('all.evalInfo')}</span>
        </div>
      )}

      {filters.advisor && (
        <div className="-mt-2 flex items-center gap-2">
          <span className="text-muted">{t('all.callsOf')}</span>
          <Tag
            className="text-graphite"
            onRemove={() => {
              setFilters({ ...filters, advisor: null })
              params.delete('advisor')
              setParams(params)
            }}
            removeLabel={t('all.everyAdvisor')}
          >
            {filters.advisor}
          </Tag>
        </div>
      )}

      {q && (
        <div className="-mt-2 flex items-center gap-2">
          <span className="text-muted">{t('all.searchFor')}</span>
          <Tag
            className="text-graphite"
            onRemove={() => {
              params.delete('q')
              setParams(params)
            }}
            removeLabel={t('all.clearSearch')}
          >
            {q}
          </Tag>
        </div>
      )}

      <section aria-label={t('nav.allCalls')} className="overflow-hidden rounded-panel border border-line bg-paper">
        {calls.isPending && <p className="m-0 px-4 py-6 text-muted">{t('inbox.loading')}</p>}
        {calls.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-4">
            <span>{t('inbox.loadError', { message: calls.error.message })}</span>
            <Button onClick={() => calls.refetch()}>{t('common.tryAgain')}</Button>
          </div>
        )}
        {calls.data && (
          <CallsTable
            items={shown}
            variant="all"
            evalMode={evalMode}
            noun={t('all.noun')}
            label={t('nav.allCalls')}
            empty={
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="m-0 text-muted">{q ? t('all.noQueryMatch', { q }) : t('all.noFilterMatch')}</p>
                <Button
                  onClick={() => {
                    setFilters(EMPTY_FILTERS)
                    setOnlyMismatches(false)
                    if (q) {
                      params.delete('q')
                      setParams(params)
                    }
                  }}
                >
                  {t('common.clearFilters')}
                </Button>
              </div>
            }
          />
        )}
      </section>
    </Page>
  )
}
