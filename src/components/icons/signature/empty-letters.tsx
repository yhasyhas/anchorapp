import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Empty state — Letters (an intact, unbroken seal), per
// anchor-redesign-spec.md section 3.
export function EmptyLettersIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="5" y="6" width="14" height="12" rx="1" />
      <circle cx="12" cy="10" r="2.3" />
      <path d="M12 12.3l-4 4M12 12.3l4 4" />
    </SignatureSvg>
  )
}
