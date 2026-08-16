import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Life anchor category — a compass rather than the generic lucide Globe,
// echoing the nautical "Anchor" mark family (see anchor-mark.tsx) instead of
// reading as an unrelated world/geography icon.
export function LifeIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <circle cx="12" cy="12" r="8.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.1 : 0} />
      <path
        d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.35 : 0}
      />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </SignatureSvg>
  )
}
