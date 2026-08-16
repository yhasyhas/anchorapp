import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Signature Gratitude Jar — 24x24 counterpart to the existing 64x64
// src/components/anchor/jar-icon.tsx (kept as-is for this lot to avoid
// visual diff on the live Gratitude feature; see CARTOGRAPHIE.md Mission 3
// for the migration recommendation).
export function GratitudeJarIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="8.5" y="4.5" width="7" height="3" rx="1.2" />
      <path
        d="M7 8.5h10c1 0 1.75.9 1.6 1.9l-1.1 9.4a2.5 2.5 0 0 1-2.48 2.2H8.98a2.5 2.5 0 0 1-2.48-2.2l-1.1-9.4C5.25 9.4 6 8.5 7 8.5Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
      <path d="M8 13c1.2.7 2.3.7 3.5 0s2.3-.7 3.5 0" opacity={0.6} />
      {active && <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />}
    </SignatureSvg>
  )
}
