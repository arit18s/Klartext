import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the custom font sizes from tailwind.config.ts, otherwise it treats `text-small`
// as a colour and drops `text-paper` (or the reverse) when both appear.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['display', 'title', 'subtitle', 'body', 'quote', 'small'] }] } },
})

/** Class name helper used by shadcn/ui components. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
