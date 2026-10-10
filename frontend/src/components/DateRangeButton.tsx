import { Calendar, ChevronDown } from 'lucide-react'
import { DATE_LABEL, type DateRange } from '@/lib/filters'
import { t } from '@/i18n'

/** "Last 7 days" button from the Inbox header. A native select, styled as a secondary button. */
export function DateRangeButton({ value, onChange }: { value: DateRange; onChange: (d: DateRange) => void }) {
  return (
    <label className="relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-control border border-line bg-paper pl-3.5 pr-8 font-medium hover:bg-canvas focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-graphite">
      <Calendar size={16} strokeWidth={1.75} aria-hidden="true" />
      <span aria-hidden="true">{DATE_LABEL[value]}</span>
      <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="absolute right-3 text-muted" />
      <select
        aria-label={t('filter.dateRange')}
        value={value}
        onChange={(e) => onChange(e.target.value as DateRange)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {(Object.keys(DATE_LABEL) as DateRange[]).map((d) => (
          <option key={d} value={d}>
            {DATE_LABEL[d]}
          </option>
        ))}
      </select>
    </label>
  )
}
