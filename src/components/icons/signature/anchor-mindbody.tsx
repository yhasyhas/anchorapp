import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Mind/Body anchor category — an organic, asymmetric heart with a stem, per
// anchor-redesign-spec.md section 3.
export function AnchorMindbodyIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M12 19c-4-2.5-8-6-8-10a4 4 0 017-2.6A4 4 0 0118 9c0 4-4 7.5-6 10z" />
      <path d="M12 4V2M12 4l1.8-1.5" />
    </SignatureSvg>
  )
}
