import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/app/Page'
import { Button, buttonVariants } from '@/components/ui/button'
import { getSettings } from '@/lib/api'

/** One setting: label, value (or "Not set"), and what it means. */
function Row({ label, value, help }: { label: string; value: ReactNode; help?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-6 gap-y-1 border-b border-line py-3 last:border-b-0 max-md:grid-cols-1">
      <dt className="font-medium">{label}</dt>
      <dd className="m-0 flex flex-col gap-0.5">
        <span className="break-all">{value}</span>
        {help && <span className="text-small text-muted">{help}</span>}
      </dd>
    </div>
  )
}

const notSet = (v: string) =>
  v ? <span className="tabular">{v}</span> : <span className="text-muted">Not set. Add it to .env on the server.</span>

function Panel({
  title,
  intro,
  children,
  footer,
}: {
  title: string
  intro: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-panel border border-line bg-paper p-5">
      <h3 className="text-subtitle font-medium">{title}</h3>
      <p className="m-0 max-w-[72ch] text-muted">{intro}</p>
      <dl className="m-0 mt-2">{children}</dl>
      {footer}
    </section>
  )
}

/** Read-only view of GET /api/settings. Values come from the server's .env; the API key is never sent. */
export default function Settings() {
  const { data, error, isPending, refetch } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const v = data?.config_versions
  return (
    <Page
      title="Settings"
      heading="Settings"
      intro="Where Klartext's models run and where its alerts go. These values come from the server's configuration and are read-only here."
    >
      {isPending && <p className="m-0 text-muted">Loading settings…</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>Could not load the settings. {error.message}</span>
          <Button onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-6">
          <Panel
            title="Language model"
            intro="Runs the family checks. Any OpenAI-compatible address works: OpenRouter for the sprint, a self-hosted vLLM server inside the bank later."
          >
            <Row
              label="Endpoint URL"
              value={notSet(data.llm_base_url)}
              help="Change this one value to move to vLLM. Nothing else needs to change."
            />
            <Row label="Model" value={notSet(data.llm_model)} help="Open-weight models only." />
            <Row label="API key" value={<span className="text-muted">Stored on the server. Never shown here.</span>} />
          </Panel>
          <Panel
            title="Speech to text"
            intro="Transcribes Swiss German with word timestamps and separates advisor from customer. Runs on our own GPU."
          >
            <Row label="Speech model" value={notSet(data.asr_model)} />
          </Panel>
          <Panel
            title="Outcept trigger API"
            intro="Klartext posts every alert and review here, with a link that opens the call at the suspicious passage."
          >
            <Row label="Trigger API URL" value={notSet(data.trigger_api_url)} />
            <Row
              label="Send alerts and reviews"
              value={data.trigger_api_enabled ? 'On' : 'Off'}
              help="Each post links to /calls/{call_id}?t={seconds}."
            />
          </Panel>
          <Panel
            title="Active config versions"
            intro="Every change to rules, keywords or thresholds writes a new version to the audit log."
            footer={
              <div className="pt-1">
                <Link to="/rules" className={buttonVariants({ size: 'md' })}>
                  Open rules
                </Link>
              </div>
            }
          >
            <Row label="Keywords" value={v?.keywords ?? '–'} />
            <Row label="Families" value={v?.families ?? '–'} />
            <Row label="Thresholds" value={v?.thresholds ?? '–'} />
            <Row label="Model" value={v?.model ?? '–'} />
          </Panel>
        </div>
      )}
    </Page>
  )
}
