import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "More" hub — Circle (two interlaced petals), per anchor-redesign-spec.md
// section 3.
export function HubCircleIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M8 4a4.5 4.5 0 014 3 4.5 4.5 0 014-3c2.5 0 4.5 2 4.5 4.5 0 4-4.5 7.5-8.5 10.5C7.5 16 3 12.5 3 8.5 3 6 5 4 8 4z" />
    </SignatureSvg>
  )
}
