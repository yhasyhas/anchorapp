import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Soft cloud — replaces the ☁️ emoji used as the floating Pause button's
// only visual (see src/pages/app-layout.tsx and CARTOGRAPHIE.md Mission 3).
export function PauseIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path
        d="M7.2 16.5a3.7 3.7 0 0 1 .4-7.38A4.6 4.6 0 0 1 16.6 9a3.4 3.4 0 0 1-.4 7.5H7.2Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
    </SignatureSvg>
  )
}
