import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Empty state — Jar (a firefly waiting for its spark), per
// anchor-redesign-spec.md section 3. The glow keeps its own warm hex
// regardless of currentColor, same as the annexe A trace.
export function EmptyJarIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M6 8h12l-1 12H7z" />
      <path d="M9 8V5h6v3" />
      <circle cx="10.5" cy="13" r="0.6" fill="#E9A85C" stroke="none" />
    </SignatureSvg>
  )
}
