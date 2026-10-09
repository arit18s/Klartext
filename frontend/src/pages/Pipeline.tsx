import { NotBuiltYet, Page } from '@/app/Page'

export default function Pipeline() {
  return (
    <Page
      title="Pipeline"
      heading="Runs on its own"
      intro="Klartext watches the inbox folder. Every recording that lands there is transcribed, checked and decided with no one clicking anything."
    >
      <NotBuiltYet step="F8" />
    </Page>
  )
}
