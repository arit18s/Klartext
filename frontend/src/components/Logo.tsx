/** Klartext mark (04_FRONTEND_GUIDELINES.md section 2): the yellow middle bar is the passage that matters. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="flex-none">
      <rect width="28" height="28" rx="8" fill="#1E2126" />
      <rect x="6" y="11" width="2" height="6" rx="1" fill="#FFFFFF" />
      <rect x="9.5" y="8" width="2" height="12" rx="1" fill="#FFFFFF" />
      <rect x="13" y="5" width="2" height="18" rx="1" fill="#F2C744" />
      <rect x="16.5" y="8" width="2" height="12" rx="1" fill="#FFFFFF" />
      <rect x="20" y="11" width="2" height="6" rx="1" fill="#FFFFFF" />
    </svg>
  )
}
