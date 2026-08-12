import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodMehIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.16 : 0} />
      <circle cx="9" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8.5 14.5h7" />
    </SignatureSvg>
  )
}
