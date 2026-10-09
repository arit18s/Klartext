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
  // EventSource reconnects on its own; we only report the state.
  const source = new EventSource(url)
  onConnection('connecting')
  const parse = (type: LiveEvent['type']) => (m: MessageEvent<string>) => {
    try {
      onEvent({ type, data: JSON.parse(m.data) } as LiveEvent)
    } catch {
      // A malformed event is skipped; the next one or a refetch brings the state back.
    }
  }
  source.addEventListener('call_updated', parse('call_updated'))
  source.addEventListener('pipeline_status', parse('pipeline_status'))
  source.onopen = () => onConnection('open')
  source.onerror = () => onConnection(source.readyState === EventSource.CLOSED ? 'lost' : 'connecting')
  return () => {
    handlers.delete(onEvent)
    source.close()
  }
}

// Calls that just arrived through a live event: their row slides into the Inbox (04_FRONTEND_GUIDELINES.md section 7).
// Kept as timestamps, not a consume-once flag, so React's double render in development doesn't swallow it.
const arrived = new Map<string, number>()
export const markArrived = (callId: string) => arrived.set(callId, Date.now())
export const arrivedRecently = (callId: string, withinMs = 2000) => Date.now() - (arrived.get(callId) ?? 0) < withinMs
