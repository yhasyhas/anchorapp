import type { CSSProperties, ReactNode } from "react"

export interface SignatureIconProps {
  className?: string
  style?: CSSProperties
  size?: number
  /** Filled/active variant — each icon decides what gets a soft currentColor fill. */
  active?: boolean
  "aria-label"?: string
  "aria-hidden"?: boolean
}

interface SignatureSvgProps {
  size?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
  "aria-label"?: string
  "aria-hidden"?: boolean
}

// Shared shell for every Anchor signature icon: 24x24 viewBox, rounded
// stroke caps/joins, currentColor-driven so each icon adapts to whatever
// text color (and therefore theme) it's placed in — no per-icon svg
// boilerplate, no hardcoded colors. See CARTOGRAPHIE.md Mission 3.
export function SignatureSvg({ size = 24, className, style, children, ...aria }: SignatureSvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      {...aria}
    >
      {children}
    </svg>
  )
}
