import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { FollowUpResponse } from "@/lib/daily-suggestion-context"

interface SuggestionFollowUpCardProps {
  // The accepted suggestion's text — dropped into the question.
  text: string
  // Fired on mount: marks follow_up_shown = true so the card never returns,
  // whether or not she answers.
  onSeen: () => void
  onRespond: (response: FollowUpResponse) => void
  onDismiss: () => void
}

const RESPONSES: { key: FollowUpResponse; labelKey: string }[] = [
  { key: "better", labelKey: "daily_suggestion.follow_up_better" },
  { key: "neutral", labelKey: "daily_suggestion.follow_up_neutral" },
  { key: "prefer_not", labelKey: "daily_suggestion.follow_up_prefer_not" },
]

// The J+2 "how did that feel?" check-in on a past accepted suggestion.
// Light by design — dismissible without answering, no follow-up on the
// follow-up. Shown at most one at a time (the provider already picks the
// most recent eligible one).
export function SuggestionFollowUpCard({ text, onSeen, onRespond, onDismiss }: SuggestionFollowUpCardProps) {
  const { t } = useTranslation()

  useEffect(() => {
    onSeen()
    // Only ever once, on first mount — onSeen itself is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card className="border-0 rounded-anchor-card-lg bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="font-heading text-sm italic leading-snug text-foreground/90">
            {t("daily_suggestion.follow_up_question", { suggestion: text })}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("daily_suggestion.follow_up_dismiss")}
            className="-mr-1 -mt-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {RESPONSES.map(({ key, labelKey }) => (
            <Button
              key={key}
              variant="outline"
              className="min-h-11 bg-card"
              onClick={() => onRespond(key)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
