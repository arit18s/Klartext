import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/app/Page'
import { Button, buttonVariants } from '@/components/ui/button'
import { getSettings } from '@/lib/api'
import { t } from '@/i18n'

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
  v ? <span className="tabular">{v}</span> : <span className="text-muted">{t('settings.notSet')}</span>

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
      title={t('nav.settings')}
      heading={t('nav.settings')}
      intro={t('settings.intro')}
    >
      {isPending && <p className="m-0 text-muted">{t('settings.loading')}</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-4">
          <span>{t('settings.loadError', { message: error.message })}</span>
          <Button onClick={() => refetch()}>{t('common.tryAgain')}</Button>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-6">
          <Panel
            title={t('settings.llm')}
            intro={t('settings.llmIntro')}
          >
            <Row
              label={t('settings.endpoint')}
              value={notSet(data.llm_base_url)}
              help={t('settings.endpointHelp')}
            />
            <Row label={t('settings.model')} value={notSet(data.llm_model)} help={t('settings.openWeight')} />
            <Row label={t('settings.apiKey')} value={<span className="text-muted">{t('settings.apiKeyValue')}</span>} />
          </Panel>
          <Panel
            title={t('settings.asr')}
            intro={t('settings.asrIntro')}
          >
            <Row label={t('settings.speechModel')} value={notSet(data.asr_model)} />
          </Panel>
          <Panel
            title={t('settings.trigger')}
            intro={t('settings.triggerIntro')}
          >
            <Row label={t('settings.triggerUrl')} value={notSet(data.trigger_api_url)} />
            <Row
              label={t('settings.send')}
              value={data.trigger_api_enabled ? t('common.on') : t('common.off')}
              help={t('settings.sendHelp')}
            />
          </Panel>
          <Panel
            title={t('settings.versions')}
            intro={t('settings.versionsIntro')}
            footer={
              <div className="pt-1">
                <Link to="/rules" className={buttonVariants({ size: 'md' })}>
                  {t('settings.openRules')}
                </Link>
              </div>
            }
          >
            <Row label={t('settings.keywords')} value={v?.keywords ?? '–'} />
            <Row label={t('settings.families')} value={v?.families ?? '–'} />
            <Row label={t('settings.thresholds')} value={v?.thresholds ?? '–'} />
            <Row label={t('settings.model')} value={v?.model ?? '–'} />
          </Panel>
        </div>
      )}
    </Page>
  )
}
