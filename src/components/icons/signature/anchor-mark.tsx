import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// The Anchor brand mark — a warmer, rounder take on the maritime anchor
// than the generic lucide glyph currently reused ad hoc as a logo across
// auth pages and the landing hero (see CARTOGRAPHIE.md Mission 1c).
export function AnchorMarkIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="5.5" r="2.1" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.25 : 0} />
      <line x1="12" y1="7.6" x2="12" y2="19" />
      <line x1="8.5" y1="10.5" x2="15.5" y2="10.5" />
      <path d="M5.5 13c0 4 2.9 6.5 6.5 6.5s6.5-2.5 6.5-6.5" />
    </SignatureSvg>
  )
}
