import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Bottom nav — Home, per anchor-redesign-spec.md section 3.
export function NavHomeIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </SignatureSvg>
  )
}
