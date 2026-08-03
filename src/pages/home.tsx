import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { generateCompanionMessage, getWeekKey } from "@/lib/ai-service"
import {
  resolveMoveReason,
  pickFeaturedSuggestion,
  getMoveMoodCorrelation,
  filterVisibleMoveSuggestions,
} from "@/lib/move-selection"
import { MoveOfTheDayCard } from "@/components/anchor/move-of-the-day-card"
import { calculateStreaks, reachedAnchorMilestone, MIN_STREAK_FOR_INTENTION, type StreakData } from "@/lib/streaks"
import { getUserLocalData, setUserLocalData, removeUserLocalData } from "@/lib/user-storage"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Settings, Info, Heart, Flame, Anchor as AnchorIcon, Sparkles, Lock, Pencil, Sun, Moon, Mail, PartyPopper } from "lucide-react"
import { toast } from "sonner"
import { moodConfig, intentions, FIRST_INTENTION_KEY_BASE } from "@/lib/constants"
import { todayStr, localDateStr, canCheckAnchors, getTimeUntilAnchorCheck } from "@/lib/utils"
import type { DailyAnchor, MoodType, CheckIn, MoodLog, MoveSuggestion, Gratitude } from "@/types"
import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { MorningRitual } from "@/components/anchor/morning-ritual"
import { ConfettiBurst } from "@/components/anchor/confetti"
import { GentleNudgeModal } from "@/components/anchor/gentle-nudge-modal"
import { PushNudge } from "@/components/anchor/push-nudge"
import { JournalCard } from "@/components/anchor/journal-card"
import { StreakMilestoneModal } from "@/components/anchor/streak-milestone-modal"
import { getLastSeenLetterWeek } from "@/lib/letters"
import { CircleInviteNudge } from "@/components/circle/circle-invite-nudge"
import { SosWidget } from "@/components/anchor/sos-widget"
import { listPendingReceivedInvites, listReceivedEncouragements } from "@/lib/circle"
import { getAllGratitudesForReveal, isSecondConsecutiveLowMoodDay } from "@/lib/gratitude"
import { GratitudeDropCard } from "@/components/anchor/gratitude-drop-card"
import { GratitudeReminderCard } from "@/components/anchor/gratitude-reminder-card"
import { JarOpeningModal } from "@/components/anchor/jar-opening-modal"
import { JarIcon } from "@/components/anchor/jar-icon"
import { isThirdConsecutiveLowMoodDay, isAbsenceReturn, hasTwoConsecutiveGoodDaysEndingYesterday } from "@/lib/soft-mode"
import { SoftModeNudgeCard } from "@/components/anchor/soft-mode-nudge-card"
import { SoftModeBadge } from "@/components/anchor/soft-mode-badge"
import { ensureWrappedGenerated } from "@/lib/wrapped"

const ANCHOR_MILESTONES_CELEBRATED_KEY = "anchor_streak_milestones_celebrated"

function intentionLabel(t: (key: string) => string, rawIntention: string | null): string | null {
  if (!rawIntention) return null
  return t(`intentions.${rawIntention.toLowerCase()}`).toLowerCase()
}

function getGreetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "home.greeting"
  if (hour < 18) return "home.greeting_afternoon"
  return "home.greeting_evening"
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateStr(d) // ← date locale, pas UTC (setDate() local + toISOString() UTC créaient un décalage)
}

function getDayModeKey(userId: string): string {
  return `anchor_day_mode_${userId}_${todayStr()}`
}

export function HomePage() {
  const { t, i18n } = useTranslation()
  const { user, profile, updateProfile } = useAuth()
  const softModeActive = profile?.soft_mode ?? false
  const [selectedMood, setSelectedMood] = useState<MoodType | null>(null)
  const [anchor, setAnchor] = useState<DailyAnchor>({
    id: "",
    user_id: user?.id ?? "",
    date: todayStr(),
    future_task: "",
    future_completed: false,
    mindbody_task: "",
    mindbody_completed: false,
    life_task: "",
    life_completed: false,
    daily_intention: "",
    anchors_locked_at: null,
    soft_mode_day: false,
    created_at: "",
  })

  const [dayMode, setDayMode] = useState<"planning" | "tracking">("planning")
  const [recentMoods, setRecentMoods] = useState<MoodLog[]>([])
  const [recentAnchors, setRecentAnchors] = useState<DailyAnchor[]>([])
  const [recentCheckInMoods, setRecentCheckInMoods] = useState<{ date: string; evening_mood: string | null }[]>([])
  const [moveSuggestions, setMoveSuggestions] = useState<MoveSuggestion[]>([])

  const [streaks, setStreaks] = useState<StreakData>({
    currentMoodStreak: 0,
    currentAnchorStreak: 0,
    bestMoodStreak: 0,
    bestAnchorStreak: 0,
    moodStreakIntention: null,
    anchorStreakIntention: null,
  })
  const [companionMsg, setCompanionMsg] = useState<string>("")
  const [loadingCompanion, setLoadingCompanion] = useState(true)
  const [showConfetti, setShowConfetti] = useState(false)
  const [streakMilestone, setStreakMilestone] = useState<number | null>(null)
  const [hasUnreadLetter, setHasUnreadLetter] = useState(false)
  const [hasPendingCircleInvite, setHasPendingCircleInvite] = useState(false)
  const [hasUnreadEncouragement, setHasUnreadEncouragement] = useState(false)

  const [checkInDone, setCheckInDone] = useState(false)

  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [nudgeType, setNudgeType] = useState<"mood" | "intention">("mood")
  const [pendingLock, setPendingLock] = useState(false)

  const [jarModalOpen, setJarModalOpen] = useState(false)
  const [jarGratitudes, setJarGratitudes] = useState<Gratitude[]>([])

  const [showSoftEnterNudge, setShowSoftEnterNudge] = useState(false)
  const [showSoftExitNudge, setShowSoftExitNudge] = useState(false)
  // Not persisted — a fresh visit always starts with the lightweight
  // single-anchor picker; "add more" only lasts for the current session,
  // which is fine since it never hides tasks she already filled in.
  const [softExpanded, setSoftExpanded] = useState(false)
  const [softCategory, setSoftCategory] = useState<"future" | "mindbody" | "life" | null>(null)

  useEffect(() => {
    if (user) {
      // loadContextData a besoin de daily_intention pour personnaliser le message du
      // companion — on chaîne explicitement plutôt que de compter sur le state React
      // (loadTodayData() est async et setAnchor() n'aurait pas encore appliqué sa mise à
      // jour au moment où loadContextData lirait la valeur via une closure sur `anchor`).
      loadTodayData().then((todayAnchor) => loadContextData(todayAnchor))
    }
  }, [user])

  useEffect(() => {
    if (dayMode === "tracking" && anchor.future_completed && anchor.mindbody_completed && anchor.life_completed) {
      const celebratedKey = `anchor_celebrated_${user?.id}_${todayStr()}`
      if (!localStorage.getItem(celebratedKey)) {
        setShowConfetti(true)
        localStorage.setItem(celebratedKey, "true")
        setTimeout(() => setShowConfetti(false), 2000)
      }
    }
  }, [anchor.future_completed, anchor.mindbody_completed, anchor.life_completed, dayMode])

  // Célébration de palier (7/14/21/30 jours d'anchor streak) — une seule fois par palier
  // et par utilisatrice, mémorisé en localStorage (même pattern que le cache IA).
  useEffect(() => {
    if (!user) return
    const milestone = reachedAnchorMilestone(streaks.currentAnchorStreak)
    if (!milestone) return

    const celebrated = getUserLocalData<number[]>(ANCHOR_MILESTONES_CELEBRATED_KEY, user.id) || []
    if (celebrated.includes(milestone)) return

    setStreakMilestone(milestone)
    setUserLocalData(ANCHOR_MILESTONES_CELEBRATED_KEY, user.id, [...celebrated, milestone])
  }, [streaks.currentAnchorStreak, user])

  useEffect(() => {
    if (user) checkUnreadLetter()
  }, [user])

  // Fire-and-forget, same "nothing to show for it unless it finds something"
  // pattern as checkUnreadLetter above — generates last month's Wrapped the
  // first time she opens the app in a new month (see src/lib/wrapped.ts).
  useEffect(() => {
    if (user) ensureWrappedGenerated(user, profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Drives only the Settings icon's badge dot — the nudge card itself
  // (CircleInviteNudge, rendered below) does its own independent fetch of
  // the same data, same pattern as PushNudge fetching its own push state.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listPendingReceivedInvites(user.id)
      .then((invites) => {
        if (!cancelled) setHasPendingCircleInvite(invites.length > 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  // Same badge-dot pattern — the /circle page itself marks encouragements
  // read as soon as it's opened, so this only ever reflects "not yet seen".
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listReceivedEncouragements()
      .then((received) => {
        if (!cancelled) setHasUnreadEncouragement(received.some((e) => !e.read_at))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  async function checkUnreadLetter() {
    if (!user) return
    try {
      const { data } = await supabase
        .from("weekly_letters")
        .select("week_start")
        .eq("user_id", user.id)
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle()

      const latest = data?.week_start
      if (!latest) return
      const lastSeen = getLastSeenLetterWeek(user.id)
      setHasUnreadLetter(!lastSeen || latest > lastSeen)
    } catch {
      // Badge is a nice-to-have — not worth surfacing an error toast for.
    }
  }

  async function loadTodayData(): Promise<DailyAnchor | undefined> {
    if (!user) return undefined
    let resolvedAnchor: DailyAnchor | undefined
    try {
      const localKey = `anchor_${user.id}_${todayStr()}`
      const cached = getLocalData<DailyAnchor>(localKey)
      const modeKey = getDayModeKey(user.id)
      const savedMode = getLocalData<"planning" | "tracking">(modeKey)

      if (isOnline()) {
        const { data, error } = await supabase
          .from("daily_anchors")
          .select("*")
          .eq("user_id", user.id)
          .eq("date", todayStr())
          .maybeSingle()

        if (error) throw error

        if (data) {
          setAnchor(data)
          setLocalData(localKey, data)
          if (savedMode) {
            setDayMode(savedMode)
          } else if (data.anchors_locked_at || data.future_completed || data.mindbody_completed || data.life_completed) {
            // anchors_locked_at is the server-side source of truth for "day
            // started" — checked first so a second device picks up a lock
            // made elsewhere even before any task has been checked off
            // there (savedMode only exists on the device that did the
            // locking; this is what makes a fresh device catch up).
            setDayMode("tracking")
          }
          resolvedAnchor = data
        } else if (cached) {
          setAnchor(cached)
          if (savedMode) {
            setDayMode(savedMode)
          } else if (cached.anchors_locked_at) {
            setDayMode("tracking")
          }
          resolvedAnchor = cached
        }

        const { data: moodData, error: moodError } = await supabase
          .from("mood_logs")
          .select("mood")
          .eq("user_id", user.id)
          .eq("date", todayStr())
          .maybeSingle()

        if (moodError) throw moodError
        if (moodData) setSelectedMood(moodData.mood as MoodType)
      } else if (cached) {
        setAnchor(cached)
        const savedMode = getLocalData<"planning" | "tracking">(modeKey)
        if (savedMode) {
          setDayMode(savedMode)
        } else if (cached.anchors_locked_at) {
          setDayMode("tracking")
        }
        resolvedAnchor = cached
      }
    } catch (err: any) {
      console.error("Failed to load today's data:", err)
      toast.error(t("home.error_load_daily"))
    }
    return resolvedAnchor
  }

  async function loadContextData(todayAnchor?: DailyAnchor) {
    if (!user) return
    try {
      const thirtyAgo = new Date()
      thirtyAgo.setDate(thirtyAgo.getDate() - 30)
      const since = localDateStr(thirtyAgo)

      const [{ data: monthMoods }, { data: monthAnchors }, { data: monthCheckIns }, { data: moveSuggestionsData }] = await Promise.all([
        supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", since),
        supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", since),
        supabase.from("check_ins").select("date, evening_mood").eq("user_id", user.id).gte("date", since),
        supabase.from("move_suggestions").select("*").eq("user_id", user.id),
      ])

      const moods = (monthMoods || []) as MoodLog[]
      const anchors = (monthAnchors || []) as DailyAnchor[]

      setRecentMoods(moods)
      setRecentAnchors(anchors)

      // Exit proposal: evaluated each morning, before today's mood is
      // necessarily logged — 2 lighter days in a row while soft mode is
      // already active. Same daily-dismissal pattern as the jar prompt.
      if (profile?.soft_mode && hasTwoConsecutiveGoodDaysEndingYesterday(moods)) {
        const dismissedKey = `anchor_soft_exit_dismissed_${user.id}_${todayStr()}`
        if (!localStorage.getItem(dismissedKey)) setShowSoftExitNudge(true)
      }
      setRecentCheckInMoods((monthCheckIns as { date: string; evening_mood: string | null }[]) || [])
      setMoveSuggestions((moveSuggestionsData as MoveSuggestion[]) || [])
      setStreaks(calculateStreaks(moods, anchors))

      const { data: todayCheckIn } = await supabase
        .from("check_ins")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", todayStr())
        .maybeSingle()

      setCheckInDone(!!todayCheckIn)

      const [{ data: yCheckIn }, { data: yMood }] = await Promise.all([
        supabase.from("check_ins").select("what_matters, what_felt_real").eq("user_id", user.id).eq("date", yesterdayStr()).maybeSingle(),
        supabase.from("mood_logs").select("mood").eq("user_id", user.id).eq("date", yesterdayStr()).maybeSingle(),
      ])

      // Consumed once: only the very first companion message after onboarding's optional
      // "what brings you here" screen gets enriched by it (see onboarding-modal.tsx).
      const firstIntention = getUserLocalData<string>(FIRST_INTENTION_KEY_BASE, user.id)
      if (firstIntention) removeUserLocalData(FIRST_INTENTION_KEY_BASE, user.id)

      const msg = await generateCompanionMessage(
        profile?.ai_enabled ?? false,
        yCheckIn as CheckIn | null,
        yMood as MoodLog | null,
        todayAnchor?.daily_intention ?? "",
        i18n.language as "en" | "sw",
        profile?.tone ?? "gentle",
        firstIntention,
        profile?.soft_mode ?? false
      )
      setCompanionMsg(msg)
    } catch (err: any) {
      console.error("Failed to load context:", err)
      setCompanionMsg(t("companion.default_message"))
    } finally {
      setLoadingCompanion(false)
    }
  }

  function refreshStreaks(updatedMoods?: MoodLog[], updatedAnchors?: DailyAnchor[]) {
    const m = updatedMoods || recentMoods
    const a = updatedAnchors || recentAnchors
    if (m.length || a.length) {
      setStreaks(calculateStreaks(m, a))
    }
  }

  async function handleMoodSelect(mood: MoodType) {
    if (!user) return
    setSelectedMood(mood)
    if (navigator.vibrate) navigator.vibrate(50)

    const record = { user_id: user.id, date: todayStr(), mood }
    const updatedMoods = recentMoods.filter((m) => m.date !== todayStr())
    updatedMoods.push(record as MoodLog)
    setRecentMoods(updatedMoods)
    refreshStreaks(updatedMoods, undefined)

    try {
      if (isOnline()) {
        const { error } = await supabase.from("mood_logs").upsert(record, { onConflict: "user_id,date" })
        if (error) throw error
      } else {
        addToSyncQueue(user.id, { table: "mood_logs", action: "upsert", data: record, conflictKey: "user_id,date" })
      }
    } catch (err: any) {
      console.error("Failed to save mood:", err)
      toast.error(t("home.error_save_mood"))
    }

    // Soft Mode entry proposal — never automatic, just a gentle offer (see
    // SoftModeNudgeCard): 3 consecutive heavy days, or a return after a 4+
    // day absence, and she hasn't already been offered (or dismissed) today.
    if (!softModeActive && (isThirdConsecutiveLowMoodDay(mood, recentMoods) || isAbsenceReturn(recentMoods, mood))) {
      const dismissedKey = `anchor_soft_enter_dismissed_${user.id}_${todayStr()}`
      if (!localStorage.getItem(dismissedKey)) setShowSoftEnterNudge(true)
    }

    // Gratitude jar reveal offer — never automatic (see JarOpeningModal),
    // just the trigger check: today's mood is the 2nd consecutive
    // low/stressed day, and she hasn't already been offered today.
    if (isSecondConsecutiveLowMoodDay(mood, recentMoods)) {
      const shownKey = `anchor_jar_prompt_shown_${user.id}_${todayStr()}`
      if (!localStorage.getItem(shownKey)) {
        localStorage.setItem(shownKey, "true")
        openJarPrompt()
      }
    }
  }

  async function openJarPrompt() {
    try {
      const all = await getAllGratitudesForReveal()
      setJarGratitudes(all)
      setJarModalOpen(true)
    } catch (err) {
      console.error("Failed to load jar for reveal:", err)
    }
  }

  async function acceptSoftMode() {
    await updateProfile({ soft_mode: true, soft_mode_since: new Date().toISOString() })
    setShowSoftEnterNudge(false)
  }

  function dismissSoftEnterNudge() {
    if (user) localStorage.setItem(`anchor_soft_enter_dismissed_${user.id}_${todayStr()}`, "true")
    setShowSoftEnterNudge(false)
  }

  // Shared by both the automatic exit nudge and the badge's own "Return to
  // full rhythm" button, and by the Settings toggle indirectly (that one
  // calls updateProfile itself, same fields) — always a sober confirmation,
  // never framed as a "cure" (this isn't a medical app).
  async function exitSoftMode() {
    await updateProfile({ soft_mode: false, soft_mode_since: null })
    setShowSoftExitNudge(false)
    toast.success(t("soft_mode.welcome_back"))
  }

  function dismissSoftExitNudge() {
    if (user) localStorage.setItem(`anchor_soft_exit_dismissed_${user.id}_${todayStr()}`, "true")
    setShowSoftExitNudge(false)
  }

  async function saveAnchor(updates: Partial<DailyAnchor>) {
    if (!user) return
    const finalUpdates = { ...updates }
    if (softModeActive) {
      finalUpdates.soft_mode_day = true
    }

    if (dayMode === "planning") {
      if (updates.future_task !== undefined && updates.future_task !== anchor.future_task && anchor.future_completed) {
        finalUpdates.future_completed = false
      }
      if (updates.mindbody_task !== undefined && updates.mindbody_task !== anchor.mindbody_task && anchor.mindbody_completed) {
        finalUpdates.mindbody_completed = false
      }
      if (updates.life_task !== undefined && updates.life_task !== anchor.life_task && anchor.life_completed) {
        finalUpdates.life_completed = false
      }
    }

    const updated = { ...anchor, ...finalUpdates, user_id: user.id, date: todayStr() }
    setAnchor(updated)

    const localKey = `anchor_${user.id}_${todayStr()}`
    setLocalData(localKey, updated)

    const updatedAnchors = recentAnchors.filter((a) => a.date !== todayStr())
    updatedAnchors.push(updated)
    setRecentAnchors(updatedAnchors)
    refreshStreaks(undefined, updatedAnchors)

    const { id: _id, created_at: _created, ...record } = updated

    try {
      if (isOnline()) {
        const { error } = await supabase.from("daily_anchors").upsert(record, { onConflict: "user_id,date" })
        if (error) throw error
      } else {
        addToSyncQueue(user.id, { table: "daily_anchors", action: "upsert", data: record, conflictKey: "user_id,date" })
      }
    } catch (err: any) {
      console.error("Failed to save anchor:", err)
    }
  }

  function attemptLockDay() {
    if (!user) return
    if (!anchor.future_task && !anchor.mindbody_task && !anchor.life_task) {
      toast.error(t("home.error_min_anchor"))
      return
    }

    if (!selectedMood) {
      setNudgeType("mood")
      setNudgeOpen(true)
      setPendingLock(true)
      return
    }

    if (!anchor.daily_intention) {
      setNudgeType("intention")
      setNudgeOpen(true)
      setPendingLock(true)
      return
    }

    doLockDay()
  }

  function doLockDay() {
    if (!user) return
    setDayMode("tracking")
    setLocalData(getDayModeKey(user.id), "tracking")
    // Le verrou vit en base (daily_anchors.anchors_locked_at) via saveAnchor, avec le
    // même fallback offline (sync queue) que le reste des champs de l'ancre.
    saveAnchor({ anchors_locked_at: new Date().toISOString() })
    toast.success(t("home.day_locked_toast"))
    setPendingLock(false)
  }

  function handleNudgeChoose() {
    setNudgeOpen(false)
    setPendingLock(false)
  }

  function handleNudgeContinue() {
    setNudgeOpen(false)
    if (pendingLock) {
      doLockDay()
    }
  }

  function unlockDay() {
    if (!user) return
    setDayMode("planning")
    setLocalData(getDayModeKey(user.id), "planning")
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? ""
  const allAnchorsDone = anchor.future_completed && anchor.mindbody_completed && anchor.life_completed
  const hasAnyAnchorText = anchor.future_task || anchor.mindbody_task || anchor.life_task

  // Shared shape for both the soft-mode single-anchor picker and the
  // tracking list below — lets tracking mode filter down to "just the
  // categories she actually filled" without duplicating the 3 cards' worth
  // of JSX for the soft-mode case.
  const anchorDefs = [
    {
      key: "future" as const,
      icon: "\u{1F331}",
      borderColor: "var(--sage)",
      title: t("anchors.future"),
      subtitle: t("anchors.future_sub"),
      task: anchor.future_task,
      completed: anchor.future_completed,
      onTaskChange: (v: string) => saveAnchor({ future_task: v }),
      onCheckChange: (v: boolean) => saveAnchor({ future_completed: v }),
    },
    {
      key: "mindbody" as const,
      icon: "\u{1F9E0}",
      borderColor: "var(--rose-accent)",
      title: t("anchors.mindbody"),
      subtitle: t("anchors.mindbody_sub"),
      task: anchor.mindbody_task,
      completed: anchor.mindbody_completed,
      onTaskChange: (v: string) => saveAnchor({ mindbody_task: v }),
      onCheckChange: (v: boolean) => saveAnchor({ mindbody_completed: v }),
    },
    {
      key: "life" as const,
      icon: "\u{1F30D}",
      borderColor: "var(--lavender)",
      title: t("anchors.life"),
      subtitle: t("anchors.life_sub"),
      task: anchor.life_task,
      completed: anchor.life_completed,
      onTaskChange: (v: string) => saveAnchor({ life_task: v }),
      onCheckChange: (v: boolean) => saveAnchor({ life_completed: v }),
    },
  ]
  const filledAnchorDefs = anchorDefs.filter((d) => d.task)
  const softAllFilledDone = filledAnchorDefs.length > 0 && filledAnchorDefs.every((d) => d.completed)

  const moodDone = selectedMood !== null
  const anchorsDone = allAnchorsDone
  const cycleComplete = moodDone && anchorsDone && checkInDone

  // "Move of the day" — same shared selection logic as src/pages/move.tsx
  // (src/lib/move-selection.ts), fed from state this page already loads
  // (recentMoods, recentAnchors, streaks) plus the two lightweight fetches
  // added to loadContextData above. Only shown before the day is locked in.
  const moveWeekKey = getWeekKey()
  const visibleMoveSuggestions = filterVisibleMoveSuggestions(moveSuggestions, moveWeekKey)
  const moveReason = resolveMoveReason({ recentMoods, currentAnchorStreak: streaks.currentAnchorStreak })
  const featuredMovePick = moveReason === "absence" ? null : pickFeaturedSuggestion(visibleMoveSuggestions, moveReason)
  const featuredMoveTitle = moveReason === "absence" ? t("move.absence_fallback") : featuredMovePick?.title
  const featuredMoveCategory = moveReason === "absence" ? "physical" : featuredMovePick?.category ?? "physical"
  const featuredMoveIsAi = featuredMovePick?.generated_by === "ai"
  const moveCorrelationHint = featuredMoveTitle ? getMoveMoodCorrelation(featuredMoveTitle, recentAnchors, recentCheckInMoods) : null
  const moveCtaTarget: "life" | "mindbody" | undefined = !anchor.life_task ? "life" : !anchor.mindbody_task ? "mindbody" : undefined

  function handleAddMoveToAnchor(target: "life" | "mindbody") {
    if (!featuredMoveTitle) return
    if (target === "life") saveAnchor({ life_task: featuredMoveTitle })
    else saveAnchor({ mindbody_task: featuredMoveTitle })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <ConfettiBurst active={showConfetti} />
      <OnboardingModal />
      <MorningRitual onComplete={() => {}} />

      <GentleNudgeModal
        open={nudgeOpen}
        onClose={() => setNudgeOpen(false)}
        onChoose={handleNudgeChoose}
        onContinue={handleNudgeContinue}
        type={nudgeType}
      />

      <StreakMilestoneModal
        milestone={streakMilestone}
        intentionLabel={intentionLabel(t, streaks.anchorStreakIntention)}
        onClose={() => setStreakMilestone(null)}
      />

      <JarOpeningModal open={jarModalOpen} onClose={() => setJarModalOpen(false)} gratitudes={jarGratitudes} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {t(getGreetingKey())}{firstName ? `, ${firstName}` : ""} &#x1F33B;
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
          {softModeActive && (
            <div className="mt-2">
              <SoftModeBadge onExit={exitSoftMode} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link to="/letters">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("letters.title")}
            >
              <Mail className="h-5 w-5" />
              {hasUnreadLetter && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-accent" />
              )}
            </Button>
          </Link>
          <Link to="/circle">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("circle.page_title")}
            >
              <Heart className="h-5 w-5" />
              {hasUnreadEncouragement && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-accent" />
              )}
            </Button>
          </Link>
          <Link to="/wrapped">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("wrapped.history_title")}
            >
              <PartyPopper className="h-5 w-5" />
            </Button>
          </Link>
          <Link to="/jar">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("jar.page_title")}
            >
              <JarIcon className="h-5 w-5" />
            </Button>
          </Link>
          <Link to="/settings">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-5 w-5" />
              {hasPendingCircleInvite && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-accent" />
              )}
            </Button>
          </Link>
        </div>
      </div>

      <CircleInviteNudge />

      {showSoftEnterNudge && (
        <SoftModeNudgeCard variant="enter" onAccept={acceptSoftMode} onDismiss={dismissSoftEnterNudge} />
      )}
      {showSoftExitNudge && (
        <SoftModeNudgeCard variant="exit" onAccept={exitSoftMode} onDismiss={dismissSoftExitNudge} />
      )}

      {/* Companion */}
      <Card className="border-0 bg-gradient-to-br from-sage-light/60 to-lavender/30 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-0.5">
                {loadingCompanion ? t("companion.loading") : t("companion.title")}
              </p>
              <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                {companionMsg || t("companion.default_message")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Micro-tease for the upcoming Wrapped — pure date check, self-resolving once
          the month rolls over and generation (ensureWrappedGenerated above) takes over. */}
      {new Date().getDate() >= 28 && (
        <p className="text-center text-xs italic text-muted-foreground">{t("wrapped.teaser")}</p>
      )}

      {featuredMoveTitle && !anchor.anchors_locked_at && (
        <MoveOfTheDayCard
          title={featuredMoveTitle}
          category={featuredMoveCategory}
          isAiGenerated={featuredMoveIsAi}
          correlationHint={moveCorrelationHint}
          ctaTarget={moveCtaTarget}
          onAdd={handleAddMoveToAnchor}
        />
      )}

      {/* Daily Cycle */}
      <Card className={`border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] ${cycleComplete ? "bg-sage-light/40" : "bg-card"}`}>
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("daily_cycle.title")}
          </p>

          <div className="flex items-center justify-between">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 ${
                moodDone ? "bg-peach text-white dark:text-background shadow-md scale-110" : "bg-muted text-muted-foreground"
              }`}>
                <Sun className="h-4 w-4" />
              </div>
              <span className={`text-[10px] font-medium ${moodDone ? "text-peach" : "text-muted-foreground"}`}>
                {t("daily_cycle.mood")}
              </span>
            </div>

            <div className={`h-0.5 flex-1 mx-2 rounded-full transition-all duration-500 ${
              moodDone ? "bg-peach/60" : "bg-muted"
            }`} />

            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 ${
                anchorsDone ? "bg-primary text-primary-foreground shadow-md scale-110" : "bg-muted text-muted-foreground"
              }`}>
                <AnchorIcon className="h-4 w-4" />
              </div>
              <span className={`text-[10px] font-medium ${anchorsDone ? "text-primary" : "text-muted-foreground"}`}>
                {t("daily_cycle.anchors")}
              </span>
            </div>

            <div className={`h-0.5 flex-1 mx-2 rounded-full transition-all duration-500 ${
              anchorsDone ? "bg-primary/60" : "bg-muted"
            }`} />

            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 ${
                checkInDone ? "bg-lavender text-white dark:text-background shadow-md scale-110" : "bg-muted text-muted-foreground"
              }`}>
                <Moon className="h-4 w-4" />
              </div>
              <span className={`text-[10px] font-medium ${checkInDone ? "text-lavender" : "text-muted-foreground"}`}>
                {t("daily_cycle.checkin")}
              </span>
            </div>
          </div>

          {cycleComplete && (
            <div className="mt-3 text-center">
              <p className="text-xs font-medium text-primary animate-pulse">
                ✨ {t("daily_cycle.complete")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* One-Sentence Journal — a bonus, not part of the daily cycle */}
      <JournalCard />

      {/* Gratitude jar — same "small bonus habit" slot as the journal */}
      <GratitudeDropCard />

      {/* Streaks — mechanical count below MIN_STREAK_FOR_INTENTION, meaningful sentence
          above it (celebrated state: warmer card, dominant intention of the streak
          period). Stacked full-width instead of side-by-side once either card celebrates,
          so the sentence has room to breathe. */}
      <div className={(streaks.currentMoodStreak >= MIN_STREAK_FOR_INTENTION || streaks.currentAnchorStreak >= MIN_STREAK_FOR_INTENTION) ? "space-y-3" : "flex gap-3"}>
        <StreakCard
          icon={<Flame className="h-4 w-4" />}
          label={t("streaks.mood")}
          emoji="🔥"
          current={streaks.currentMoodStreak}
          best={streaks.bestMoodStreak}
          intention={streaks.moodStreakIntention}
          activeBg="bg-peach/30"
          activeText="text-peach"
          celebratedBg="bg-gradient-to-br from-peach/40 to-rose-accent/20"
        />
        <StreakCard
          icon={<AnchorIcon className="h-4 w-4" />}
          label={t("streaks.anchors")}
          emoji="⚓"
          current={streaks.currentAnchorStreak}
          best={streaks.bestAnchorStreak}
          intention={streaks.anchorStreakIntention}
          activeBg="bg-sage-light/60"
          activeText="text-primary"
          celebratedBg="bg-gradient-to-br from-sage-light/70 to-lavender/25"
        />
      </div>

      {/* Mood Selector */}
      <div className="flex justify-between gap-2">
        {moodConfig.map(({ key, emoji, color }) => (
          <button
            key={key}
            onClick={() => handleMoodSelect(key)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl p-3 transition-all duration-300 ${
              selectedMood === key
                ? "ring-2 ring-primary ring-offset-2 scale-110 shadow-md"
                : "hover:scale-105 hover:shadow-sm"
            }`}
            style={{ backgroundColor: color }}
          >
            <span className="text-2xl transition-transform duration-300">{emoji}</span>
            <span className="text-xs font-medium text-foreground">{t(`mood.${key}`)}</span>
          </button>
        ))}
      </div>

      {/* Daily Intention */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
        <CardContent className="p-5">
          <p className="mb-3 text-sm font-medium text-muted-foreground">{t("home.intention_label")}</p>
          <div className="flex flex-wrap gap-2">
            {intentions.map((intention) => (
              <button
                key={intention}
                onClick={() => saveAnchor({ daily_intention: intention })}
                className={`rounded-full px-4 py-1.5 text-sm transition-all duration-200 ${
                  anchor.daily_intention === intention
                    ? "bg-primary text-primary-foreground shadow-md scale-105"
                    : "bg-muted text-foreground hover:bg-accent hover:scale-105"
                }`}
              >
                {t(`intentions.${intention.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 3 Anchors */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg font-semibold">
              {softModeActive && !softExpanded ? t("soft_mode.one_thing_title") : <>{t("home.anchors_title")} &#x2693;</>}
            </h2>
            {(!softModeActive || softExpanded) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{t("home.why_three")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {dayMode === "planning" && hasAnyAnchorText && (
            <Button size="sm" onClick={attemptLockDay} className="gap-1.5 text-xs">
              <Lock className="h-3.5 w-3.5" />
              {t("home.start_my_day")}
            </Button>
          )}
          {dayMode === "tracking" && (
            <Button variant="ghost" size="sm" onClick={unlockDay} className="gap-1.5 text-xs text-muted-foreground">
              <Pencil className="h-3.5 w-3.5" />
              {t("home.edit")}
            </Button>
          )}
        </div>

        {dayMode === "planning" && (
          <div className="space-y-3">
            {softModeActive && !softExpanded ? (
              <SoftAnchorPicker
                defs={anchorDefs}
                selected={softCategory ?? anchorDefs.find((d) => d.task)?.key ?? null}
                onSelect={setSoftCategory}
                onExpand={() => setSoftExpanded(true)}
              />
            ) : (
              <>
                <PlanningAnchorCard
                  borderColor="var(--sage)"
                  icon="&#x1F331;"
                  title={t("anchors.future")}
                  subtitle={t("anchors.future_sub")}
                  task={anchor.future_task}
                  onTaskChange={(v) => saveAnchor({ future_task: v })}
                />
                <PlanningAnchorCard
                  borderColor="var(--rose-accent)"
                  icon="&#x1F9E0;"
                  title={t("anchors.mindbody")}
                  subtitle={t("anchors.mindbody_sub")}
                  task={anchor.mindbody_task}
                  onTaskChange={(v) => saveAnchor({ mindbody_task: v })}
                />
                <PlanningAnchorCard
                  borderColor="var(--lavender)"
                  icon="&#x1F30D;"
                  title={t("anchors.life")}
                  subtitle={t("anchors.life_sub")}
                  task={anchor.life_task}
                  onTaskChange={(v) => saveAnchor({ life_task: v })}
                />
              </>
            )}

            {hasAnyAnchorText && (
              <Button onClick={attemptLockDay} className="w-full" size="lg">
                <Lock className="mr-2 h-4 w-4" />
                {t("home.lock_anchors_cta")}
              </Button>
            )}
          </div>
        )}

        {dayMode === "tracking" && (
          <div className="space-y-3">
            {(softModeActive ? filledAnchorDefs : anchorDefs).map((d) => (
              <TrackingAnchorCard
                key={d.key}
                borderColor={d.borderColor}
                icon={d.icon}
                title={d.title}
                subtitle={d.subtitle}
                task={d.task}
                completed={d.completed}
                onCheckChange={d.onCheckChange}
                lockedAt={anchor.anchors_locked_at}
              />
            ))}

            {(softModeActive ? softAllFilledDone : allAnchorsDone) && (
              <div className="rounded-xl bg-sage-light/60 p-4 text-center">
                <p className="text-sm font-medium text-primary">
                  🎉 {t("home.all_anchors_done")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Supportive Message */}
      <Card className="border-0 bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
        <CardContent className="flex items-start gap-3 p-5">
          <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-accent" />
          <p className="font-heading text-sm italic text-foreground/80">
            {t("home.supportive")} &#x1F338;
          </p>
        </CardContent>
      </Card>

      <SosWidget />

      <GratitudeReminderCard todayMood={selectedMood} />

      <PushNudge active={cycleComplete} />
    </div>
  )
}

/* ─── Streak Card ─── */
interface StreakCardProps {
  icon: ReactNode
  label: string
  emoji: string
  current: number
  best: number
  intention: string | null
  activeBg: string
  activeText: string
  celebratedBg: string
}

function StreakCard({ icon, label, emoji, current, best, intention, activeBg, activeText, celebratedBg }: StreakCardProps) {
  const { t } = useTranslation()
  const celebrated = current >= MIN_STREAK_FOR_INTENTION
  // Un streak vient de se terminer : jamais culpabilisant, juste une phrase discrète en
  // option — visible uniquement si un streak a réellement existé avant (best > 0).
  const justEnded = current === 0 && best > 0

  const translatedIntention = intentionLabel(t, intention)
  const sentence = translatedIntention
    ? t("streaks.showing_up_with_intention", { count: current, intention: translatedIntention })
    : t("streaks.showing_up_for_yourself", { count: current })

  return (
    <Card
      className={`flex-1 border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-500 ${
        celebrated ? celebratedBg : current > 0 ? activeBg : "bg-muted/30"
      }`}
    >
      <CardContent className={celebrated ? "p-4" : "flex items-center gap-2 p-3"}>
        {celebrated ? (
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={activeText}>{icon}</span>
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
            </div>
            <p className="text-sm font-semibold leading-snug text-foreground">
              {sentence} {emoji}
            </p>
          </div>
        ) : (
          <>
            <span className={current > 0 ? activeText : "text-muted-foreground"}>{icon}</span>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold text-foreground">
                {current > 0 ? `${current} ${emoji}` : "—"}
              </p>
              {justEnded && (
                <p className="mt-0.5 text-[10px] italic text-muted-foreground">{t("streaks.rest_is_alignment")}</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Planning Card ─── */
interface PlanningAnchorCardProps {
  borderColor: string
  icon: string
  title: string
  subtitle: string
  task: string
  onTaskChange: (value: string) => void
}

function PlanningAnchorCard({ borderColor, icon, title, subtitle, task, onTaskChange }: PlanningAnchorCardProps) {
  const { t } = useTranslation()
  return (
    <Card
      className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Input
          value={task}
          onChange={(e) => onTaskChange(e.target.value)}
          placeholder={t("home.anchor_placeholder")}
          className="border-0 bg-muted/50 px-3 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
      </CardContent>
    </Card>
  )
}

/* ─── Soft Mode: single-anchor picker ─── */
interface SoftAnchorDef {
  key: "future" | "mindbody" | "life"
  icon: string
  borderColor: string
  title: string
  subtitle: string
  task: string
  onTaskChange: (value: string) => void
}

interface SoftAnchorPickerProps {
  defs: SoftAnchorDef[]
  selected: SoftAnchorDef["key"] | null
  onSelect: (key: SoftAnchorDef["key"]) => void
  onExpand: () => void
}

// Soft mode's lightweight planning view: chips to choose which ONE of the 3
// categories to fill today, plus a single input for it. "+ Add more anchors
// today" hands off to the normal 3-card view (see home.tsx's softExpanded
// state) — soft mode proposes doing less, it never locks out the full ritual.
function SoftAnchorPicker({ defs, selected, onSelect, onExpand }: SoftAnchorPickerProps) {
  const { t } = useTranslation()
  const chosen = defs.find((d) => d.key === selected) ?? null

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-4">
        <div className="flex gap-2">
          {defs.map((d) => (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-medium transition-all duration-200 ${
                selected === d.key
                  ? "bg-primary text-primary-foreground shadow-md scale-105"
                  : "bg-muted text-foreground hover:bg-accent hover:scale-105"
              }`}
            >
              {d.icon} {d.title}
            </button>
          ))}
        </div>
        {chosen && (
          <Input
            value={chosen.task}
            onChange={(e) => chosen.onTaskChange(e.target.value)}
            placeholder={t("home.anchor_placeholder")}
            className="border-0 bg-muted/50 px-3 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onExpand}
          className="px-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          {t("soft_mode.add_more")}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ─── Tracking Card ─── */
interface TrackingAnchorCardProps {
  borderColor: string
  icon: string
  title: string
  subtitle: string
  task: string
  completed: boolean
  onCheckChange: (value: boolean) => void
  lockedAt: string | null
}

function TrackingAnchorCard({
  borderColor,
  icon,
  title,
  subtitle,
  task,
  completed,
  onCheckChange,
  lockedAt,
}: TrackingAnchorCardProps) {
  const { t } = useTranslation()
  const canCheck = canCheckAnchors(lockedAt)
  const timeLeft = getTimeUntilAnchorCheck(lockedAt)
  const [showNudge, setShowNudge] = useState(false)

  const handleCheck = (v: boolean) => {
    if (!canCheck) {
      setShowNudge(true)
      setTimeout(() => setShowNudge(false), 3000)
      return
    }
    onCheckChange(v)
    if (navigator.vibrate) navigator.vibrate(30)
  }

  return (
    <Card
      className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)] relative overflow-hidden"
      style={{
        borderLeft: `4px solid ${borderColor}`,
        backgroundColor: completed ? "var(--sage-light)" : undefined,
        opacity: !canCheck && !completed ? 0.85 : 1,
      }}
    >
      {!canCheck && !completed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] rounded-lg">
          <div className="rounded-full bg-secondary/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            ⏳ {t("timegate.time_left", { time: timeLeft })}
          </div>
        </div>
      )}

      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Checkbox
            checked={completed}
            onCheckedChange={(v) => handleCheck(v === true)}
            className="h-5 w-5 transition-all duration-200 data-[state=checked]:scale-110 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
          />
        </div>
        {task ? (
          <p className={`text-sm pl-1 ${completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {task}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic pl-1">{t("home.no_task_set")}</p>
        )}
      </CardContent>

      {showNudge && (
        <div className="absolute bottom-2 left-2 right-2 z-20 rounded-lg bg-peach/90 px-3 py-2 text-center text-xs font-medium text-foreground dark:text-background shadow-md animate-in fade-in slide-in-from-bottom-2">
          {t("timegate.anchor_wait")}
        </div>
      )}
    </Card>
  )
}