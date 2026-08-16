import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "More" hub — Settings (3 horizontal sliders with tick marks, not a gear),
// per anchor-redesign-spec.md section 3.
export function HubSettingsIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M4 7h6M4 12h12M4 17h9" />
      <circle cx="14" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
