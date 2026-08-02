import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Bell } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { getPushState, requestPushPermission, unsubscribePush, type PushState } from "@/lib/push"

interface Prefs {
  reminders_enabled: boolean
  morning_enabled: boolean
  midday_enabled: boolean
  evening_enabled: boolean
}

const DEFAULT_PREFS: Prefs = {
  reminders_enabled: false,
  morning_enabled: true,
  midday_enabled: true,
  evening_enabled: true,
}

export function RemindersSection() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [pushState, setPushState] = useState<PushState>("not-subscribed")
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function load() {
      const [state, { data }] = await Promise.all([
        getPushState(),
        supabase
          .from("notification_preferences")
          .select("reminders_enabled, morning_enabled, midday_enabled, evening_enabled")
          .eq("user_id", user!.id)
          .maybeSingle(),
      ])
      if (cancelled) return
      setPushState(state)
      if (data) setPrefs(data)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user])

  async function persistPrefs(next: Prefs) {
    if (!user) return
    setPrefs(next)
    await supabase
      .from("notification_preferences")
      .upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
  }

  async function handleMasterToggle(enabled: boolean) {
    if (!user) return
    setBusy(true)
    try {
      if (enabled) {
        const state = await requestPushPermission(user.id)
        setPushState(state)
        if (state !== "subscribed") return
        await persistPrefs({ ...prefs, reminders_enabled: true })
      } else {
        await unsubscribePush(user.id)
        await persistPrefs({ ...prefs, reminders_enabled: false })
      }
    } finally {
      setBusy(false)
    }
  }

  function handleSubToggle(key: keyof Omit<Prefs, "reminders_enabled">, value: boolean) {
    persistPrefs({ ...prefs, [key]: value })
  }

  if (loading) return null

  const remindersOn = prefs.reminders_enabled && pushState === "subscribed"
  const switchDisabled = busy || pushState === "unsupported" || pushState === "ios-not-installed"

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{t("settings.reminders_title")}</p>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-sm text-foreground">{t("settings.reminders_enable")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.reminders_enable_desc")}</p>
          </div>
          <Switch checked={remindersOn} onCheckedChange={handleMasterToggle} disabled={switchDisabled} />
        </div>

        {pushState === "denied" && (
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.reminders_denied")}</p>
          </div>
        )}

        {pushState === "ios-not-installed" && (
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.reminders_ios_install")}</p>
          </div>
        )}

        {pushState === "unsupported" && (
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.reminders_unsupported")}</p>
          </div>
        )}

        {remindersOn && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground">{t("settings.reminders_morning")}</p>
              <Switch
                checked={prefs.morning_enabled}
                onCheckedChange={(v) => handleSubToggle("morning_enabled", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground">{t("settings.reminders_midday")}</p>
              <Switch
                checked={prefs.midday_enabled}
                onCheckedChange={(v) => handleSubToggle("midday_enabled", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground">{t("settings.reminders_evening")}</p>
              <Switch
                checked={prefs.evening_enabled}
                onCheckedChange={(v) => handleSubToggle("evening_enabled", v)}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
