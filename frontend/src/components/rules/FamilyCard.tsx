import type { Family, FamilyConfig } from '@/lib/types'
import { FAMILY_LABEL, formatProcessed } from '@/lib/format'
import { ToggleSwitch } from '../Switch'
import { t, tn } from '@/i18n'

const area = 'w-full resize-y rounded-control border border-line bg-paper p-3 text-body text-graphite'

/** One check: on/off, the rule in plain language and what counts as harmless. */
export function FamilyCard({
  family,
  cfg,
  keywords,
  onChange,
}: {
  family: Family
  cfg: FamilyConfig
  keywords: number
  onChange: (c: FamilyConfig) => void
}) {
  const name = FAMILY_LABEL[family]
  return (
    <section aria-label={name} className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-subtitle font-medium">{name}</h3>
          <span className="text-small text-muted">
            {family} · {tn('familyCard.keywords', keywords)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-small">
          <ToggleSwitch
            checked={cfg.enabled}
            onChange={(enabled) => onChange({ ...cfg, enabled })}
            label={t('familyCard.check', { name })}
          />
          <span className="w-6">{cfg.enabled ? t('common.on') : t('common.off')}</span>
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-small font-medium">{t('familyCard.rule')}</span>
        <textarea
          rows={3}
          className={area}
          value={cfg.rule}
          onChange={(e) => onChange({ ...cfg, rule: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-small font-medium">{t('familyCard.harmless')}</span>
        <textarea
          rows={3}
          className={area}
          value={cfg.harmless}
          placeholder={t('familyCard.harmlessPlaceholder')}
          onChange={(e) => onChange({ ...cfg, harmless: e.target.value })}
        />
      </label>
      <span className="text-small text-muted">
        {cfg.changed_at
          ? `${t('familyCard.lastChanged', { when: formatProcessed(cfg.changed_at) })}${cfg.changed_by ? ` · ${cfg.changed_by}` : ''}`
          : t('familyCard.unchanged')}
      </span>
    </section>
  )
}

/** The numbers helper: shown, never a verdict, not editable in the MVP. */
export function NumbersCard() {
  const kinds = (['login', 'account', 'amount', 'date', 'phone', 'reference'] as const).map((k) => t(`numbers.kinds.${k}`))
  return (
    <section aria-label={t('family.numbers')} className="flex flex-col gap-3 rounded-panel border border-line bg-canvas p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-subtitle font-medium">{t('family.numbers')}</h3>
          <span className="text-small text-muted">{t('numbers.sub')}</span>
        </div>
        <span className="inline-flex h-[22px] items-center rounded-full border border-line bg-paper px-2 text-[12px] text-muted">
          {t('numbers.helper')}
        </span>
      </div>
      <p className="m-0 max-w-[72ch]">
        {t('numbers.body')}
      </p>
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <span
            key={k}
            className="inline-flex h-[22px] items-center rounded-full border border-line bg-paper px-2 text-[12px] text-muted"
          >
            {k}
          </span>
        ))}
      </div>
      <span className="text-small text-muted">{t('numbers.notEditable')}</span>
    </section>
  )
}
