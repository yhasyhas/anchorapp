import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Empty state — Wrapped (a page still being written), per
// anchor-redesign-spec.md section 3.
export function EmptyWrappedIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="6" y="4" width="12" height="16" rx="1" />
      <path d="M9 8h6M9 11h6M9 14h3" />
    </SignatureSvg>
  )
}
