import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sparkles } from "lucide-react"
import { AppIcon } from "@/components/icons/app-icon"
import { moveCategoryIcons, DEFAULT_MOVE_CATEGORY_ICON } from "@/lib/move-category-icons"

interface MoveOfTheDayCardProps {
  title: string
  category: string
  isAiGenerated: boolean
  correlationHint: string | null
  // undefined = both life_task and mindbody_task are already set — nothing
  // meaningful left to prefill, so no action button is shown at all rather
  // than silently overwriting one of them.
  ctaTarget: "life" | "mindbody" | undefined
  onAdd: (target: "life" | "mindbody") => void
}

// Purely presentational — src/pages/home.tsx owns the data (already loads
// moods/anchors/streaks anyway) and the featured-pick logic lives once in
// src/lib/move-selection.ts, shared with src/pages/move.tsx.
export function MoveOfTheDayCard({ title, category, isAiGenerated, correlationHint, ctaTarget, onAdd }: MoveOfTheDayCardProps) {
  const { t } = useTranslation()

  return (
    <Card className="border-0 rounded-anchor-card-lg bg-gradient-to-br from-anchor-lavender/30 to-anchor-orange/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{t("move.home_card_title")}</p>
          {isAiGenerated && (
            <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
              <Sparkles className="mr-1 h-3 w-3" />
              {t("checkin.personalized_badge")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AppIcon icon={moveCategoryIcons[category] ?? DEFAULT_MOVE_CATEGORY_ICON} size={20} decorative className="text-primary" />
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        {correlationHint && <p className="mt-2 text-xs text-muted-foreground">{correlationHint}</p>}
        {ctaTarget && (
          <Button size="sm" className="mt-3 min-h-11 w-full rounded-anchor-card-lg" onClick={() => onAdd(ctaTarget)}>
            {ctaTarget === "life" ? t("move.home_card_cta") : t("move.home_card_cta_mindbody")}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
