import { forwardRef, useState } from 'react'
import { Check, CircleHelp, MessageSquare, Play, Printer, Send, Siren, X, ZoomIn, type LucideIcon } from 'lucide-react'
import type { CallDetail, Feedback, FeedbackLabel } from '@/lib/types'
import { FAMILY_LABEL, RAISED_BY_LABEL, formatClock } from '@/lib/format'
import { FEEDBACK_DONE } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { VerdictChip } from '../VerdictChip'
import { ScoreBar } from '../ScoreBar'
import { Segmented } from '../Segmented'
import { Button, type ButtonProps } from '../ui/button'
import { NoteDialog } from './NoteDialog'
import { getLang, t } from '@/i18n'

/** Browser print to PDF (D30). The document title becomes the suggested PDF file name. */
function printReport(callId: string) {
  const before = document.title
  document.title = t('verdictHeader.printTitle', { id: callId })
  window.addEventListener('afterprint', () => (document.title = before), { once: true })
  window.print()
}

export interface FeedbackAction {
  label: FeedbackLabel
  note?: string | null
}

// forwardRef + rest props: Radix DialogTrigger (asChild) passes its ref and handlers through.
const ActionButton = forwardRef<HTMLButtonElement, ButtonProps & { icon: LucideIcon; pressed: boolean }>(
  ({ icon: Icon, pressed, children, className, ...rest }, ref) => (
    <Button
      ref={ref}
      aria-pressed={pressed}
      className={cn(pressed && 'border-graphite bg-canvas', className)}
      {...rest}
    >
      <Icon strokeWidth={1.75} aria-hidden="true" />
      {children}
    </Button>
  ),
)
ActionButton.displayName = 'ActionButton'

/** Verdict, family, score, reason (English/Deutsch), open question, feedback actions, Outcept status. */
export function VerdictHeader({
  detail,
  onFeedback,
  onOpenFullCall,
  busy,
}: {
  detail: CallDetail
  onFeedback: (a: FeedbackAction) => void
  onOpenFullCall: () => void
  busy: boolean
}) {
  const decision = detail.decision!
  // The reason starts in the interface language (the tree re-mounts when it changes); the switch still overrides it.
  const [lang, setLang] = useState<'en' | 'de'>(getLang)
  const latest: Feedback | undefined = detail.feedback.at(-1)
  const lastVerdict = [...detail.feedback].reverse().find((f) => f.label !== 'note')
  const is = (l: FeedbackLabel) => lastVerdict?.label === l
  const sent = [...detail.triggers]
    .reverse()
    .find((tr) => tr.status_code !== null && tr.status_code >= 200 && tr.status_code < 300)
  const flagged = decision.verdict !== 'no_alert'
  const reason = lang === 'de' && decision.reason_de ? decision.reason_de : decision.reason
  const give = (label: FeedbackLabel) => () => onFeedback({ label })

  return (
    <section
      aria-label={t('verdictHeader.label')}
      className="flex break-inside-avoid flex-col gap-4 rounded-panel border border-line bg-paper p-6 print:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <VerdictChip verdict={decision.verdict} size="lg" />
          <h2 className="text-title">{decision.family ? FAMILY_LABEL[decision.family] : t('verdictHeader.noFamily')}</h2>
          <ScoreBar score={decision.score} verdict={decision.verdict} wide label={t('verdictHeader.score')} />
          {flagged && detail.call.raised_by && (
            <span className="text-small text-muted">
              {t('verdictHeader.raisedBy', { who: RAISED_BY_LABEL[detail.call.raised_by] })}
            </span>
          )}
        </div>
        {decision.reason_de && (
          <Segmented
            className="print:hidden"
            label={t('verdictHeader.reasonLanguage')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
            ]}
          />
        )}
      </div>

      {reason && (
        <p className="m-0 max-w-[72ch] text-[15px] leading-6" lang={lang === 'de' ? 'de' : 'en'}>
          {reason}
        </p>
      )}

      {decision.verdict === 'review' && decision.open_question && (
        <div className="flex max-w-[860px] items-start gap-3 rounded-panel bg-review-soft p-4">
          <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 flex-none text-review" />
          <div>
            <div className="font-semibold">{t('verdictHeader.missing')}</div>
            <div>{decision.open_question}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2 print:hidden" aria-busy={busy}>
          {decision.verdict === 'review' ? (
            <>
              <ActionButton icon={Siren} pressed={is('escalated_to_alarm')} onClick={give('escalated_to_alarm')}>
                {t('verdictHeader.escalate')}
              </ActionButton>
              <ActionButton icon={Check} pressed={is('closed_no_alert')} onClick={give('closed_no_alert')}>
                {t('verdictHeader.close')}
              </ActionButton>
              <NoteDialog
                title={t('verdictHeader.addNote')}
                description={t('verdictHeader.addNoteDesc')}
                actions={[{ label: 'note', text: t('verdictHeader.saveNote'), primary: true, needsNote: true }]}
                onSubmit={onFeedback}
              >
                <ActionButton icon={MessageSquare} pressed={false}>
                  {t('verdictHeader.addNote')}
                </ActionButton>
              </NoteDialog>
            </>
          ) : (
            <>
              <ActionButton icon={Check} pressed={is('correct')} onClick={give('correct')}>
                {t('verdictHeader.correct')}
              </ActionButton>
              {flagged && (
                <ActionButton icon={X} pressed={is('false_alarm')} onClick={give('false_alarm')}>
                  {t('verdictHeader.falseAlert')}
                </ActionButton>
              )}
              <NoteDialog
                title={t('verdictHeader.missed')}
                description={t('verdictHeader.missedDesc')}
                actions={[{ label: 'missed', text: t('verdictHeader.markMissed'), primary: true }]}
                onSubmit={onFeedback}
              >
                <ActionButton icon={ZoomIn} pressed={is('missed')}>
                  {t('verdictHeader.missed')}
                </ActionButton>
              </NoteDialog>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {latest && (
            <span className="text-small text-muted">
              {t('verdictHeader.doneAt', { what: FEEDBACK_DONE[latest.label], time: formatClock(latest.created_at) })}
            </span>
          )}
          {sent ? (
            <span className="inline-flex items-center gap-1.5 text-small text-muted">
              <Send size={14} strokeWidth={1.75} aria-hidden="true" />
              {t('verdictHeader.sentAt', { time: formatClock(sent.created_at) })}
            </span>
          ) : (
            flagged && <span className="text-small text-muted">{t('verdictHeader.notSent')}</span>
          )}
          <Button className="print:hidden" onClick={() => printReport(detail.call.call_id)}>
            <Printer strokeWidth={1.75} aria-hidden="true" />
            {t('verdictHeader.print')}
          </Button>
          <Button variant="primary" className="print:hidden" onClick={onOpenFullCall}>
            <Play strokeWidth={1.75} aria-hidden="true" />
            {t('verdictHeader.openFull')}
          </Button>
        </div>
      </div>
    </section>
  )
}
