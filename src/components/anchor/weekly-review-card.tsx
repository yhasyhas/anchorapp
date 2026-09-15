import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import {
  dismissWeeklyReview,
  getOrCreateWeeklyReview,
  markWeeklyReviewShown,
  respondWeeklyReviewGoal,
} from "@/lib/weekly-review"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { WeeklyReview, WeeklyReviewGoalResponse } from "@/types"

const GOAL_RESPONSES: { key: WeeklyReviewGoalResponse; labelKey: string }[] = [
  { key: "still_true", labelKey: "weekly_review.goal_still_true" },
  { key: "changed", labelKey: "weekly_review.goal_changed" },
  { key: "prefer_not", labelKey: "weekly_review.goal_prefer_not" },
]

// A once-a-week, rule-based bilan: factual only, never a score or a
// verdict. Shown at most once per Monday-Sunday week (see
// isWeeklyReviewEligibleDay in weekly-review.ts), dismissible without
// answering anything, and entirely silent on a quiet week or off its
// eligible day — self-contained fetch like AweThoughtCard/ReflectionCard.
export function WeeklyReviewCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [goalAnswered, setGoalAnswered] = useState<WeeklyReviewGoalResponse | null>(null)
  const shownRef = useRef(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    getOrCreateWeeklyReview(user.id)
      .then((result) => {
        if (!cancelled) setReview(result)
      })
      .catch((err) => {
        console.error("Failed to load weekly review:", err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!review || review.status !== "pending" || shownRef.current) return
    shownRef.current = true
    markWeeklyReviewShown(review).catch((err) => {
      console.error("Failed to mark weekly review shown:", err)
    })
  }, [review])

  function handleDismiss() {
    if (!review) return
    setReview(null)
    dismissWeeklyReview(review).catch((err) => {
      console.error("Failed to dismiss weekly review:", err)
    })
  }

  function handleGoalRespond(response: WeeklyReviewGoalResponse) {
    if (!review) return
    setGoalAnswered(response)
    respondWeeklyReviewGoal(review, response).catch((err) => {
      console.error("Failed to save weekly review goal response:", err)
    })
  }

  if (loading || !review || review.status === "dismissed") return null

  const { acceptedCount, declinedCount, dominantValues, goalPromptedText } = review.summary_snapshot
  const hasSuggestionSummary = acceptedCount + declinedCount > 0
  const showGoalQuestion = !!goalPromptedText && !review.goal_response && !goalAnswered

  return (
    <Card className="border-0 rounded-anchor-card-lg bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="font-heading text-base italic leading-snug text-foreground/90">
            {t("weekly_review.title")}
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("weekly_review.dismiss")}
            className="-mr-1 -mt-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {dominantValues && dominantValues.length > 0 && (
          <p className="text-sm text-foreground/90">
            {t("weekly_review.values", { values: dominantValues.map((v) => t(`compass.values.${v.toLowerCase()}`)).join(", ") })}
          </p>
        )}

        {hasSuggestionSummary && (
          <p className="text-sm text-muted-foreground">
            {t("weekly_review.suggestions_summary", { accepted: acceptedCount, declined: declinedCount })}
          </p>
        )}

        {showGoalQuestion && (
          <div className="space-y-2 pt-1">
            <p className="text-sm text-foreground/90">
              {t("weekly_review.goal_question", { goal: goalPromptedText })}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {GOAL_RESPONSES.map(({ key, labelKey }) => (
                <Button
                  key={key}
                  variant="outline"
                  className="min-h-11 bg-card"
                  onClick={() => handleGoalRespond(key)}
                >
                  {t(labelKey)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!showGoalQuestion && goalPromptedText && (review.goal_response || goalAnswered) && (
          <p className="text-xs text-muted-foreground">{t("weekly_review.goal_thanks")}</p>
        )}
      </CardContent>
    </Card>
  )
}
