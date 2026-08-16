import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Bottom nav — Patterns (ascending bars), per anchor-redesign-spec.md
// section 3.
export function NavPatternsIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M4 20V11M12 20V4M20 20v-8" />
    </SignatureSvg>
  )
}
