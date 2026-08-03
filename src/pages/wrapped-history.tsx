import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PartyPopper, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { MonthlyRecap } from "@/types"

function monthLabel(monthStart: string, lang: string): string {
  const locale = lang === "sw" ? "sw-TZ" : "en-US"
  return new Date(`${monthStart}T00:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" })
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? text
  return line.length > 110 ? `${line.slice(0, 110).trimEnd()}…` : line
}

export function WrappedHistoryPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [recaps, setRecaps] = useState<MonthlyRecap[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadRecaps()
  }, [user])

  async function loadRecaps() {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("monthly_recaps")
        .select("*")
        .eq("user_id", user.id)
        .order("month_start", { ascending: false })

      if (error) throw error
      setRecaps((data as MonthlyRecap[]) || [])
    } catch (err) {
      console.error("Failed to load Wrapped history:", err)
      toast.error(t("wrapped.error_load"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("wrapped.history_title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("wrapped.history_subtitle")}</p>
      </div>

      {loading ? (
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("wrapped.loading")}</span>
            </div>
          </CardContent>
        </Card>
      ) : recaps.length > 0 ? (
        <div className="space-y-3">
          {recaps.map((recap) => (
            <Link key={recap.id} to={`/wrapped/${recap.month_start}`}>
              <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
                <CardContent className="p-5">
                  <p className="text-xs font-medium text-muted-foreground">{monthLabel(recap.month_start, i18n.language)}</p>
                  <p className="mt-1.5 font-heading text-base italic leading-relaxed text-foreground/90">
                    {firstLine(recap.evolution_sentence)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <EmptyState icon="seedling" titleKey="wrapped.empty" descriptionKey="wrapped.empty_sub" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
