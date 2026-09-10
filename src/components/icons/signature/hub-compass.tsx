import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "More" hub — Compass (foundations pillar). A compass ROSE: outer ring +
// a symmetric four-point star with a filled center point. Deliberately not
// the "Future" anchor icon (anchor-future.tsx), which is the same ring with
// a single off-centre needle and four cardinal dots on the rim — this one
// reads as orientation/identity rather than a direction being pointed at.
export function HubCompassIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 5 L13.4 10.6 L19 12 L13.4 13.4 L12 19 L10.6 13.4 L5 12 L10.6 10.6 Z" strokeWidth={1.6} />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
