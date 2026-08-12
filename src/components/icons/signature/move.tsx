import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Two rounded footsteps — the bottom nav's Move tab already uses lucide
// Footprints; this signature variant is for contexts wanting the warmer
// hand-drawn set instead (move category cards, etc).
export function MoveIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <ellipse
        cx="9"
        cy="15.5"
        rx="2"
        ry="3"
        transform="rotate(-18 9 15.5)"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.3 : 0}
      />
      <ellipse
        cx="15.5"
        cy="8.5"
        rx="2"
        ry="3"
        transform="rotate(-18 15.5 8.5)"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.3 : 0}
      />
    </SignatureSvg>
  )
}
