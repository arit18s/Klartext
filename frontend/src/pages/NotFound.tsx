import { Link } from 'react-router-dom'
import { Page } from '@/app/Page'

export default function NotFound() {
  return (
    <Page title="Page not found" heading="This page does not exist.">
      <p>
        Check the link, or go back to the{' '}
        <Link to="/" className="underline">
          Inbox
        </Link>
        .
      </p>
    </Page>
  )
}
