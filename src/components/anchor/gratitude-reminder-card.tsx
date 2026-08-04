import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import { getWeekKey } from "@/lib/ai-service"
import { getLastGratitudeDate } from "@/lib/gratitude"
import { JarIcon } from "@/components/anchor/jar-icon"
import type { MoodType } from "@/types"

const REMINDER_SHOWN_WEEK_KEY_BASE = "anchor_jar_reminder_shown_week"
const QUIET_DAYS_THRESHOLD = 7
const LOW_MOODS = new Set(["low", "stressed"])

interface GratitudeReminderCardProps {
  // Caller (home.tsx) already knows today's mood from its own state — this
  // component never fetches mood itself, and the caller is expected to only
  // render it at all when todayMood is set and NOT low/stressed (see the
  // "never on a negative mood" rule), but the check is duplicated here too
  // as a hard safety net rather than trusting the render condition alone.
  todayMood: MoodType | null
  // Home arbitrates a single nudge slot across several self-contained nudge
  // components (see the priority order in home.tsx) — this reports "I have
  // something to show" without forcing a render, so Home can decide whether
  // this one actually wins the slot this visit.
  onVisibilityChange?: (visible: boolean) => void
  // Renders nothing even when internally visible — used when a
  // higher-priority nudge won the slot instead. The component stays
  // mounted either way, so its own effects/fetches keep running.
  suppressed?: boolean
}

export function GratitudeReminderCard({ todayMood, onVisibilityChange, suppressed }: GratitudeReminderCardProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!user || !todayMood || LOW_MOODS.has(todayMood)) return

    const thisWeek = getWeekKey()
    if (getUserLocalData<string>(REMINDER_SHOWN_WEEK_KEY_BASE, user.id) === thisWeek) return

    let cancelled = false
    getLastGratitudeDate()
      .then((lastDate) => {
        if (cancelled) return
        const daysSince = lastDate
          ? Math.floor((Date.now() - new Date(`${lastDate}T00:00:00`).getTime()) / 86400000)
          : Infinity
        if (daysSince >= QUIET_DAYS_THRESHOLD) {
          setVisible(true)
          setUserLocalData(REMINDER_SHOWN_WEEK_KEY_BASE, user.id, thisWeek)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, todayMood])

  useEffect(() => {
    onVisibilityChange?.(visible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible || suppressed) return null

  return (
    <div className="rounded-xl bg-secondary p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-light">
          <JarIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{t("jar.reminder_title")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("jar.reminder_body")}</p>
          <Link to="/jar">
            <Button size="sm" variant="ghost" className="mt-2 px-0 text-primary hover:bg-transparent hover:underline">
              {t("jar.reminder_cta")}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
