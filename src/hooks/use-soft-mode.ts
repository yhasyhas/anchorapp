import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { User } from "@supabase/supabase-js"
import { isThirdConsecutiveLowMoodDay, isAbsenceReturn, hasTwoConsecutiveGoodDaysEndingYesterday } from "@/lib/soft-mode"
import { isDailyFlagSet, setDailyFlag, DAILY_FLAGS } from "@/lib/local-flags"
import { todayStr } from "@/lib/utils"
import type { MoodLog, MoodType, Profile } from "@/types"

export interface UseSoftModeResult {
  softModeActive: boolean
  showEnterNudge: boolean
  showExitNudge: boolean
  // Not persisted — a fresh visit always starts with the lightweight
  // single-anchor picker; "add more" only lasts for the current session,
  // which is fine since it never hides tasks she already filled in.
  softExpanded: boolean
  setSoftExpanded: (expanded: boolean) => void
  softCategory: "future" | "mindbody" | "life" | null
  setSoftCategory: (category: "future" | "mindbody" | "life" | null) => void
  // Called from home.tsx's handleMoodSelect / loadContextData at the same
  // two points the checks always ran — this hook just owns the state and
  // dismissal bookkeeping behind them, not when they fire.
  checkEnterTrigger: (mood: MoodType, recentMoods: MoodLog[]) => void
  checkExitTrigger: (recentMoods: MoodLog[]) => void
  acceptSoftMode: () => Promise<void>
  dismissEnterNudge: () => void
  exitSoftMode: () => Promise<void>
  dismissExitNudge: () => void
}

// Extracted from src/pages/home.tsx. Soft Mode's own state (nudge
// visibility, the single-anchor picker's expand/category state) plus the
// two automatic trigger checks — see CLAUDE.md's Soft Mode feature for the
// product rules (propose, never impose; 3 heavy days or a 4+ day absence
// return to enter; 2 lighter days to propose exiting).
export function useSoftMode(
  user: User | null,
  profile: Profile | null,
  updateProfile: (updates: Partial<Profile>) => Promise<void>
): UseSoftModeResult {
  const { t } = useTranslation()
  const softModeActive = profile?.soft_mode ?? false

  const [showEnterNudge, setShowEnterNudge] = useState(false)
  const [showExitNudge, setShowExitNudge] = useState(false)
  const [softExpanded, setSoftExpanded] = useState(false)
  const [softCategory, setSoftCategory] = useState<"future" | "mindbody" | "life" | null>(null)

  function checkEnterTrigger(mood: MoodType, recentMoods: MoodLog[]) {
    if (!user || softModeActive) return
    if (isThirdConsecutiveLowMoodDay(mood, recentMoods) || isAbsenceReturn(recentMoods, mood)) {
      if (!isDailyFlagSet(DAILY_FLAGS.softEnterDismissed, user.id, todayStr())) setShowEnterNudge(true)
    }
  }

  function checkExitTrigger(recentMoods: MoodLog[]) {
    if (!user || !profile?.soft_mode) return
    if (hasTwoConsecutiveGoodDaysEndingYesterday(recentMoods)) {
      if (!isDailyFlagSet(DAILY_FLAGS.softExitDismissed, user.id, todayStr())) setShowExitNudge(true)
    }
  }

  async function acceptSoftMode() {
    await updateProfile({ soft_mode: true, soft_mode_since: new Date().toISOString() })
    setShowEnterNudge(false)
  }

  function dismissEnterNudge() {
    if (user) setDailyFlag(DAILY_FLAGS.softEnterDismissed, user.id, todayStr())
    setShowEnterNudge(false)
  }

  // Shared by both the automatic exit nudge and the badge's own "Return to
  // full rhythm" button, and by the Settings toggle indirectly (that one
  // calls updateProfile itself, same fields) — always a sober confirmation,
  // never framed as a "cure" (this isn't a medical app).
  async function exitSoftMode() {
    await updateProfile({ soft_mode: false, soft_mode_since: null })
    setShowExitNudge(false)
    toast.success(t("soft_mode.welcome_back"))
  }

  function dismissExitNudge() {
    if (user) setDailyFlag(DAILY_FLAGS.softExitDismissed, user.id, todayStr())
    setShowExitNudge(false)
  }

  return {
    softModeActive,
    showEnterNudge,
    showExitNudge,
    softExpanded,
    setSoftExpanded,
    softCategory,
    setSoftCategory,
    checkEnterTrigger,
    checkExitTrigger,
    acceptSoftMode,
    dismissEnterNudge,
    exitSoftMode,
    dismissExitNudge,
  }
}
