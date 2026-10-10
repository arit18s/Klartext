// Live updates (GET /api/events, server-sent events): call_updated and pipeline_status.
// With the backend this wraps an EventSource. In fixture mode the pipeline simulator in api.ts emits the same events.
import type { CallUpdatedEvent, PipelineStatus } from './types'

export type LiveEvent =
  | { type: 'call_updated'; data: CallUpdatedEvent }
  | { type: 'pipeline_status'; data: PipelineStatus }
type Handler = (e: LiveEvent) => void

const handlers = new Set<Handler>()

/** Fixture mode only: deliver an event as if it came from the server. */
export function emit(e: LiveEvent) {
  for (const h of handlers) h(e)
}

export type Connection = 'connecting' | 'open' | 'lost'
const RETRY_MIN_MS = 3000
const RETRY_MAX_MS = 15000

/** Subscribe to live events. Returns an unsubscribe function. */
export function subscribe(
  onEvent: Handler,
  onConnection: (c: Connection) => void,
  useFixtures: boolean,
  url: string,
): () => void {
  handlers.add(onEvent)
  if (useFixtures) {
    onConnection('open')
    return () => handlers.delete(onEvent)
  }
  // EventSource retries a dropped network connection on its own, but gives up for good (CLOSED) when the server
  // answers with an error, e.g. the dev proxy while the backend restarts. Then we open a new one after a delay.
  let source: EventSource | null = null
  let retry: number | null = null
  let delay = RETRY_MIN_MS
  let stopped = false
  const parse = (type: LiveEvent['type']) => (m: MessageEvent<string>) => {
    try {
      onEvent({ type, data: JSON.parse(m.data) } as LiveEvent)
    } catch {
      // A malformed event is skipped; the next one or a refetch brings the state back.
    }
  }
  const connect = () => {
    retry = null
    source = new EventSource(url)
    onConnection('connecting')
    source.addEventListener('call_updated', parse('call_updated'))
    source.addEventListener('pipeline_status', parse('pipeline_status'))
    source.onopen = () => {
      delay = RETRY_MIN_MS
      onConnection('open')
    }
    source.onerror = () => {
      if (source?.readyState !== EventSource.CLOSED) return onConnection('connecting')
      onConnection('lost')
      source.close()
      if (!stopped) retry = window.setTimeout(connect, delay)
      delay = Math.min(delay * 2, RETRY_MAX_MS)
    }
  }
  connect()
  return () => {
    stopped = true
    handlers.delete(onEvent)
    if (retry !== null) window.clearTimeout(retry)
    source?.close()
  }
}

// Calls that just arrived through a live event: their row slides into the Inbox (04_FRONTEND_GUIDELINES.md section 7).
// Kept as timestamps, not a consume-once flag, so React's double render in development doesn't swallow it.
const arrived = new Map<string, number>()
export const markArrived = (callId: string) => arrived.set(callId, Date.now())
export const arrivedRecently = (callId: string, withinMs = 2000) => Date.now() - (arrived.get(callId) ?? 0) < withinMs
