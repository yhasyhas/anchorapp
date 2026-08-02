import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { markLettersSeen, formatWeekRange } from "@/lib/letters"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Mail, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { WeeklyLetter } from "@/types"

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? text
  return line.length > 110 ? `${line.slice(0, 110).trimEnd()}…` : line
}

export function LettersPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [letters, setLetters] = useState<WeeklyLetter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadLetters()
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

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("letters.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("letters.subtitle")}</p>
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
