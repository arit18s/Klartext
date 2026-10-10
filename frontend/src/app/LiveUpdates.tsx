import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/Toast'
import { USE_FIXTURES, eventsUrl } from '@/lib/api'
import { VERDICT_LABEL } from '@/lib/format'
import { markArrived, subscribe, type Connection } from '@/lib/live'
import type { CallListResponse } from '@/lib/types'

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

  useEffect(
    () =>
      subscribe(
        (e) => {
          if (e.type === 'pipeline_status') {
            qc.setQueryData(['pipeline'], e.data)
            return
          }
          const { call_id, status, verdict } = e.data
          const lists = qc.getQueriesData<CallListResponse>({ queryKey: ['calls'] })
          const known = lists.some(([, d]) => d?.items.some((c) => c.call_id === call_id))
          if (!known && status === 'done') {
            markArrived(call_id)
            if (verdict && verdict !== 'no_alert') toast(`New ${VERDICT_LABEL[verdict].toLowerCase()}: ${call_id}`)
          }
          qc.invalidateQueries({ queryKey: ['calls'] })
          qc.invalidateQueries({ queryKey: ['call', call_id] })
          qc.invalidateQueries({ queryKey: ['scores'] })
        },
        setConnection,
        USE_FIXTURES,
        eventsUrl,
      ),
    [qc, toast],
  )

  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>
}
