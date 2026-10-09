import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/Toast'
import { postFeedback } from './api'
import type { FeedbackLabel } from './types'

/** Toast text per feedback label: past tense of the button verb. */
export const FEEDBACK_DONE: Record<FeedbackLabel, string> = {
  correct: 'Marked as correct',
  false_alarm: 'Marked as false alarm',
  missed: 'Marked as missed',
  escalated_to_alarm: 'Escalated as alarm',
  closed_no_alert: 'Closed as no alert',
}

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
    onError: (e: Error) => toast(`Feedback was not saved. ${e.message}`, 'error'),
  })
}
