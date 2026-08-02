import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { TonePicker } from "@/components/tone-picker"
import { Anchor, Sparkles, Bell, Compass, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { userKey, setUserLocalData } from "@/lib/user-storage"
import { getPushState, requestPushPermission, type PushState } from "@/lib/push"
import { lifeIntentions, FIRST_INTENTION_KEY_BASE } from "@/lib/constants"
import type { Tone } from "@/types"

const ONBOARDING_KEY_BASE = "anchor_has_seen_onboarding"
const STEP_COUNT = 4

interface ReminderPrefs {
  morning_enabled: boolean
  midday_enabled: boolean
  evening_enabled: boolean
}

export function OnboardingModal() {
  const { t } = useTranslation()
  const { user, profile, updateProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const [tone, setTone] = useState<Tone>("gentle")
  const [reminderPrefs, setReminderPrefs] = useState<ReminderPrefs>({
    morning_enabled: true,
    midday_enabled: true,
    evening_enabled: true,
  })
  const [pushState, setPushState] = useState<PushState>("not-subscribed")
  const [lifeIntention, setLifeIntention] = useState<string | null>(null)

  // Server-side onboarded_at is the source of truth (survives across devices) — the
  // localStorage flag is only a fast same-device cache on top of it, checked so the modal
  // doesn't flash open for a split second while the profile fetch is still in flight.
  useEffect(() => {
    if (!user || !profile) return
    if (profile.onboarded_at) return
    const cachedSeen = localStorage.getItem(userKey(ONBOARDING_KEY_BASE, user.id))
    if (cachedSeen) return
    setOpen(true)
    getPushState().then(setPushState)
  }, [user, profile])

  function markLocallySeen() {
    if (user) localStorage.setItem(userKey(ONBOARDING_KEY_BASE, user.id), "true")
  }

  async function persistReminderPrefs(enabled: boolean) {
    if (!user) return
    await supabase.from("notification_preferences").upsert(
      { user_id: user.id, reminders_enabled: enabled, ...reminderPrefs, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
  }

  async function handleFinish() {
    if (!user || busy) return
    setBusy(true)
    try {
      const wantsReminders = reminderPrefs.morning_enabled || reminderPrefs.midday_enabled || reminderPrefs.evening_enabled
      let finalPushState = pushState
      if (wantsReminders && pushState === "not-subscribed") {
        finalPushState = await requestPushPermission(user.id)
      }
      if (wantsReminders && (finalPushState === "subscribed" || pushState === "subscribed")) {
        await persistReminderPrefs(true)
      }

      if (lifeIntention) setUserLocalData(FIRST_INTENTION_KEY_BASE, user.id, lifeIntention)

      await updateProfile({ tone, onboarded_at: new Date().toISOString() })
      markLocallySeen()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleSkip() {
    if (!user || busy) return
    setBusy(true)
    try {
      // A true skip: no permission prompt, no reminder prefs written — just accept the
      // tone she has selected so far (default 'gentle' if she hadn't touched it) and stop
      // asking. She can always turn reminders on and change tone later in Settings.
      await updateProfile({ tone, onboarded_at: new Date().toISOString() })
      markLocallySeen()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const bgByStep = ["bg-sage-light/50", "bg-lavender/20", "bg-rose-accent/20", "bg-peach/20"]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6">
      <div
        className={`max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-3xl p-8 text-center transition-all duration-500 ${bgByStep[step]}`}
      >
        {step === 0 && (
          <div>
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-popover shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                <Anchor className="h-10 w-10 text-primary" />
              </div>
            </div>
            <h2 className="font-heading text-2xl font-bold text-foreground mb-3">{t("onboarding.welcome_title")}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("onboarding.welcome_text")}</p>
          </div>
        )}

        {step === 1 && (
          <div className="text-left">
            <div className="mb-5 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-popover shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h2 className="text-center font-heading text-xl font-bold text-foreground mb-1.5">{t("onboarding.tone_title")}</h2>
            <p className="text-center text-sm text-muted-foreground leading-relaxed mb-5">{t("onboarding.tone_subtitle")}</p>
            <TonePicker value={tone} onChange={setTone} />
          </div>
        )}

        {step === 2 && (
          <div className="text-left">
            <div className="mb-5 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-popover shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                <Bell className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h2 className="text-center font-heading text-xl font-bold text-foreground mb-1.5">{t("onboarding.reminders_title")}</h2>
            <p className="text-center text-sm text-muted-foreground leading-relaxed mb-5">{t("onboarding.reminders_subtitle")}</p>

            <div className="space-y-3 rounded-2xl bg-popover/70 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground">{t("settings.reminders_morning")}</p>
                <Switch
                  checked={reminderPrefs.morning_enabled}
                  disabled={pushState === "unsupported"}
                  onCheckedChange={(v) => setReminderPrefs((p) => ({ ...p, morning_enabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground">{t("settings.reminders_midday")}</p>
                <Switch
                  checked={reminderPrefs.midday_enabled}
                  disabled={pushState === "unsupported"}
                  onCheckedChange={(v) => setReminderPrefs((p) => ({ ...p, midday_enabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground">{t("settings.reminders_evening")}</p>
                <Switch
                  checked={reminderPrefs.evening_enabled}
                  disabled={pushState === "unsupported"}
                  onCheckedChange={(v) => setReminderPrefs((p) => ({ ...p, evening_enabled: v }))}
                />
              </div>
            </div>

            {pushState === "not-subscribed" && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{t("onboarding.reminders_permission_note")}</p>
            )}
            {pushState === "ios-not-installed" && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{t("settings.reminders_ios_install")}</p>
            )}
            {pushState === "unsupported" && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{t("settings.reminders_unsupported")}</p>
            )}
            {pushState === "denied" && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{t("settings.reminders_denied")}</p>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mb-5 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-popover shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                <Compass className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h2 className="font-heading text-xl font-bold text-foreground mb-1.5">{t("onboarding.life_title")}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">{t("onboarding.life_subtitle")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {lifeIntentions.map((key) => {
                const selected = lifeIntention === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLifeIntention(selected ? null : key)}
                    className={`rounded-full px-4 py-2 text-sm transition-all ${
                      selected ? "bg-primary text-primary-foreground" : "bg-popover text-foreground hover:bg-popover/70"
                    }`}
                  >
                    {t(`onboarding.life_intentions.${key}`)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Dots */}
        <div className="flex justify-center gap-2 mb-6 mt-8">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)} disabled={busy}>
              {t("onboarding.back")}
            </Button>
          )}
          {step < STEP_COUNT - 1 ? (
            <Button className="flex-1" onClick={() => setStep(step + 1)}>
              {t("onboarding.next")}
            </Button>
          ) : (
            <Button className="flex-1" onClick={handleFinish} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {t("onboarding.start")}
            </Button>
          )}
        </div>

        <button
          onClick={handleSkip}
          disabled={busy}
          className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("onboarding.skip")}
        </button>
      </div>
    </div>
  )
}
