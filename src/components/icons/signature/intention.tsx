import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// "Intention" signature: a rounded 4-point spark, proposed over a leaf motif
// per Mission 3b's "étincelle/feuille — proposer" — a leaf is already the
// Future anchor's 🌱 emoji, so a spark keeps the two concepts visually
// distinct. Swap for a leaf shape here if Ruth prefers that reading instead.
export function IntentionIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path
        d="M12 3.5c.7 3.3 2.4 5 5.7 5.7-3.3.7-5 2.4-5.7 5.7-.7-3.3-2.4-5-5.7-5.7C9.6 8.5 11.3 6.8 12 3.5Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.3 : 0}
      />
      <circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none" opacity={0.6} />
    </SignatureSvg>
  )
}
