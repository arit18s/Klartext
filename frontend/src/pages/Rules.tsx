import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Sparkles, Trash2 } from 'lucide-react'
import { Page } from '@/app/Page'
import { SaveBar } from '@/components/SaveBar'
import { ToggleSwitch } from '@/components/Switch'
import { Tabs } from '@/components/Tabs'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { AddKeywordDialog, type NewKeyword } from '@/components/rules/AddKeywordDialog'
import { FamilyCard, NumbersCard } from '@/components/rules/FamilyCard'
import { PhraseList } from '@/components/rules/PhraseList'
import {
  getCalls,
  getFamilies,
  getKeywords,
  getLatestEval,
  putFamilies,
  putKeywords,
  rescanKeywords,
  suggestKeywordVariants,
} from '@/lib/api'
import { FAMILY_LABEL, FAMILY_SHORT, formatProcessed } from '@/lib/format'
import { t, tn } from '@/i18n'
import type { FamiliesConfig, Family, HelperFamily, KeywordList, KeywordsConfig, RescanResponse } from '@/lib/types'

type Tab = 'families' | 'keywords'
type AnyFamily = Family | HelperFamily
const VERDICT_FAMILIES: Family[] = ['trade', 'splitting', 'access', 'disclosure', 'documentation']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function VersionLine({ version, at }: { version: number; at: string }) {
  return (
    <span className="text-small text-muted">
      {t('rules.version', { version, when: formatProcessed(at) })}
    </span>
  )
}

// ---------- Families ----------

function FamiliesTab({ saved }: { saved: FamiliesConfig }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState(saved.families)
  useEffect(() => setDraft(saved.families), [saved])
  const changed = VERDICT_FAMILIES.filter((f) => !same(draft[f], saved.families[f]))

  const save = useMutation({
    mutationFn: () => putFamilies({ families: draft }),
    onSuccess: (v) => {
      toast(t('rules.saved', { version: v.version_id }))
      qc.setQueryData(['families'], v)
      qc.invalidateQueries({ queryKey: ['scores'] })
    },
    onError: (e: Error) => toast(t('rules.notSaved', { message: e.message }), 'error'),
  })

  return (
    <div id="panel-families" role="tabpanel" aria-labelledby="tab-families" className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-4">
        {VERDICT_FAMILIES.map((f) => (
          <FamilyCard
            key={f}
            family={f}
            cfg={draft[f]}
            keywords={draft[f].keyword_ids.length}
            onChange={(c) => setDraft({ ...draft, [f]: c })}
          />
        ))}
        <NumbersCard />
      </div>
      {changed.length > 0 && (
        <SaveBar
          saveLabel={t('rules.save')}
          saving={save.isPending}
          onDiscard={() => setDraft(saved.families)}
          onSave={() => save.mutate()}
        >
          {tn('rules.unsaved', changed.length, { families: changed.map((f) => FAMILY_LABEL[f]).join(', ') })}
        </SaveBar>
      )}
    </div>
  )
}

// ---------- Keywords ----------

function familyOf(list: KeywordList, id: string): AnyFamily | null {
  return (Object.keys(list.families) as AnyFamily[]).find((f) => list.families[f].keywords.includes(id)) ?? null
}

function KeywordsTab({
  saved,
  flaggedByKlartext,
  keywordOnlyBaseline,
}: {
  saved: KeywordsConfig
  flaggedByKlartext: number | null
  keywordOnlyBaseline: number | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState(saved.keywords)
  const [filter, setFilter] = useState<AnyFamily | 'all'>('all')
  const [rescan, setRescan] = useState<RescanResponse | null>(null)
  const [suggestions, setSuggestions] = useState<{ id: string; phrases: string[] } | null>(null)
  useEffect(() => setDraft(saved.keywords), [saved])
  const dirty = !same(draft, saved.keywords)

  const rows = draft.keywords.filter((k) => filter === 'all' || familyOf(draft, k.id) === filter)
  const update = (id: string, patch: Partial<KeywordList['keywords'][number]>) =>
    setDraft({ ...draft, keywords: draft.keywords.map((k) => (k.id === id ? { ...k, ...patch } : k)) })
  const remove = (id: string) =>
    setDraft({
      ...draft,
      keywords: draft.keywords.filter((k) => k.id !== id),
      families: Object.fromEntries(
        Object.entries(draft.families).map(([f, v]) => [f, { ...v, keywords: v.keywords.filter((x) => x !== id) }]),
      ) as KeywordList['families'],
    })
  const add = (k: NewKeyword) => {
    const max = Math.max(0, ...draft.keywords.map((x) => Number(x.id.replace(/\D/g, '')) || 0))
    const id = `K${String(max + 1).padStart(2, '0')}`
    setDraft({
      ...draft,
      keywords: [
        ...draft.keywords,
        {
          id,
          label: k.label,
          de: k.de,
          gsw: k.gsw,
          enabled: true,
          status: 'added_by_officer',
          match_unit: 'whole_phrase',
          partial_words_count_as_full_hit: false,
        },
      ],
      families: {
        ...draft.families,
        [k.family]: { ...draft.families[k.family], keywords: [...draft.families[k.family].keywords, id] },
      },
    })
  }

  const save = useMutation({
    mutationFn: async () => {
      const v = await putKeywords({ keywords: draft })
      return { v, diff: await rescanKeywords() }
    },
    onSuccess: ({ v, diff }) => {
      setRescan(diff)
      toast(t('rules.keywordsSaved', { version: v.version_id }))
      qc.setQueryData(['keywords'], v)
    },
    onError: (e: Error) => toast(t('rules.keywordsNotSaved', { message: e.message }), 'error'),
  })
  const suggest = useMutation({
    mutationFn: (id: string) => suggestKeywordVariants(id),
    onSuccess: (r) => setSuggestions({ id: r.keyword_id, phrases: r.suggestions }),
    onError: (e: Error) => toast(t('rules.noSuggestions', { message: e.message }), 'error'),
  })

  const keywordOnly = rescan?.keyword_only_flagged.after ?? keywordOnlyBaseline
  const harmlessByKeyword = keywordOnly !== null && flaggedByKlartext !== null ? keywordOnly - flaggedByKlartext : null
  const th = 'h-10 whitespace-nowrap border-b border-line px-4 text-left text-small font-medium text-muted'
  const td = 'border-b border-line px-4 py-2.5 align-middle'

  return (
    <div id="panel-keywords" role="tabpanel" aria-labelledby="tab-keywords" className="flex flex-col gap-4">
      {rescan && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-panel bg-canvas px-4 py-3">
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            {t('rules.rescan', {
              before: rescan.before,
              after: rescan.after,
              inCalls: rescan.changed_calls.length
                ? t('rules.inCalls', { calls: tn('common.calls', rescan.changed_calls.length) })
                : '',
            })}
          </span>
        </div>
      )}

      {keywordOnly !== null && flaggedByKlartext !== null && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
          <section
            aria-label={t('rules.compare')}
            className="flex items-center gap-6 rounded-panel border border-line bg-paper p-5"
          >
            <div>
              <div className="text-muted">{t('rules.filterAlone')}</div>
              <div className="tabular text-display">{tn('common.calls', keywordOnly)}</div>
            </div>
            <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
            <div>
              <div className="text-muted">{t('rules.klartextFlags')}</div>
              <div className="tabular text-display">{tn('common.calls', flaggedByKlartext)}</div>
            </div>
          </section>
          <section
            aria-label={t('rules.whyDiff')}
            className="flex flex-col gap-1 rounded-panel border border-line bg-paper p-5"
          >
            <h3 className="font-medium">{t('rules.whyDiff')}</h3>
            <p className="m-0 max-w-[72ch] text-muted">
              {harmlessByKeyword !== null && harmlessByKeyword > 0
                ? tn('rules.harmlessByKeyword', harmlessByKeyword)
                : t('rules.fromContext')}
            </p>
          </section>
        </div>
      )}

      <section aria-label={t('rules.keywords')} className="overflow-hidden rounded-panel border border-line bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <label className="flex items-center gap-2 text-small text-muted">
            {t('rules.family')}
            <select
              aria-label={t('rules.filterByFamily')}
              className="h-9 w-64 rounded-control border border-line bg-paper px-3 text-body text-graphite"
              value={filter}
              onChange={(e) => setFilter(e.target.value as AnyFamily | 'all')}
            >
              <option value="all">{t('rules.allFamilies')}</option>
              {(Object.keys(FAMILY_LABEL) as AnyFamily[]).map((f) => (
                <option key={f} value={f}>
                  {FAMILY_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <AddKeywordDialog onAdd={add} />
        </div>
        <div className="relative overflow-x-auto border-t border-line">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{t('rules.keyword')}</th>
                <th className={th}>{t('rules.family')}</th>
                <th className={th}>{t('rules.dePhrasesCol')}</th>
                <th className={th}>{t('rules.gswPhrasesCol')}</th>
                <th className={th}>{t('rules.on')}</th>
                <th className={th}>
                  <span className="sr-only">{t('rules.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => {
                const fam = familyOf(draft, k.id)
                return [
                  <tr key={k.id} className={k.enabled ? '' : 'text-muted'}>
                    <td className={`${td} min-w-[180px]`}>
                      <div className="font-medium">{k.label}</div>
                      <div className="text-small text-muted">{k.id}</div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-muted`}>{fam ? FAMILY_SHORT[fam] : '–'}</td>
                    <td className={`${td} min-w-[220px]`}>
                      <PhraseList
                        phrases={k.de}
                        onChange={(de) => update(k.id, { de })}
                        label={t('rules.dePhrasesOf', { label: k.label })}
                      />
                    </td>
                    <td className={`${td} min-w-[220px]`}>
                      <PhraseList
                        phrases={k.gsw}
                        onChange={(gsw) => update(k.id, { gsw })}
                        label={t('rules.gswPhrasesOf', { label: k.label })}
                      />
                    </td>
                    <td className={td}>
                      <ToggleSwitch
                        checked={k.enabled}
                        onChange={(enabled) => update(k.id, { enabled })}
                        label={t('rules.keywordToggle', { label: k.label })}
                      />
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('rules.suggestFor', { label: k.label })}
                        title={t('rules.suggestTitle')}
                        disabled={suggest.isPending}
                        onClick={() => suggest.mutate(k.id)}
                      >
                        <Sparkles strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('rules.deleteFor', { label: k.label })}
                        title={t('rules.deleteTitle')}
                        onClick={() => remove(k.id)}
                      >
                        <Trash2 strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>,
                  suggestions?.id === k.id && (
                    <tr key={`${k.id}-suggest`}>
                      <td colSpan={6} className="border-b border-line bg-canvas px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
                          <span>
                            {t('rules.suggestedFor')} <b className="font-semibold">{k.label}</b>:
                          </span>
                          {suggestions.phrases.length === 0 && <span className="text-muted">{t('rules.noneFound')}</span>}
                          {suggestions.phrases.map((p) => (
                            <span key={p} className="inline-flex items-center gap-2">
                              <span className="font-quote text-[15px] italic">{p}</span>
                              <Button
                                size="sm"
                                onClick={() => {
                                  update(k.id, { gsw: [...k.gsw, p] })
                                  setSuggestions({
                                    ...suggestions,
                                    phrases: suggestions.phrases.filter((x) => x !== p),
                                  })
                                }}
                              >
                                {t('rules.accept')}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  setSuggestions({
                                    ...suggestions,
                                    phrases: suggestions.phrases.filter((x) => x !== p),
                                  })
                                }
                              >
                                {t('rules.reject')}
                              </Button>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="m-0 px-4 py-8 text-center text-muted">{t('rules.noKeywords')}</p>}
        </div>
      </section>

      {dirty && (
        <SaveBar
          saveLabel={t('rules.saveKeywords')}
          saving={save.isPending}
          onDiscard={() => setDraft(saved.keywords)}
          onSave={() => save.mutate()}
        >
          {t('rules.unsavedKeywords')}
        </SaveBar>
      )}
    </div>
  )
}

// ---------- Page ----------

export default function Rules() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'keywords' ? 'keywords' : 'families'
  const families = useQuery({ queryKey: ['families'], queryFn: getFamilies })
  const keywords = useQuery({ queryKey: ['keywords'], queryFn: getKeywords })
  const calls = useQuery({ queryKey: ['calls', {}], queryFn: () => getCalls() })
  const evalRun = useQuery({ queryKey: ['eval'], queryFn: () => getLatestEval(), retry: false })
  const current = tab === 'families' ? families.data : keywords.data
  const error = tab === 'families' ? families.error : keywords.error
  const keywordCount = useMemo(() => keywords.data?.keywords.keywords.length, [keywords.data])

  return (
    <Page title={t('nav.rules')}>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-display">{t('rules.heading')}</h2>
          <p className="mt-1 max-w-[72ch] text-muted">
            {tab === 'families'
              ? t('rules.introFamilies')
              : t('rules.introKeywords')}
          </p>
        </div>
        {current && <VersionLine version={current.version_id} at={current.created_at} />}
      </section>

      <Tabs
        label={t('rules.tabs')}
        value={tab}
        onChange={(next) => setParams(next === 'families' ? {} : { tab: next }, { replace: true })}
        tabs={[
          { value: 'families', label: t('rules.families'), count: VERDICT_FAMILIES.length },
          { value: 'keywords', label: t('rules.keywords'), count: keywordCount },
        ]}
      />

      {!current && !error && (
        <p className="m-0 text-muted">{t(tab === 'families' ? 'rules.loadingFamilies' : 'rules.loadingKeywords')}</p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>
            {t(tab === 'families' ? 'rules.loadErrorFamilies' : 'rules.loadErrorKeywords', { message: error.message })}
          </span>
          <Button onClick={() => (tab === 'families' ? families.refetch() : keywords.refetch())}>{t('common.tryAgain')}</Button>
        </div>
      )}
      {tab === 'families' && families.data && <FamiliesTab saved={families.data} />}
      {tab === 'keywords' && keywords.data && (
        <KeywordsTab
          saved={keywords.data}
          flaggedByKlartext={calls.data?.counts.flagged ?? null}
          keywordOnlyBaseline={evalRun.data?.metrics.keyword_baseline.flagged ?? null}
        />
      )}
    </Page>
  )
}
