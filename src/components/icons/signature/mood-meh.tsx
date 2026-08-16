import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodMehIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M7 15h10" />
      <circle cx="9" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
