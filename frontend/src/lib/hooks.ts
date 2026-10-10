import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/Toast'
import { postFeedback } from './api'
import type { FeedbackLabel } from './types'
import { labels, t } from '@/i18n'

/** Toast text per feedback label: past tense of the button verb. */
export const FEEDBACK_DONE: Record<FeedbackLabel, string> = labels({
  correct: 'feedback.correct',
  false_alarm: 'feedback.false_alarm',
  missed: 'feedback.missed',
  escalated_to_alarm: 'feedback.escalated_to_alarm',
  closed_no_alert: 'feedback.closed_no_alert',
  note: 'feedback.note',
})

export function useFeedback() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (v: { callId: string; label: FeedbackLabel; note?: string | null; name?: string }) =>
      postFeedback(v.callId, { label: v.label, note: v.note ?? null }),
    onSuccess: (_fb, v) => {
      toast(v.name ? `${FEEDBACK_DONE[v.label]}: ${v.name}` : FEEDBACK_DONE[v.label])
      qc.invalidateQueries({ queryKey: ['calls'] })
      qc.invalidateQueries({ queryKey: ['call', v.callId] })
    },
    onError: (e: Error) => toast(t('feedback.notSaved', { message: e.message }), 'error'),
  })
}
