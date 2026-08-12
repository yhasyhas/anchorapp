import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodOkayIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.16 : 0} />
      <circle cx="9" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8.3 14.3c1.4 1.6 5.9 1.6 7.3 0" />
    </SignatureSvg>
  )
}
