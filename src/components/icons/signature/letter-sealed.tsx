import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// A closed flap + wax-seal dot — distinguishes a still-sealed future letter
// from one ready to open (LetterOpenIcon), which today both render as the
// same 💌 emoji (see CARTOGRAPHIE.md Mission 1c).
export function LetterSealedIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.12 : 0} />
      <path d="M3.5 6.5 12 13 20.5 6.5" />
      <circle cx="12" cy="10.5" r="1.4" fill="currentColor" stroke="none" opacity={0.9} />
    </SignatureSvg>
  )
}
