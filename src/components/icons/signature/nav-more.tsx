import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Bottom nav — More (3 horizontal dots), per anchor-redesign-spec.md
// section 3.
export function NavMoreIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
