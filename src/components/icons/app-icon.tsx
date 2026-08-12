import type { ComponentType, CSSProperties, SVGProps } from "react"
import {
  AnchorMarkIcon,
  GratitudeJarIcon,
  LetterSealedIcon,
  LetterOpenIcon,
  CircleOfTrustIcon,
  IntentionIcon,
  MoodIcon,
  MoodGreatIcon,
  MoodOkayIcon,
  MoodMehIcon,
  MoodLowIcon,
  MoodStressedIcon,
  MoveIcon,
  PauseIcon,
  MindbodyIcon,
  LifeIcon,
  StreakIcon,
  WrappedIcon,
} from "./signature"

const signatureIcons = {
  "anchor-mark": AnchorMarkIcon,
  "gratitude-jar": GratitudeJarIcon,
  "letter-sealed": LetterSealedIcon,
  "letter-open": LetterOpenIcon,
  "circle-of-trust": CircleOfTrustIcon,
  intention: IntentionIcon,
  mood: MoodIcon,
  "mood-great": MoodGreatIcon,
  "mood-okay": MoodOkayIcon,
  "mood-meh": MoodMehIcon,
  "mood-low": MoodLowIcon,
  "mood-stressed": MoodStressedIcon,
  move: MoveIcon,
  pause: PauseIcon,
  mindbody: MindbodyIcon,
  life: LifeIcon,
  streak: StreakIcon,
  wrapped: WrappedIcon,
} as const

export type SignatureIconName = keyof typeof signatureIcons

type LucideIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>

/** The full set of things `<AppIcon icon={...} />` accepts — reuse this type wherever a
 *  component (e.g. a card def) needs to hold an icon reference to hand to AppIcon later. */
export type AppIconSource = LucideIconComponent | SignatureIconName

export interface AppIconProps {
  /** Either a lucide-react icon component (`icon={Home}`) or the name of one of Anchor's
   *  hand-drawn signature icons (`icon="gratitude-jar"`) — one prop for every icon in the app. */
  icon: LucideIconComponent | SignatureIconName
  /** 20px for dense/inline contexts, 24px (default) for standalone/nav use — keep to this
   *  pair so icon weight stays consistent app-wide. */
  size?: 20 | 24
  /** Filled/active state — signature icons get a soft currentColor fill, lucide icons get
   *  `fill="currentColor"` applied to their existing stroke paths. */
  active?: boolean
  className?: string
  /** Inline style passthrough — mainly for the per-category `color: borderColor` pattern
   *  already used across the anchor cards (currentColor-driven, same as className). */
  style?: CSSProperties
  /** Required unless `decorative` is set — this is the icon's only accessibility cue when it
   *  stands alone (e.g. a plain icon-only button), so never leave both unset. */
  "aria-label"?: string
  /** Marks the icon as purely decorative (adjacent visible text already conveys the meaning,
   *  e.g. a nav tab with a text label) — sets aria-hidden instead of requiring a label. */
  decorative?: boolean
  strokeWidth?: number
}

// Single source of truth for every icon in the app: a thin pass-through for
// lucide-react icons (call sites keep importing whichever glyph they need,
// just routed through here for consistent size/stroke/a11y) plus Anchor's
// hand-drawn signature set for concepts Lucide has no equivalent for
// (sealed vs. open letters, the gratitude jar, Circle of Trust...). See
// CARTOGRAPHIE.md Mission 3 for the full icon audit this consolidates.
export function AppIcon({
  icon,
  size = 24,
  active,
  className,
  style,
  decorative,
  strokeWidth = 1.75,
  "aria-label": ariaLabel,
}: AppIconProps) {
  if (typeof icon === "string") {
    const Signature = signatureIcons[icon]
    return (
      <Signature
        size={size}
        active={active}
        className={className}
        style={style}
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : ariaLabel}
      />
    )
  }

  const Lucide = icon
  return (
    <Lucide
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      fill={active ? "currentColor" : "none"}
      fillOpacity={active ? 0.18 : undefined}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : ariaLabel}
    />
  )
}
