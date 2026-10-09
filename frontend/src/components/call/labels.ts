import type { SpeakerRole } from '@/lib/types'

export const SPEAKER_LABEL: Record<SpeakerRole, string> = {
  advisor: 'Advisor',
  customer: 'Customer',
  unknown: 'Speaker',
}
export const speaker = (role: SpeakerRole | null) => SPEAKER_LABEL[role ?? 'unknown']
