import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodGreatIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M5 13c2 4 5 5.5 7 5.5s5-1.5 7-5.5" strokeWidth={2.2} />
      <circle cx="9" cy="9" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="0.9" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
