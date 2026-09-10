import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Haptics, ImpactStyle } from "@capacitor/haptics"
import { Lightbulb } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { AppIcon, type AppIconSource } from "@/components/icons/app-icon"
import { canCheckAnchors, getTimeUntilAnchorCheck } from "@/lib/utils"
import type { AnchorDef } from "@/hooks/use-anchor-defs"
import type { AnchorCategory } from "@/types"

// The 3 daily-anchor card views, extracted from src/pages/home.tsx verbatim
// so the dedicated /anchor screen can render the exact same components
// rather than a fork. Home still owns all anchor state and persistence
// (useDailyCycle / useAnchorDefs / saveAnchor) — these are presentational.

/* ─── Planning Card ─── */
interface PlanningAnchorCardProps {
  borderColor: string
  icon: AppIconSource
  title: string
  subtitle: string
  task: string
  onTaskChange: (value: string) => void
  // Optional: Home wires this to its move-suggestion picker sheet; the
  // /anchor screen omits it (that flow stays on Home) and the button is
  // simply not rendered.
  onOpenSuggestions?: () => void
}

export function PlanningAnchorCard({
  borderColor,
  icon,
  title,
  subtitle,
  task,
  onTaskChange,
  onOpenSuggestions,
}: PlanningAnchorCardProps) {
  const { t } = useTranslation()
  return (
    <Card
      className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AppIcon icon={icon} size={20} decorative style={{ color: borderColor }} />
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {onOpenSuggestions && (
            <button
              onClick={onOpenSuggestions}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("move.suggestions_button")}
            >
              <Lightbulb className="h-3.5 w-3.5" /> {t("move.suggestions_button")}
            </button>
          )}
        </div>
        <Input
          value={task}
          onChange={(e) => onTaskChange(e.target.value)}
          placeholder={t("home.anchor_placeholder")}
          className="border-0 rounded-anchor-input bg-muted/50 px-3 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
      </CardContent>
    </Card>
  )
}

/* ─── Anchor chip row (planning, mobile only) ───
   Horizontal scrollable selector — replaces the old 3 stacked full-width
   PlanningAnchorCards on mobile. Desktop shows all 3 PlanningAnchorCards
   directly (see home.tsx's lg:grid block), so this component is never
   rendered at ≥1024px. Tapping a chip only changes which one is expanded in
   the editor card rendered below it in home.tsx. */
interface AnchorChipRowProps {
  defs: AnchorDef[]
  expanded: AnchorCategory
  onExpand: (key: AnchorCategory) => void
}

export function AnchorChipRow({ defs, expanded, onExpand }: AnchorChipRowProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {defs.map((d) => {
        const active = d.key === expanded
        return (
          <button
            key={d.key}
            onClick={() => onExpand(d.key)}
            aria-pressed={active}
            className={`flex w-[112px] shrink-0 flex-col items-start gap-1.5 rounded-anchor-control-sm p-3 text-left shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-colors ${
              active ? "bg-accent" : "bg-card"
            }`}
            style={{ borderLeft: `3px solid ${d.borderColor}` }}
          >
            <AppIcon icon={d.icon} size={20} decorative style={{ color: d.borderColor }} />
            <span className="text-xs font-semibold text-foreground">{d.title}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ─── Tracking chip (replaces the old full-width TrackingAnchorCard) ───
   Mobile: fixed 112px width in a horizontal scroll strip. Desktop: `wide`
   makes it fill its 3-column grid cell instead. canCheckAnchors/
   getTimeUntilAnchorCheck/handleCheck timegate logic is unchanged from
   the card it replaces. */
interface TrackingAnchorChipProps {
  def: AnchorDef
  lockedAt: string | null
  wide?: boolean
}

export function TrackingAnchorChip({ def, lockedAt, wide }: TrackingAnchorChipProps) {
  const { t } = useTranslation()
  const { borderColor, icon, title, task, completed, onCheckChange } = def
  const canCheck = canCheckAnchors(lockedAt)
  const timeLeft = getTimeUntilAnchorCheck(lockedAt)
  const [showNudge, setShowNudge] = useState(false)

  const handleCheck = () => {
    if (!canCheck) {
      setShowNudge(true)
      setTimeout(() => setShowNudge(false), 3000)
      return
    }
    onCheckChange(!completed)
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  }

  return (
    <button
      onClick={handleCheck}
      aria-pressed={completed}
      aria-label={`${title}${task ? `: ${task}` : ""}`}
      className={`relative flex shrink-0 flex-col items-start gap-1.5 rounded-anchor-control-sm p-3 text-left shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-opacity ${
        wide ? "w-full" : "w-[112px]"
      }`}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        backgroundColor: completed ? "var(--sage-light)" : "var(--card)",
        opacity: !canCheck && !completed ? 0.7 : 1,
      }}
    >
      <div className="flex w-full items-center justify-between">
        <AppIcon icon={icon} size={20} decorative style={{ color: borderColor }} />
        <Checkbox checked={completed} className="pointer-events-none h-4 w-4" />
      </div>
      <span className="text-xs font-semibold text-foreground">{title}</span>
      <span className={`line-clamp-2 text-[10px] ${completed ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>
        {task || t("home.no_task_set")}
      </span>
      {!canCheck && !completed && !showNudge && (
        <span
          className="absolute right-1.5 top-1.5 rounded-full bg-secondary/90 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shadow-sm"
          aria-hidden="true"
        >
          ⏳ {timeLeft}
        </span>
      )}

      {showNudge && (
        <div className="absolute inset-x-1 bottom-1 z-20 rounded-md bg-peach/90 px-1.5 py-1 text-center text-[9px] font-medium text-background shadow-md animate-in fade-in">
          {t("timegate.anchor_wait")}
        </div>
      )}
    </button>
  )
}
