import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { NotBuiltYet, Page } from '@/app/Page'
import { PageTitle } from '@/app/TopBar'
import { Tag } from '@/components/Tag'
import { getCall } from '@/lib/api'
import { formatDuration, formatProcessed, recordingName } from '@/lib/format'

export default function CallView() {
  const { id = '' } = useParams()
  const { data, error, isPending } = useQuery({ queryKey: ['call', id], queryFn: () => getCall(id) })
  const call = data?.call
  const rec = recordingName(call ?? { call_id: id, dialogue_id: null, variant: null })

  const title = (
    <>
      <Link to="/" className="inline-flex items-center gap-1 text-muted hover:text-graphite">
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        Inbox
      </Link>
      <span className="text-line" aria-hidden="true">
        /
      </span>
      <PageTitle>{rec.name}</PageTitle>
      {rec.variant && <Tag>{rec.variant}</Tag>}
      {call && (
        <span className="text-small text-muted">
          {[formatDuration(call.duration_s), call.advisor_name, `processed ${formatProcessed(call.processed_at)}`]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </>
  )

  return (
    <Page title={title}>
      {isPending && <p className="text-muted">Loading call…</p>}
      {error && (
        <p role="alert">
          Could not open {id}. {error.message} Open it again from All calls.
        </p>
      )}
      {data && <NotBuiltYet step="F3" />}
    </Page>
  )
}
