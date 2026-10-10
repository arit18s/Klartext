import type { SpeakerRole } from '@/lib/types'
import { labels } from '@/i18n'

export const SPEAKER_LABEL: Record<SpeakerRole, string> = labels({
  advisor: 'speaker.advisor',
  customer: 'speaker.customer',
  unknown: 'speaker.unknown',
})
export const speaker = (role: SpeakerRole | null) => SPEAKER_LABEL[role ?? 'unknown']
