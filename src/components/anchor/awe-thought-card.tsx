import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Sparkles } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { getTodaysAweThought, markTodaysAweThoughtOpened } from "@/lib/awe-thought"
import { Card, CardContent } from "@/components/ui/card"
import type { TodaysAweThought } from "@/types"

// Today's Awe — one small factual thought, shown once a day, nothing to
// click or page through. No "next" button, no category browser: reload
// tomorrow for a new one. Renders nothing while loading or if the catalog
// is somehow empty — never a placeholder, never a badge demanding attention.
export function AweThoughtCard() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const lang: "en" | "sw" = i18n.language === "sw" ? "sw" : "en"
  const [thought, setThought] = useState<TodaysAweThought | null>(null)
  const [loading, setLoading] = useState(true)
  // Guards markTodaysAweThoughtOpened to fire at most once per mount, even
  // though the call itself is idempotent server-side.
  const openedRef = useRef(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    getTodaysAweThought(user.id, lang)
      .then((result) => {
        if (!cancelled) setThought(result)
      })
      .catch((err) => {
        console.error("Failed to load today's awe thought:", err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Refetches on a language switch too — same underlying pick, just
    // re-reads the other content column.
  }, [user, lang])

  useEffect(() => {
    if (!user || !thought || openedRef.current) return
    openedRef.current = true
    // Fire-and-forget: a failed "mark as seen" never blocks or retries
    // showing the thought itself, same spirit as this app's other
    // lightweight seen-tracking (see SuggestionFollowUpCard's onSeen).
    markTodaysAweThoughtOpened(user.id).catch((err) => {
      console.error("Failed to mark today's awe thought as opened:", err)
    })
  }, [user, thought])

  if (loading || !thought) return null

  return (
    <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("awe.title")} · {t(`awe.categories.${thought.category}`)}
          </p>
        </div>
        <p className="font-heading text-base italic leading-relaxed text-foreground/90">{thought.content}</p>
        {thought.sourceNote && <p className="text-[10px] text-muted-foreground">{thought.sourceNote}</p>}
      </CardContent>
    </Card>
  )
}
