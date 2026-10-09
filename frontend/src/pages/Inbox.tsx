import { NotBuiltYet, Page } from '@/app/Page'

export default function Inbox() {
  return (
    <Page
      title="Inbox"
      heading="Needs attention"
      intro="Alarms first, then reviews, highest score on top."
    >
      <NotBuiltYet step="F2" />
    </Page>
  )
}
