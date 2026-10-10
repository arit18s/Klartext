import { Link } from 'react-router-dom'
import { Page } from '@/app/Page'
import { t } from '@/i18n'

export default function NotFound() {
  return (
    <Page title={t('notFound.title')} heading={t('notFound.heading')}>
      <p>
        {t('notFound.body')}{' '}
        <Link to="/" className="underline">
          {t('nav.inbox')}
        </Link>
        .
      </p>
    </Page>
  )
}
