import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Wrapped — a small stack of recap cards with a star, echoing the actual
// swipeable-card format of the feature, instead of the generic lucide
// PartyPopper (confetti already has its own dedicated moment via
// ConfettiBurst, no need to repeat that motif here).
export function WrappedIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="4.5" y="6.5" width="10" height="13" rx="2" transform="rotate(-8 9.5 13)" opacity="0.45" />
      <rect
        x="9.5"
        y="4.5"
        width="10"
        height="13"
        rx="2"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.14 : 0}
      />
      <path
        d="M14.5 8.3l.8 1.7 1.9.3-1.4 1.3.3 1.9-1.6-.9-1.6.9.3-1.9-1.4-1.3 1.9-.3.8-1.7Z"
        fill="currentColor"
        stroke="none"
        opacity={0.8}
      />
    </SignatureSvg>
  )
}
