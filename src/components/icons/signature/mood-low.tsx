import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodLowIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M7 16.5c1.2-1.8 3-2.6 5-2.6s3.8.8 5 2.6" />
      <circle cx="9" cy="9" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="0.9" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
