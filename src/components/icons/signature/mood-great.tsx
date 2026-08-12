import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodGreatIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.16 : 0} />
      <path d="M7.8 10.3c.5-.6 1.5-.6 2 0" />
      <path d="M14.2 10.3c.5-.6 1.5-.6 2 0" />
      <path d="M7.5 13.5c2.2 3 6.8 3 9 0" />
    </SignatureSvg>
  )
}
