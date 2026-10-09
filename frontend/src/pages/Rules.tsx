import { NotBuiltYet, Page } from '@/app/Page'

export default function Rules() {
  return (
    <Page
      title="Rules"
      heading="What Klartext listens for"
      intro="Each family is one check. Write the rule the way you would explain it to a new colleague. Every save creates a new config version."
    >
      <NotBuiltYet step="F6" />
    </Page>
  )
}
