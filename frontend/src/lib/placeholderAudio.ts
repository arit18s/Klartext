// Fixture mode only: the fixtures have no recordings yet, so the player gets a generated stand-in.
// Very quiet noise bursts during each transcript segment (so the waveform has shape), silence between.
// Real audio comes from GET /api/calls/{id}/audio once the backend runs.
import type { Segment } from './types'

const RATE = 8000

function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/** 16-bit mono WAV, 8 kHz, of the call's full duration. */
export function placeholderWav(seed: string, duration: number, segments: Segment[]): Blob {
  const n = Math.ceil(duration * RATE)
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, RATE, true)
  v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 2, true)

  const rand = seededRandom(seed)
  for (const s of segments) {
    const from = Math.floor(s.start_s * RATE)
    const to = Math.min(n, Math.floor(s.end_s * RATE))
    const wobble = 2 + rand() * 3 // syllable-ish rhythm, 2–5 Hz
    const phase = rand() * Math.PI * 2
    for (let i = from; i < to; i++) {
      const t = i / RATE
      const env = Math.max(0, Math.sin(2 * Math.PI * wobble * t + phase)) * (0.5 + 0.5 * Math.sin(0.7 * t + phase))
      v.setInt16(44 + i * 2, Math.round((rand() * 2 - 1) * env * 0.03 * 32767), true)
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}
