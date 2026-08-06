import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { generateCompanionMessage } from "@/lib/ai-service"
import { calculateStreaks, reachedAnchorMilestone, type StreakData } from "@/lib/streaks"
import { getUserLocalData, setUserLocalData, removeUserLocalData } from "@/lib/user-storage"
import { todayStr, localDateStr } from "@/lib/utils"
import { FIRST_INTENTION_KEY_BASE } from "@/lib/constants"
import { getAllGratitudesForReveal, isSecondConsecutiveLowMoodDay } from "@/lib/gratitude"
import { isDailyFlagSet, setDailyFlag, DAILY_FLAGS } from "@/lib/local-flags"
import type { DailyAnchor, MoodType, CheckIn, MoodLog, MoveSuggestion, Gratitude, Profile } from "@/types"

const ANCHOR_MILESTONES_CELEBRATED_KEY = "anchor_streak_milestones_celebrated"

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateStr(d) // ← date locale, pas UTC (setDate() local + toISOString() UTC créaient un décalage)
}

function getDayModeKey(userId: string): string {
  return `anchor_day_mode_${userId}_${todayStr()}`
}

function getMoveSuggestionsCacheKey(userId: string): string {
  return `anchor_move_suggestions_${userId}`
}

export interface UseDailyCycleResult {
  anchor: DailyAnchor
  dayMode: "planning" | "tracking"
  selectedMood: MoodType | null
  recentMoods: MoodLog[]
  recentAnchors: DailyAnchor[]
  recentCheckInMoods: { date: string; evening_mood: string | null }[]
  moveSuggestions: MoveSuggestion[]
  streaks: StreakData
  companionMsg: string
  loadingCompanion: boolean
  checkInDone: boolean
  showConfetti: boolean
  streakMilestone: number | null
  dismissStreakMilestone: () => void
  nudgeOpen: boolean
  nudgeType: "mood" | "intention"
  dismissNudgeModal: () => void
  handleNudgeChoose: () => void
  handleNudgeContinue: () => void
  jarModalOpen: boolean
  jarGratitudes: Gratitude[]
  closeJarModal: () => void
  handleMoodSelect: (mood: MoodType) => Promise<void>
  saveAnchor: (updates: Partial<DailyAnchor>) => Promise<void>
  attemptLockDay: () => void
  unlockDay: () => void
}

// Extracted from src/pages/home.tsx: today's anchor/mood record, the rolling
// 30-day window it's loaded alongside (moods/anchors/check-ins/move
// suggestions — one round trip), the morning companion message, and the
// full lock/unlock lifecycle (planning -> mood+intention nudge -> tracking).
// Soft Mode's own trigger checks and state live in useSoftMode and are only
// *called* from here, at the same two points they always ran (a mood gets
// logged; the rolling window loads) — this hook owns the daily-cycle data
// and actions, not Soft Mode itself.
export function useDailyCycle(
  user: User | null,
  profile: Profile | null,
  softModeActive: boolean,
  checkSoftEnterTrigger: (mood: MoodType, recentMoods: MoodLog[]) => void,
  checkSoftExitTrigger: (recentMoods: MoodLog[]) => void
): UseDailyCycleResult {
  const { t, i18n } = useTranslation()

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
  const [checkInDone, setCheckInDone] = useState(false)

  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [nudgeType, setNudgeType] = useState<"mood" | "intention">("mood")
  const [pendingLock, setPendingLock] = useState(false)

  const [jarModalOpen, setJarModalOpen] = useState(false)
  const [jarGratitudes, setJarGratitudes] = useState<Gratitude[]>([])

  useEffect(() => {
    if (user) {
      // loadContextData a besoin de daily_intention pour personnaliser le message du
      // companion — on chaîne explicitement plutôt que de compter sur le state React
      // (loadTodayData() est async et setAnchor() n'aurait pas encore appliqué sa mise à
      // jour au moment où loadContextData lirait la valeur via une closure sur `anchor`).
      loadTodayData().then((todayAnchor) => loadContextData(todayAnchor))
      loadMoveSuggestions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (dayMode === "tracking" && anchor.future_completed && anchor.mindbody_completed && anchor.life_completed) {
      if (!isDailyFlagSet(DAILY_FLAGS.anchorsCelebrated, user?.id, todayStr())) {
        setShowConfetti(true)
        setDailyFlag(DAILY_FLAGS.anchorsCelebrated, user?.id, todayStr())
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

  // Isolated from loadContextData's own try/catch (and its all-or-nothing
  // Promise.all) so a network failure here can fall back to the last cached
  // batch (read cache, same setLocalData/getLocalData pattern as today's
  // anchor row) without also silently emptying moods/anchors/streaks —
  // see Point 2's "offline, cached moves are still offered" requirement.
  async function loadMoveSuggestions() {
    if (!user) return
    const cacheKey = getMoveSuggestionsCacheKey(user.id)
    try {
      if (isOnline()) {
        const { data, error } = await supabase.from("move_suggestions").select("*").eq("user_id", user.id)
        if (error) throw error
        const rows = (data as MoveSuggestion[]) || []
        setMoveSuggestions(rows)
        setLocalData(cacheKey, rows)
      } else {
        setMoveSuggestions(getLocalData<MoveSuggestion[]>(cacheKey) || [])
      }
    } catch (err) {
      console.error("Failed to load move suggestions:", err)
      setMoveSuggestions(getLocalData<MoveSuggestion[]>(cacheKey) || [])
    }
  }

  async function loadContextData(todayAnchor?: DailyAnchor) {
    if (!user) return
    try {
      const thirtyAgo = new Date()
      thirtyAgo.setDate(thirtyAgo.getDate() - 30)
      const since = localDateStr(thirtyAgo)

      const [{ data: monthMoods }, { data: monthAnchors }, { data: monthCheckIns }] = await Promise.all([
        supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", since),
        supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", since),
        supabase.from("check_ins").select("date, evening_mood").eq("user_id", user.id).gte("date", since),
      ])

      const moods = (monthMoods || []) as MoodLog[]
      const anchors = (monthAnchors || []) as DailyAnchor[]

      setRecentMoods(moods)
      setRecentAnchors(anchors)

      // Exit proposal: evaluated each morning, before today's mood is
      // necessarily logged — 2 lighter days in a row while soft mode is
      // already active. Same daily-dismissal pattern as the jar prompt.
      checkSoftExitTrigger(moods)
      setRecentCheckInMoods((monthCheckIns as { date: string; evening_mood: string | null }[]) || [])
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

  async function openJarPrompt() {
    try {
      const all = await getAllGratitudesForReveal()
      setJarGratitudes(all)
      setJarModalOpen(true)
    } catch (err) {
      console.error("Failed to load jar for reveal:", err)
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
    checkSoftEnterTrigger(mood, recentMoods)

    // Gratitude jar reveal offer — never automatic (see JarOpeningModal),
    // just the trigger check: today's mood is the 2nd consecutive
    // low/stressed day, and she hasn't already been offered today.
    if (isSecondConsecutiveLowMoodDay(mood, recentMoods)) {
      if (!isDailyFlagSet(DAILY_FLAGS.jarPromptShown, user.id, todayStr())) {
        setDailyFlag(DAILY_FLAGS.jarPromptShown, user.id, todayStr())
        openJarPrompt()
      }
    }
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

  return {
    anchor,
    dayMode,
    selectedMood,
    recentMoods,
    recentAnchors,
    recentCheckInMoods,
    moveSuggestions,
    streaks,
    companionMsg,
    loadingCompanion,
    checkInDone,
    showConfetti,
    streakMilestone,
    dismissStreakMilestone: () => setStreakMilestone(null),
    nudgeOpen,
    nudgeType,
    dismissNudgeModal: () => setNudgeOpen(false),
    handleNudgeChoose,
    handleNudgeContinue,
    jarModalOpen,
    jarGratitudes,
    closeJarModal: () => setJarModalOpen(false),
    handleMoodSelect,
    saveAnchor,
    attemptLockDay,
    unlockDay,
  }
}
