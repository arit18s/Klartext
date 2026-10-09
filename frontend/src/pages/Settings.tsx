import { NotBuiltYet, Page } from '@/app/Page'

export default function Settings() {
  return (
    <Page
      title="Settings"
      heading="Settings"
      intro="Where Klartext's models run and where its alerts go. Every save writes a new config version to the audit log."
    >
      <NotBuiltYet step="F9" />
    </Page>
  )
}
