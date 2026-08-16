import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodStressedIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M7 17c1.2-2 3-3 5-3s3.8 1 5 3" />
      <path d="M7.5 9.5l2.5 1.5M16.5 9.5L14 11" />
    </SignatureSvg>
  )
}
