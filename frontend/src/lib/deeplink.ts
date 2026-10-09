import type { Evidence, Segment } from './types'

/** Outcept deep links cue the audio 10 s before the passage: t = max(0, floor(start − 10)). */
export const PAD_S = 10

/**
 * The evidence card a deep link `?t=` points at: the passage whose padded window [start − 10, end] contains t,
 * preferring the trigger, then the passage that starts closest to t + 10.
 */
export function evidenceForTime(evidence: Evidence[], t: number): Evidence | null {
  const hits = evidence.filter((e) => t >= Math.floor(e.start_s - PAD_S) - 1 && t <= e.end_s)
  if (!hits.length) return null
  const dist = (e: Evidence) => Math.abs(e.start_s - PAD_S - t)
  return [...hits].sort((a, b) => Number(b.role === 'trigger') - Number(a.role === 'trigger') || dist(a) - dist(b))[0]
}

/** Segment playing at time t (or the last one that started before it). */
export function segmentAt(segments: Segment[], t: number): Segment | null {
  let found: Segment | null = null
  for (const s of segments) if (s.start_s <= t) found = s
  return found
}

export function parseT(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const t = Number(raw)
  return Number.isFinite(t) && t >= 0 ? t : null
}
