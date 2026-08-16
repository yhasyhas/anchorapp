import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Bottom nav — Check-in (moon + small spark), per anchor-redesign-spec.md
// section 3.
export function NavCheckinIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M20 14.5A8.5 8.5 0 1111 3a6.5 6.5 0 009 11.5z" />
    </SignatureSvg>
  )
}
