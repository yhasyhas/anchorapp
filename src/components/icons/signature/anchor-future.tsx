import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Future anchor category — a compass, per anchor-redesign-spec.md section 3.
export function AnchorFutureIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12L15 8" strokeWidth={2} />
      <circle cx="12" cy="4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="20" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="20" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
