import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import { getPushState, requestPushPermission } from "@/lib/push"

const NUDGE_KEY_BASE = "anchor_push_nudge_seen"

interface PushNudgeProps {
  // The daily cycle (mood + anchors + check-in) just completed — a moment of
  // trust earned, not the first launch, which is when we ask about reminders.
  active: boolean
  // Same single-nudge-slot arbitration as GratitudeReminderCard — see the
  // priority order in home.tsx.
  onVisibilityChange?: (visible: boolean) => void
  suppressed?: boolean
}

export function PushNudge({ active, onVisibilityChange, suppressed }: PushNudgeProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active || !user) return
    if (getUserLocalData<string>(NUDGE_KEY_BASE, user.id)) return

    let cancelled = false
    getPushState().then((state) => {
      if (!cancelled && state === "not-subscribed") setVisible(true)
    })
    return () => {
      cancelled = true
    }
  }, [active, user])

  useEffect(() => {
    onVisibilityChange?.(visible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function dismiss() {
    if (user) setUserLocalData(NUDGE_KEY_BASE, user.id, "1")
    setVisible(false)
  }

  async function enable() {
    if (!user) return
    dismiss()
    const state = await requestPushPermission(user.id)
    if (state === "subscribed") {
      await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          reminders_enabled: true,
          morning_enabled: true,
          midday_enabled: true,
          evening_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
    }
  }

  if (!visible || suppressed) return null

  return (
    <div className="rounded-xl bg-secondary p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-light">
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{t("nudge.push_title")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("nudge.push_message")}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={enable} className="flex-1">
              {t("nudge.push_enable")}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} className="flex-1 text-muted-foreground">
              {t("nudge.continue_anyway")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
