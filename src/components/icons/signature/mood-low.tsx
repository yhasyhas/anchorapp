import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodLowIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.16 : 0} />
      <path d="M8.1 10.2h1.8" />
      <path d="M14.1 10.2h1.8" />
      <path d="M8.3 15.3c1.4-1.6 5.9-1.6 7.3 0" />
    </SignatureSvg>
  )
}
