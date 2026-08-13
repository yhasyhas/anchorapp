import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "More" hub — Wrapped (a tied gift), per anchor-redesign-spec.md section 3.
export function HubWrappedIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="5" y="9" width="14" height="11" rx="1" />
      <path d="M5 13h14M12 9v11" />
      <path d="M9 9c0-2 1-3.5 3-3.5S15 7 15 9" />
    </SignatureSvg>
  )
}
