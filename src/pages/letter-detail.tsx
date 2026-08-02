import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { formatWeekRange } from "@/lib/letters"
import { shareLetter } from "@/lib/letter-share"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Share2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { WeeklyLetter } from "@/types"

export function LetterDetailPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { weekStart } = useParams<{ weekStart: string }>()
  const [letter, setLetter] = useState<WeeklyLetter | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (user && weekStart) loadLetter(weekStart)
  }, [user, weekStart])

  async function loadLetter(week: string) {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("weekly_letters")
        .select("*")
        .eq("user_id", user.id)
        .eq("week_start", week)
        .maybeSingle()

      if (error) throw error
      setLetter(data as WeeklyLetter | null)
    } catch (err: any) {
      console.error("Failed to load letter:", err)
      toast.error(t("letters.error_load"))
    } finally {
      setLoading(false)
    }
  }

  async function handleShare() {
    if (!letter) return
    setSharing(true)
    try {
      const result = await shareLetter({
        letterText: letter.letter_text,
        weekLabel: formatWeekRange(letter.week_start, letter.week_end, i18n.language),
        badge: t("letters.badge"),
        signature: t("letters.signature"),
      })
      if (result === "copied") toast.success(t("letters.share_copied"))
      else if (result === "downloaded") toast.success(t("letters.share_downloaded"))
      else if (result === "failed") toast.error(t("letters.share_failed"))
    } finally {
      setSharing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!letter) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("letters.not_found")}</p>
        <Link to="/letters" className="mt-4 inline-block text-sm text-primary underline underline-offset-4">
          {t("letters.back_to_list")}
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/letters"
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("letters.back_to_list")}
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleShare}
          disabled={sharing}
          className="gap-1.5 text-primary hover:bg-primary/5"
        >
          {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          {t("letters.share")}
        </Button>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-sage-light/50 via-card to-lavender/20 p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("letters.badge")}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatWeekRange(letter.week_start, letter.week_end, i18n.language)}
          </p>
        </div>

        <div className="whitespace-pre-line font-heading text-lg italic leading-relaxed text-foreground/90">
          {letter.letter_text}
        </div>

        <p className="mt-10 text-right font-heading text-base italic text-primary">{t("letters.signature")}</p>
      </div>
    </div>
  )
}
