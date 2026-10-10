import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/Toast'
import { USE_FIXTURES, eventsUrl } from '@/lib/api'
import { VERDICT_LABEL } from '@/lib/format'
import { markArrived, subscribe, type Connection } from '@/lib/live'
import type { CallListResponse } from '@/lib/types'
import { lc, t } from '@/i18n'

const ConnectionContext = createContext<Connection>('connecting')
export const useLiveConnection = () => useContext(ConnectionContext)

/**
 * Subscribes once to GET /api/events. call_updated refreshes the call lists, that call's view and the scores;
 * pipeline_status replaces the cached pipeline state (sidebar dot, Pipeline page).
 */
export function LiveUpdates({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [connection, setConnection] = useState<Connection>('connecting')
  const wasLost = useRef(false)

  useEffect(
    () =>
      subscribe(
        (e) => {
          if (e.type === 'pipeline_status') {
            qc.setQueryData(['pipeline'], e.data)
            return
          }
          const { call_id, status, verdict } = e.data
          // New = not finished before this event. The sidebar keeps a call list loaded and refetches it on every event,
          // so a dropped call is already listed (queued, checking) by the time its "done" arrives.
          const lists = qc.getQueriesData<CallListResponse>({ queryKey: ['calls'] })
          const doneBefore = lists.some(([, d]) => d?.items.some((c) => c.call_id === call_id && c.status === 'done'))
          if (!doneBefore && status === 'done') {
            markArrived(call_id)
            if (verdict && verdict !== 'no_alert') toast(t('live.newCall', { verdict: lc(VERDICT_LABEL[verdict]), id: call_id }))
          }
          qc.invalidateQueries({ queryKey: ['calls'] })
          qc.invalidateQueries({ queryKey: ['call', call_id] })
          qc.invalidateQueries({ queryKey: ['scores'] })
        },
        (c) => {
          // Back after a lost connection: events in between were missed, so refetch everything once.
          if (c === 'open' && wasLost.current) qc.invalidateQueries()
          if (c === 'lost') wasLost.current = true
          if (c === 'open') wasLost.current = false
          setConnection(c)
        },
        USE_FIXTURES,
        eventsUrl,
      ),
    [qc, toast],
  )

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>
}
