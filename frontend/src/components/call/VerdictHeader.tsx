import { forwardRef, useState } from 'react'
import { Check, CircleHelp, MessageSquare, Play, Send, Siren, X, ZoomIn, type LucideIcon } from 'lucide-react'
import type { CallDetail, Feedback, FeedbackLabel } from '@/lib/types'
import { FAMILY_LABEL, formatClock } from '@/lib/format'
import { FEEDBACK_DONE } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { VerdictChip } from '../VerdictChip'
import { ScoreBar } from '../ScoreBar'
import { Segmented } from '../Segmented'
import { Button, type ButtonProps } from '../ui/button'
import { NoteDialog } from './NoteDialog'

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
  const [lang, setLang] = useState<'en' | 'de'>('en')
  const latest: Feedback | undefined = detail.feedback.at(-1)
  const is = (l: FeedbackLabel) => latest?.label === l
  const sent = [...detail.triggers]
    .reverse()
    .find((t) => t.status_code !== null && t.status_code >= 200 && t.status_code < 300)
  const flagged = decision.verdict !== 'no_alert'
  const reason = lang === 'de' && decision.reason_de ? decision.reason_de : decision.reason
  const give = (label: FeedbackLabel) => () => onFeedback({ label })

  return (
    <section aria-label="Verdict" className="flex flex-col gap-4 rounded-panel border border-line bg-paper p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <VerdictChip verdict={decision.verdict} size="lg" />
          <h2 className="text-title">{decision.family ? FAMILY_LABEL[decision.family] : 'No family decided'}</h2>
          <ScoreBar score={decision.score} verdict={decision.verdict} wide label="Score" />
        </div>
        {decision.reason_de && (
          <Segmented
            label="Reason language"
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
            <div className="font-semibold">Missing to decide</div>
            <div>{decision.open_question}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2" aria-busy={busy}>
          {decision.verdict === 'review' ? (
            <>
              <ActionButton icon={Siren} pressed={is('escalated_to_alarm')} onClick={give('escalated_to_alarm')}>
                Escalate as alarm
              </ActionButton>
              <ActionButton icon={Check} pressed={is('closed_no_alert')} onClick={give('closed_no_alert')}>
                Close as no alert
              </ActionButton>
              <NoteDialog
                title="Add note"
                description="The note is saved with your decision and written to the audit log."
                actions={[
                  { label: 'escalated_to_alarm', text: 'Escalate as alarm' },
                  { label: 'closed_no_alert', text: 'Close as no alert', primary: true },
                ]}
                onSubmit={onFeedback}
              >
                <ActionButton icon={MessageSquare} pressed={false}>
                  Add note
                </ActionButton>
              </NoteDialog>
            </>
          ) : (
            <>
              <ActionButton icon={Check} pressed={is('correct')} onClick={give('correct')}>
                Correct
              </ActionButton>
              {flagged && (
                <ActionButton icon={X} pressed={is('false_alarm')} onClick={give('false_alarm')}>
                  False alarm
                </ActionButton>
              )}
              <NoteDialog
                title="Missed something"
                description="Say what Klartext missed in this call. The note is written to the audit log."
                actions={[{ label: 'missed', text: 'Mark as missed', primary: true }]}
                onSubmit={onFeedback}
              >
                <ActionButton icon={ZoomIn} pressed={is('missed')}>
                  Missed something
                </ActionButton>
              </NoteDialog>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {latest && (
            <span className="text-small text-muted">
              {FEEDBACK_DONE[latest.label]} at {formatClock(latest.created_at)}
            </span>
          )}
          {sent ? (
            <span className="inline-flex items-center gap-1.5 text-small text-muted">
              <Send size={14} strokeWidth={1.75} aria-hidden="true" />
              Sent to Outcept at {formatClock(sent.created_at)}
            </span>
          ) : (
            flagged && <span className="text-small text-muted">Not sent to Outcept</span>
          )}
          <Button variant="primary" onClick={onOpenFullCall}>
            <Play strokeWidth={1.75} aria-hidden="true" />
            Open full call
          </Button>
        </div>
      </div>
    </section>
  )
}
