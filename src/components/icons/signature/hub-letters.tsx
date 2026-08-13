import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "More" hub — Letters (envelope with a wax seal), per
// anchor-redesign-spec.md section 3.
export function HubLettersIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
      <path d="M4 7l8 6 8-6" />
      <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
