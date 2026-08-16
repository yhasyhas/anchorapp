import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// The "ready to open" counterpart to LetterSealedIcon — flap lifted, no
// seal, a peek of the letter inside.
export function LetterOpenIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="3" y="9.5" width="18" height="9.5" rx="2.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0} />
      <path d="M4 10 12 4.5 20 10" />
      <path d="M9 13.5h6" opacity={0.6} />
    </SignatureSvg>
  )
}
