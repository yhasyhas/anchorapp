import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Two members linked inside a ring — no dedicated icon exists for this
// today (see CARTOGRAPHIE.md Mission 1c), the Circle page mixes several
// unrelated lucide glyphs (Heart, HeartHandshake, Gift...) instead.
export function CircleOfTrustIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.08 : 0} />
      <circle cx="9.3" cy="10.5" r="1.9" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.5 : 0} />
      <circle cx="14.7" cy="10.5" r="1.9" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.5 : 0} />
      <path d="M8.5 14.5c1.4 1.5 4.6 1.5 6 0" opacity={0.8} />
    </SignatureSvg>
  )
}
