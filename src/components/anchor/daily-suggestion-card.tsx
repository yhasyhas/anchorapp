import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/icons/app-icon"
import { cn } from "@/lib/utils"
import type { DailySuggestionStatus } from "@/types"

interface DailySuggestionCardProps {
  text: string
  status: DailySuggestionStatus
  busy: boolean
  onAccept: () => void
  onDecline: () => void
  onAnother: () => void
}

// Purely presentational — src/hooks/use-daily-suggestion.ts owns the row,
// the pick, and the rotation. The three responses carry equal visual
// weight on purpose (spec): none of them is the "right" answer, and none
// feeds the streak or shows anything discouraging.
export function DailySuggestionCard({ text, status, busy, onAccept, onDecline, onAnother }: DailySuggestionCardProps) {
  const { t } = useTranslation()
  const accepted = status === "accepted"
  const declined = status === "declined"

  const selectedClasses =
    "bg-primary text-primary-foreground border-primary hover:bg-primary/90 hover:text-primary-foreground"

  return (
    <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-1.5">
          <AppIcon icon="move" size={20} decorative className="text-primary" />
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("daily_suggestion.label")}
          </p>
        </div>

        <p className="font-heading text-base font-semibold leading-snug text-foreground">{text}</p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            variant="outline"
            className={cn("min-h-11", accepted && selectedClasses)}
            aria-pressed={accepted}
            disabled={busy}
            onClick={onAccept}
          >
            {t("daily_suggestion.accept")}
          </Button>
          <Button
            variant="outline"
            className={cn("min-h-11", declined && selectedClasses)}
            aria-pressed={declined}
            disabled={busy}
            onClick={onDecline}
          >
            {t("daily_suggestion.decline")}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={onAnother}>
            {t("daily_suggestion.another")}
          </Button>
        </div>

        {accepted && <p className="text-xs text-muted-foreground">{t("daily_suggestion.accepted_ack")}</p>}
        {declined && <p className="text-xs text-muted-foreground">{t("daily_suggestion.declined_ack")}</p>}
      </CardContent>
    </Card>
  )
}
