import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Empty state — Letters (an intact, unbroken seal). The literal Annexe A
// trace (rect + circle + two lines down to the bottom corners) read as a
// generic broken-image/avatar glyph at small sizes — swapped for the same
// envelope-flap-fold + filled seal-dot composition already proven in
// hub-letters.tsx/letter-sealed.tsx elsewhere in this icon set, just
// without the sealed envelope's tinted fill (this one reads as "waiting",
// not "arrived").
export function EmptyLettersIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="5" y="6" width="14" height="12" rx="1" />
      <path d="M5 7l7 6 7-6" />
      <circle cx="12" cy="16" r="1.6" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
