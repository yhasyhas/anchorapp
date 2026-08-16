import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodOkayIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M6 14c1.5 2.5 3.5 3.5 6 3.5s4.5-1 6-3.5" />
      <circle cx="9" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
