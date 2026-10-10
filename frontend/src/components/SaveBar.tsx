import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { t } from '@/i18n'

/** Sticky bar while a draft differs from the saved config: what changed, Discard, Save. */
export function SaveBar({
  children,
  saveLabel,
  onDiscard,
  onSave,
  saving,
}: {
  children: ReactNode
  saveLabel: string
  onDiscard: () => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div
      className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-paper px-4 py-3 shadow-modal"
      role="region"
      aria-label={t('common.unsavedChanges')}
    >
      <span>{children}</span>
      <div className="flex gap-2">
        <Button onClick={onDiscard} disabled={saving}>
          {t('common.discard')}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saving}>
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}
