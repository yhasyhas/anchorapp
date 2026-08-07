import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { markLettersSeen, formatWeekRange } from "@/lib/letters"
import { daysUntil, isDue, formatDeliverOn, MAX_PENDING_LETTERS } from "@/lib/future-letters"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Mail, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { WeeklyLetter, FutureLetter } from "@/types"

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? text
  return line.length > 110 ? `${line.slice(0, 110).trimEnd()}…` : line
}

export function LettersPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [letters, setLetters] = useState<WeeklyLetter[]>([])
  const [futureLetters, setFutureLetters] = useState<FutureLetter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      loadLetters()
      loadFutureLetters()
    }
  }, [user])

  async function loadLetters() {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("weekly_letters")
        .select("*")
        .eq("user_id", user.id)
        .order("week_start", { ascending: false })

      if (error) throw error
      const rows = (data as WeeklyLetter[]) || []
      setLetters(rows)
      markLettersSeen(user.id, rows[0]?.week_start)
    } catch (err: any) {
      console.error("Failed to load letters:", err)
      toast.error(t("letters.error_load"))
    } finally {
      setLoading(false)
    }
  }

  // Metadata only (see FutureLetter's own comment) — content is never part
  // of this query, it's only ever fetched via RPC once a letter is due and
  // actually opened (src/pages/letter-future-detail.tsx).
  async function loadFutureLetters() {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("future_letters")
        .select("id, user_id, written_at, deliver_on, delivered_at, opened_at")
        .eq("user_id", user.id)
        .order("deliver_on", { ascending: true })
      if (error) throw error
      setFutureLetters((data as FutureLetter[]) || [])
    } catch (err) {
      console.error("Failed to load future letters:", err)
    }
  }

  const pendingLetters = futureLetters.filter((l) => !isDue(l.deliver_on))
  const readyLetters = futureLetters.filter((l) => isDue(l.deliver_on) && !l.opened_at)
  const archivedFutureLetters = futureLetters.filter((l) => isDue(l.deliver_on) && l.opened_at)
  const atMaxPending = pendingLetters.length >= MAX_PENDING_LETTERS

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("letters.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("letters.subtitle")}</p>
      </div>

      {/* Write to your future self — MISSION 1 entry point */}
      <Card className="border-0 bg-gradient-to-br from-lavender/30 to-peach/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <p className="font-heading text-base font-semibold text-foreground">{t("letters.future.cta_title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("letters.future.cta_subtitle")}</p>
          {atMaxPending ? (
            <p className="mt-3 text-center text-xs text-muted-foreground">{t("letters.future.seal_error_max")}</p>
          ) : (
            <Link to="/letters/future/write">
              <Button className="mt-3 w-full gap-1.5">
                <Mail className="h-4 w-4" />
                {t("letters.future.cta")}
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Ready to open — MISSION 3 */}
      {readyLetters.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("letters.future.ready_title")}</p>
          {readyLetters.map((letter) => (
            <Link key={letter.id} to={`/letters/future/${letter.id}`}>
              <Card className="border-0 bg-sage-light/40 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">&#x1F48C;</span>
                    <p className="text-sm font-medium text-foreground">{t("letters.future.waiting_card")}</p>
                  </div>
                  <span className="text-xs font-semibold text-primary">{t("letters.future.ready_card_cta")}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Waiting — MISSION 2 */}
      {pendingLetters.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("letters.future.waiting_title")}</p>
          {pendingLetters.map((letter) => {
            const days = daysUntil(letter.deliver_on)
            return (
              <Card key={letter.id} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">&#x1F48C;</span>
                    <p className="text-sm font-medium text-foreground">{t("letters.future.waiting_card")}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {days === 0 ? t("letters.future.waiting_opens_today") : t("letters.future.waiting_opens_in", { days })}
                  </span>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Opened archive */}
      {archivedFutureLetters.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("letters.future.archive_title")}</p>
          {archivedFutureLetters.map((letter) => (
            <Link key={letter.id} to={`/letters/future/${letter.id}`}>
              <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{formatDeliverOn(letter.deliver_on, i18n.language)}</p>
                  <p className="mt-1 text-sm font-medium italic text-foreground/90">{t("letters.future.archived_card")}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="pt-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("letters.weekly_section_title")}</p>
      </div>

      {loading ? (
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("letters.loading")}</span>
            </div>
          </CardContent>
        </Card>
      ) : letters.length > 0 ? (
        <div className="space-y-3">
          {letters.map((letter) => (
            <Link key={letter.id} to={`/letters/${letter.week_start}`}>
              <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
                <CardContent className="p-5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {formatWeekRange(letter.week_start, letter.week_end, i18n.language)}
                  </p>
                  <p className="mt-1.5 font-heading text-base italic leading-relaxed text-foreground/90">
                    {firstLine(letter.letter_text)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <EmptyState icon="flower" titleKey="letters.empty" descriptionKey="letters.empty_sub" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
