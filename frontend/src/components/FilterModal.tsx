import { useMemo, useState, type ReactNode } from 'react'
import { Filter } from 'lucide-react'
import type { CallSummary, Level, Variant } from '@/lib/types'
import { FAMILY_LABEL } from '@/lib/format'
import {
  DATE_LABEL,
  EMPTY_FILTERS,
  FAMILIES,
  VERDICTS,
  applyFilters,
  filterChips,
  type DateRange,
  type FilterState,
} from '@/lib/filters'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Button } from './ui/button'
import { Tag } from './Tag'
import { Segmented } from './Segmented'
import { VerdictChip } from './VerdictChip'

function Section({ legend, children, className }: { legend: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`m-0 flex min-w-0 flex-col gap-2.5 rounded-panel border border-line p-4 ${className ?? ''}`}>
      <legend className="float-left mb-2.5 p-0 font-medium">{legend}</legend>
      {children}
    </fieldset>
  )
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-graphite"
      />
      {children}
    </label>
  )
}

const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((x) => x !== value))
const selectClass = 'h-9 w-full rounded-control border border-line bg-paper px-3 text-body text-graphite'

/**
 * Filter modal (Klartext.html "1c · Filter modal"). Edits a draft; "Apply filters · N calls" commits it.
 * An empty family or verdict list means "all", so a checked box list starts fully checked.
 */
export function FilterModal({
  value,
  onApply,
  items,
  verdicts = VERDICTS,
}: {
  value: FilterState
  onApply: (f: FilterState) => void
  items: CallSummary[]
  verdicts?: typeof VERDICTS
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const advisors = useMemo(
    () => [...new Set(items.map((c) => c.advisor_name).filter((a): a is string => !!a))].sort(),
    [items],
  )
  const count = applyFilters(items, draft).length
  const activeCount = filterChips(value).length
  const verdictChecked = (v: (typeof VERDICTS)[number]) => draft.verdict.length === 0 || draft.verdict.includes(v)
  const familyChecked = (f: (typeof FAMILIES)[number]) => draft.family.length === 0 || draft.family.includes(f)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft(value)
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Filter strokeWidth={1.75} aria-hidden="true" />
          Filters
          {activeCount > 0 && <Tag className="h-5">{activeCount}</Tag>}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel="Close filters">
        <DialogHeader>
          <DialogTitle>Filter calls</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Section legend="Verdict">
            <div className="flex flex-wrap gap-4">
              {verdicts.map((v) => (
                <Check
                  key={v}
                  checked={verdictChecked(v)}
                  onChange={(on) =>
                    setDraft({ ...draft, verdict: toggle(draft.verdict.length ? draft.verdict : verdicts, v, on) })
                  }
                >
                  <VerdictChip verdict={v} />
                </Check>
              ))}
            </div>
          </Section>
          <Section legend="Family">
            {FAMILIES.map((f) => (
              <Check
                key={f}
                checked={familyChecked(f)}
                onChange={(on) =>
                  setDraft({ ...draft, family: toggle(draft.family.length ? draft.family : FAMILIES, f, on) })
                }
              >
                {FAMILY_LABEL[f]}
              </Check>
            ))}
          </Section>
          <Section legend="Level">
            <Segmented
              label="Level"
              value={draft.level === null ? 'all' : String(draft.level)}
              onChange={(v) => setDraft({ ...draft, level: v === 'all' ? null : (Number(v) as Level) })}
              options={[
                { value: 'all', label: 'All' },
                { value: '1', label: 'Stufe 1' },
                { value: '2', label: 'Stufe 2' },
                { value: '3', label: 'Stufe 3' },
              ]}
            />
          </Section>
          <Section legend="Audio">
            <Segmented
              label="Audio"
              value={draft.variant.length === 1 ? draft.variant[0] : 'both'}
              onChange={(v) => setDraft({ ...draft, variant: v === 'both' ? ['clean', 'noisy'] : [v as Variant] })}
              options={[
                { value: 'both', label: 'Both' },
                { value: 'clean', label: 'Clean' },
                { value: 'noisy', label: 'Noisy' },
              ]}
            />
          </Section>
          <div className="flex gap-3">
            <Section legend="Date" className="flex-1">
              <select
                aria-label="Date range"
                className={selectClass}
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value as DateRange })}
              >
                {(Object.keys(DATE_LABEL) as DateRange[]).map((d) => (
                  <option key={d} value={d}>
                    {DATE_LABEL[d]}
                  </option>
                ))}
              </select>
            </Section>
            <Section legend="Advisor" className="flex-1">
              <select
                aria-label="Advisor"
                className={selectClass}
                value={draft.advisor ?? ''}
                onChange={(e) => setDraft({ ...draft, advisor: e.target.value || null })}
              >
                <option value="">All advisors</option>
                {advisors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Section>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => setDraft({ ...EMPTY_FILTERS, date: draft.date })}>Clear all</Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(draft)
              setOpen(false)
            }}
          >
            Apply filters · {count} {count === 1 ? 'call' : 'calls'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
