import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

export function MoodStressedIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.16 : 0} />
      <path d="M7.6 9.2l2.1 1.1" />
      <path d="M16.4 9.2l-2.1 1.1" />
      <circle cx="9" cy="11.6" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.6" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.2" r="1.3" />
    </SignatureSvg>
  )
}
