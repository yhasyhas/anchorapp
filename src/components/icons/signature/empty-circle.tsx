import { SignatureSvg, type SignatureIconProps } from "./signature-svg"

// Empty state — Circle (two stems growing toward each other), per
// anchor-redesign-spec.md section 3.
export function EmptyCircleIcon({ active, ...props }: SignatureIconProps) {
  return (
    <SignatureSvg {...props}>
      <path d="M8 8c-1 1.5-1 3.5 0 5M16 8c1 1.5 1 3.5 0 5" opacity={0.5} />
      <path d="M12 5c-2 3-2 6 0 9M12 5c2 3 2 6 0 9M12 19v-5" />
    </SignatureSvg>
  )
}
