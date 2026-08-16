import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Mindbody anchor category — a heart with a pulse line through it (wellness/
// self-care reading), kept distinct from the plain lucide Heart used
// elsewhere for Circle/love and from the generic "Brain" glyph used for the
// unrelated AI-insights concept in Settings/Patterns.
export function MindbodyIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path
        d="M12 19.5C6 15.6 3.5 12.4 3.5 9a4.3 4.3 0 0 1 8-2.1A4.3 4.3 0 0 1 20.5 9c0 3.4-2.5 6.6-8.5 10.5Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.16 : 0}
      />
      <path d="M6 12h2.4l1.3-2.6 1.6 4.6 1.2-2.6h3" opacity={0.75} />
    </SignatureSvg>
  )
}
