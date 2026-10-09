import type { ReactNode } from 'react'

/** Small outlined pill, e.g. the Clean/Noisy chip next to a recording. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full border border-line bg-paper px-2 text-[12px] leading-4 text-muted">
      {children}
    </span>
  )
}
