// Plain inline SVG — a simple rounded jar with a lid, no external asset, so
// it stays crisp and theme-aware (currentColor + a couple of CSS vars) in
// both light and dark mode. Reused by the drop card, the opening modal, and
// the jar page for one consistent "bocal" motif across the feature.
export function JarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect x="20" y="6" width="24" height="8" rx="2" fill="currentColor" opacity="0.35" />
      <path
        d="M18 16h28c2 0 3.6 1.7 3.4 3.7l-3.2 34c-.3 3.5-3.3 6.3-6.8 6.3H24.6c-3.5 0-6.5-2.8-6.8-6.3l-3.2-34C14.4 17.7 16 16 18 16Z"
        fill="var(--sage-light)"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.9"
      />
      <path d="M17 26h30" stroke="currentColor" strokeWidth="1" opacity="0.25" />
    </svg>
  )
}
