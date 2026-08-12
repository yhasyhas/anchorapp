import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Streak flame — replaces the generic lucide Flame on the streak cards, same
// hand-drawn line weight as the rest of the signature set.
export function StreakIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path
        d="M12 3.2c2.6 3 5 5.9 5 9.8a5 5 0 0 1-10 0c0-1.6.5-2.8 1.4-3.9.2 1.5 1 2.3 2 2.1-.9-2.7-.2-5.3 1.6-8Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.2 : 0}
      />
    </SignatureSvg>
  )
}
