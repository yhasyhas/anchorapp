import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Life anchor category — two crossing orbits, per anchor-redesign-spec.md
// section 3.
export function AnchorLifeIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="9.5" cy="12" r="6.5" />
      <circle cx="15.5" cy="12" r="6.5" />
    </SignatureSvg>
  )
}
