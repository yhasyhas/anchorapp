import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { getLastActivityDates, isWelcomeBackEligible } from "@/lib/welcome-back"

// A discreet, one-time banner (never a full card, never a modal) when she
// opens the app on her own after ≥21 days without a significant activity.
// No day count, no "we missed you", no push notification — see
// src/lib/welcome-back.ts for the eligibility rule. Marked seen on mount
// (not only on explicit dismiss) so "shown once" holds even if she never
// taps the close button — the X is just a way to hide it from view sooner,
// not a separate "seen" event.
export function WelcomeBackBanner() {
  const { t } = useTranslation()
  const { user, profile, updateProfile } = useAuth()
  const [visible, setVisible] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (!user || !profile || checkedRef.current) return
    checkedRef.current = true
    let cancelled = false

    getLastActivityDates(user.id)
      .then((dates) => {
        if (cancelled) return
        const eligible = isWelcomeBackEligible(dates, profile.welcome_back_shown_at)
        setVisible(eligible)
        if (eligible) {
          updateProfile({ welcome_back_shown_at: new Date().toISOString() }).catch((err) => {
            console.error("Failed to stamp welcome_back_shown_at:", err)
          })
        }
      })
      .catch((err) => {
        console.error("Failed to check welcome-back eligibility:", err)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile])

  if (!visible) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-anchor-card-lg bg-sage-light/40 px-4 py-2.5 animate-in fade-in slide-in-from-top-1">
      <p className="text-sm text-foreground/90">{t("welcome_back.message")}</p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t("welcome_back.dismiss")}
        className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
