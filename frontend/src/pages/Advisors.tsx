import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { Page } from '@/app/Page'
import { buttonVariants } from '@/components/ui/button'

/** Stretch goal (R12). Until it exists, the page says so and points to what works today. */
export default function Advisors() {
  return (
    <Page
      title="Advisors"
      heading="Patterns per advisor"
      intro="One call can be a mistake. Repeated reviews for the same advisor are worth a conversation."
    >
      <section className="flex flex-col items-start gap-3 rounded-panel border border-line p-6">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-panel bg-canvas">
          <Users size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <p className="m-0 max-w-[72ch]">
          This view is a stretch goal and is not built yet. Every call already carries its advisor, so you can filter
          All calls by advisor in the meantime.
        </p>
        <Link to="/calls" className={buttonVariants()}>
          Open all calls
        </Link>
      </section>
    </Page>
  )
}
