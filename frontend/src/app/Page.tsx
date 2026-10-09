import type { ReactNode } from 'react'
import { PageTitle, TopBar } from './TopBar'

interface PageProps {
  /** Top bar title, or a custom breadcrumb node. */
  title: ReactNode
  heading?: string
  intro?: string
  children?: ReactNode
}

/** Top bar plus the content column (max 1440 px, padding 32, 32 between sections). */
export function Page({ title, heading, intro, children }: PageProps) {
  return (
    <>
      <TopBar>{typeof title === 'string' ? <PageTitle>{title}</PageTitle> : title}</TopBar>
      <main className="flex w-full max-w-content flex-col gap-8 p-8">
        {heading && (
          <section>
            <h2 className="text-display">{heading}</h2>
            {intro && <p className="mt-1 max-w-[72ch] text-muted">{intro}</p>}
          </section>
        )}
        {children}
      </main>
    </>
  )
}

/** Stand-in body for pages built in later steps. */
export function NotBuiltYet({ step }: { step: string }) {
  return (
    <div className="rounded-panel border border-dashed border-line px-6 py-12 text-center text-muted">
      This page is built in step {step}.
    </div>
  )
}
