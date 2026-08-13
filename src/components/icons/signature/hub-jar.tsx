import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "More" hub — Jar (2 fireflies inside), per anchor-redesign-spec.md
// section 3.
export function HubJarIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M6 8h12v11a1 1 0 01-1 1H7a1 1 0 01-1-1z" />
      <path d="M9 8V6a1 1 0 011-1h4a1 1 0 011 1v2" />
      <circle cx="10.5" cy="13" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="14" cy="15.5" r="0.7" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
