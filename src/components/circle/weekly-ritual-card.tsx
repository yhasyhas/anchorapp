import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { MessagesSquare, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { CircleError } from "@/lib/circle"
import {
  getWeeklyRitual,
  submitWeeklyRitualResponse,
  getWeeklyRitualHistory,
  MAX_WEEKLY_RITUAL_RESPONSE_LENGTH,
} from "@/lib/circle-weekly-ritual"
import type { CircleWeeklyRitual, CircleWeeklyRitualHistoryEntry } from "@/types"

interface WeeklyRitualCardProps {
  friendId: string
  friendName: string
}

// One card per active friendship (see the migration for why this is
// pairwise, not one card per whole circle). Self-contained — fetches and
// owns its own ritual state, same pattern as JournalCard/GratitudeDropCard
// on Home, so circle.tsx's own load() doesn't need to know about this at
// all. The "waiting" state never queries or renders anything about the
// friend's answer beyond the fact she hasn't answered — see
// circle-weekly-ritual.ts / the migration for where that's actually
// enforced (server-side, not just withheld by this component).
export function WeeklyRitualCard({ friendId, friendName }: WeeklyRitualCardProps) {
  const { t } = useTranslation()
  const [ritual, setRitual] = useState<CircleWeeklyRitual | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState("")
  const [sharing, setSharing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<CircleWeeklyRitualHistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    getWeeklyRitual(friendId)
      .then((r) => {
        if (!cancelled) setRitual(r)
      })
      .catch((err) => console.error("Failed to load weekly ritual:", err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [friendId])

  async function handleShare() {
    if (!draft.trim() || sharing) return
    setSharing(true)
    try {
      const updated = await submitWeeklyRitualResponse(friendId, draft.trim())
      setRitual(updated)
      setDraft("")
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(
        code === "already_answered"
          ? t("circle.weekly_ritual_error_already")
          : t("circle.weekly_ritual_error_generic")
      )
    } finally {
      setSharing(false)
    }
  }

  async function toggleHistory() {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && history === null) {
      setHistoryLoading(true)
      try {
        setHistory(await getWeeklyRitualHistory(friendId))
      } catch (err) {
        console.error("Failed to load weekly ritual history:", err)
        setHistory([])
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  if (loading || !ritual) return null

  const promptText = t(`circle.weekly_ritual_prompts.${ritual.promptKey}`)

  return (
    <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("circle.weekly_ritual_section_title", { name: friendName })}
          </p>
        </div>

        <p className="font-heading text-base font-semibold leading-snug text-foreground">{promptText}</p>

        {ritual.myResponse === null ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_WEEKLY_RITUAL_RESPONSE_LENGTH))}
              placeholder={t("circle.weekly_ritual_placeholder")}
              maxLength={MAX_WEEKLY_RITUAL_RESPONSE_LENGTH}
              rows={3}
              className="rounded-anchor-input"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {t("circle.weekly_ritual_char_count", { count: draft.length, max: MAX_WEEKLY_RITUAL_RESPONSE_LENGTH })}
              </span>
              <Button size="sm" onClick={handleShare} disabled={!draft.trim() || sharing}>
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : t("circle.weekly_ritual_share")}
              </Button>
            </div>
          </div>
        ) : !ritual.revealed ? (
          <div className="space-y-2">
            <p className="rounded-anchor-input bg-muted/50 p-3 text-sm italic text-foreground/80">
              {t("circle.weekly_ritual_your_answer")} &#8220;{ritual.myResponse}&#8221;
            </p>
            <p className="text-sm text-muted-foreground">{t("circle.weekly_ritual_waiting", { name: friendName })}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ritual.responses!.map((r) => (
              <div key={r.userId} className="rounded-anchor-input bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {r.userId === friendId ? friendName : t("circle.weekly_ritual_you_label")}
                </p>
                <p className="mt-0.5 text-sm text-foreground">{r.response}</p>
              </div>
            ))}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={historyOpen}
            className="flex min-h-11 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {historyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t("circle.weekly_ritual_history_toggle")}
          </button>

          {historyOpen && (
            <div className="mt-2 space-y-2">
              {historyLoading ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : history && history.length > 0 ? (
                history.map((h) => (
                  <div key={h.weekKey} className="rounded-anchor-input bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(`circle.weekly_ritual_prompts.${h.promptKey}`)}
                    </p>
                    <p className="mt-1 text-xs text-foreground/80">
                      {t("circle.weekly_ritual_you_label")}: {h.myResponse}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground/80">
                      {friendName}: {h.friendResponse}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">{t("circle.weekly_ritual_history_empty")}</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
