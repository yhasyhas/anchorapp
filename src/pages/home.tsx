import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { generateCompanionMessage } from "@/lib/ai-service"
import { calculateStreaks, reachedAnchorMilestone, MIN_STREAK_FOR_INTENTION, type StreakData } from "@/lib/streaks"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Settings, Info, Heart, Flame, Anchor as AnchorIcon, Sparkles, Lock, Pencil, Sun, Moon } from "lucide-react"
import { toast } from "sonner"
import { moodConfig, intentions } from "@/lib/constants"
import { todayStr, localDateStr, canCheckAnchors, getTimeUntilAnchorCheck } from "@/lib/utils"
import type { DailyAnchor, MoodType, CheckIn, MoodLog } from "@/types"
import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { MorningRitual } from "@/components/anchor/morning-ritual"
import { ConfettiBurst } from "@/components/anchor/confetti"
import { GentleNudgeModal } from "@/components/anchor/gentle-nudge-modal"
import { PushNudge } from "@/components/anchor/push-nudge"
import { JournalCard } from "@/components/anchor/journal-card"
import { StreakMilestoneModal } from "@/components/anchor/streak-milestone-modal"

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
  const { user, profile } = useAuth()
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
    created_at: "",
  })

  const [dayMode, setDayMode] = useState<"planning" | "tracking">("planning")
  const [recentMoods, setRecentMoods] = useState<MoodLog[]>([])
  const [recentAnchors, setRecentAnchors] = useState<DailyAnchor[]>([])

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

      const [{ data: monthMoods }, { data: monthAnchors }] = await Promise.all([
        supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", since),
        supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", since),
      ])

      const moods = (monthMoods || []) as MoodLog[]
      const anchors = (monthAnchors || []) as DailyAnchor[]

      setRecentMoods(moods)
      setRecentAnchors(anchors)
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

      const msg = await generateCompanionMessage(
        profile?.ai_enabled ?? false,
        yCheckIn as CheckIn | null,
        yMood as MoodLog | null,
        todayAnchor?.daily_intention ?? "",
        i18n.language as "en" | "sw"
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
  }

  async function saveAnchor(updates: Partial<DailyAnchor>) {
    if (!user) return
    const finalUpdates = { ...updates }

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

  const moodDone = selectedMood !== null
  const anchorsDone = allAnchorsDone
  const cycleComplete = moodDone && anchorsDone && checkInDone

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

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {t(getGreetingKey())}{firstName ? `, ${firstName}` : ""} &#x1F33B;
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-5 w-5" />
          </Button>
        </Link>
      </div>

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
            <h2 className="font-heading text-lg font-semibold">{t("home.anchors_title")} &#x2693;</h2>
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
            <TrackingAnchorCard
              borderColor="var(--sage)"
              icon="&#x1F331;"
              title={t("anchors.future")}
              subtitle={t("anchors.future_sub")}
              task={anchor.future_task}
              completed={anchor.future_completed}
              onCheckChange={(v) => saveAnchor({ future_completed: v })}
              lockedAt={anchor.anchors_locked_at}
            />
            <TrackingAnchorCard
              borderColor="var(--rose-accent)"
              icon="&#x1F9E0;"
              title={t("anchors.mindbody")}
              subtitle={t("anchors.mindbody_sub")}
              task={anchor.mindbody_task}
              completed={anchor.mindbody_completed}
              onCheckChange={(v) => saveAnchor({ mindbody_completed: v })}
              lockedAt={anchor.anchors_locked_at}
            />
            <TrackingAnchorCard
              borderColor="var(--lavender)"
              icon="&#x1F30D;"
              title={t("anchors.life")}
              subtitle={t("anchors.life_sub")}
              task={anchor.life_task}
              completed={anchor.life_completed}
              onCheckChange={(v) => saveAnchor({ life_completed: v })}
              lockedAt={anchor.anchors_locked_at}
            />

            {allAnchorsDone && (
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