import { NotBuiltYet, Page } from '@/app/Page'

export default function Tuning() {
  return (
    <Page
      title="Tuning"
      heading="How strict Klartext is"
      intro="Drag the handles. Every number on this page updates as you move them. Nothing changes for real until you apply."
    >
      <NotBuiltYet step="F5" />
    </Page>
  )
}
