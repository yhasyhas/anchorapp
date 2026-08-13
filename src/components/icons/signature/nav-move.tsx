import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Bottom nav — Move (winding path + point), per anchor-redesign-spec.md
// section 3.
export function NavMoveIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M3 17c3-3 4-8 7-8s3 4 6 4 5-4 5-4" strokeLinecap="round" />
      <circle cx="19" cy="9" r="1" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
