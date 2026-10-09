import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-canvas px-[5px] font-sans text-[11.5px] text-muted">
      {children}
    </kbd>
  )
}
