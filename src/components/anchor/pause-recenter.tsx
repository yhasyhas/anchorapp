import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { isOnline } from "@/lib/offline-sync"
import { materializeDefaultSuggestions } from "@/lib/move-selection"
import { localDateStr } from "@/lib/utils"

interface PauseRecenterProps {
  onClose: () => void
}

const QUESTION_KEYS = ["pause.recenter_q1", "pause.recenter_q2", "pause.recenter_q3", "pause.recenter_q4"]
const LOW_MOODS = new Set(["low", "stressed"])

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateStr(d)
}

// Point 4c: one rotating gentle question plus a single contextual
// suggestion — Gratitude Jar if a recent mood was heavy, otherwise a
// mindful move from the pool. Deliberately just a suggestion + a link
// (not a 1-tap "add to anchor" like the planning picker) — this is the
// lightest of the 3 Pause options by design, a nudge elsewhere rather than
// its own data-writing flow.
export function PauseRecenter({ onClose }: PauseRecenterProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [question] = useState(() => QUESTION_KEYS[Math.floor(Math.random() * QUESTION_KEYS.length)])
  const [lowMoodRecent, setLowMoodRecent] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user || !isOnline()) {
      setLoaded(true)
      return
    }
    supabase
      .from("mood_logs")
      .select("date, mood")
      .eq("user_id", user.id)
      .gte("date", yesterdayStr())
      .then(({ data }) => {
        const moods = (data as { date: string; mood: string }[]) || []
        setLowMoodRecent(moods.some((m) => LOW_MOODS.has(m.mood)))
        setLoaded(true)
      })
  }, [user])

  const mindfulMove = materializeDefaultSuggestions(t).find((s) => s.category === "mindful")

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-background/98 p-6 text-center backdrop-blur-md">
      <p className="max-w-xs font-heading text-xl font-medium text-foreground">{t(question)}</p>

      {loaded &&
        (lowMoodRecent ? (
          <Link to="/jar" onClick={onClose}>
            <Button variant="outline">{t("pause.recenter_suggest_jar")}</Button>
          </Link>
        ) : mindfulMove ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("pause.recenter_suggest_move", { title: mindfulMove.title })}
            </p>
            <Link to="/move" onClick={onClose}>
              <Button variant="outline">{t("pause.recenter_open_move")}</Button>
            </Link>
          </div>
        ) : null)}

      <Button variant="ghost" className="text-muted-foreground" onClick={onClose}>
        {t("pause.not_now")}
      </Button>
    </div>
  )
}
