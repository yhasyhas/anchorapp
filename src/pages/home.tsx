import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { generateCompanionMessage } from "@/lib/ai-service"
import { calculateStreaks, type StreakData } from "@/lib/streaks"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Settings, Info, Heart, Flame, Anchor as AnchorIcon, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { moodConfig, intentions } from "@/lib/constants"
import type { DailyAnchor, MoodType, CheckIn, MoodLog } from "@/types"
import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { MorningRitual } from "@/components/anchor/morning-ritual"
import { ConfettiBurst } from "@/components/anchor/confetti"

function getGreetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "home.greeting"
  if (hour < 18) return "home.greeting_afternoon"
  return "home.greeting_evening"
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split("T")[0]
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
    created_at: "",
  })

  // ─── Contexte 30 jours pour recalcul instantané ───
  const [recentMoods, setRecentMoods] = useState<MoodLog[]>([])
  const [recentAnchors, setRecentAnchors] = useState<DailyAnchor[]>([])

  // ─── Phase 4 States ───
  const [streaks, setStreaks] = useState<StreakData>({
    currentMoodStreak: 0,
    currentAnchorStreak: 0,
    bestMoodStreak: 0,
    bestAnchorStreak: 0,
  })
  const [companionMsg, setCompanionMsg] = useState<string>("")
  const [loadingCompanion, setLoadingCompanion] = useState(true)
  const [showConfetti, setShowConfetti] = useState(false)

  useEffect(() => {
    loadTodayData()
    loadContextData()
  }, [user])

  // 🎉 Confetti trigger quand les 3 ancres sont cochées
  useEffect(() => {
    if (anchor.future_completed && anchor.mindbody_completed && anchor.life_completed) {
      const celebratedKey = `anchor_celebrated_${todayStr()}`
      if (!localStorage.getItem(celebratedKey)) {
        setShowConfetti(true)
        localStorage.setItem(celebratedKey, "true")
        setTimeout(() => setShowConfetti(false), 2000)
      }
    }
  }, [anchor.future_completed, anchor.mindbody_completed, anchor.life_completed])

  async function loadTodayData() {
    if (!user) return
    try {
      const localKey = `anchor_${user.id}_${todayStr()}`
      const cached = getLocalData<DailyAnchor>(localKey)

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
        } else if (cached) {
          setAnchor(cached)
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
      }
    } catch (err: any) {
      console.error("Failed to load today's data:", err)
      toast.error("Could not load your daily data")
    }
  }

  async function loadContextData() {
    if (!user) return

    try {
      const thirtyAgo = new Date()
      thirtyAgo.setDate(thirtyAgo.getDate() - 30)
      const since = thirtyAgo.toISOString().split("T")[0]

      const [{ data: monthMoods }, { data: monthAnchors }] = await Promise.all([
        supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", since),
        supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", since),
      ])

      const moods = (monthMoods || []) as MoodLog[]
      const anchors = (monthAnchors || []) as DailyAnchor[]

      setRecentMoods(moods)
      setRecentAnchors(anchors)
      setStreaks(calculateStreaks(moods, anchors))

      const [{ data: yCheckIn }, { data: yMood }] = await Promise.all([
        supabase
          .from("check_ins")
          .select("what_matters, what_felt_real")
          .eq("user_id", user.id)
          .eq("date", yesterdayStr())
          .maybeSingle(),
        supabase
          .from("mood_logs")
          .select("mood")
          .eq("user_id", user.id)
          .eq("date", yesterdayStr())
          .maybeSingle(),
      ])

      const msg = await generateCompanionMessage(
        yCheckIn as CheckIn | null,
        yMood as MoodLog | null,
        anchor.daily_intention,
        i18n.language as "en" | "sw"
      )
      setCompanionMsg(msg)
    } catch (err: any) {
      console.error("Failed to load context:", err)
      setCompanionMsg(
        i18n.language === "sw"
          ? "Habari za asubuhi — weka nia moja ya upole kwa leo."
          : "Good morning — set one gentle intention for today."
      )
    } finally {
      setLoadingCompanion(false)
    }
  }

  // 🔄 Recalcule les streaks à partir du contexte local
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

    // 🔥 Mise à jour optimiste du contexte local
    const updatedMoods = recentMoods.filter((m) => m.date !== todayStr())
    updatedMoods.push(record as MoodLog)
    setRecentMoods(updatedMoods)
    refreshStreaks(updatedMoods, undefined)

    try {
      if (isOnline()) {
        const { error } = await supabase.from("mood_logs").upsert(record, { onConflict: "user_id,date" })
        if (error) throw error
      } else {
        addToSyncQueue({ table: "mood_logs", action: "upsert", data: record, conflictKey: "user_id,date" })
      }
    } catch (err: any) {
      console.error("Failed to save mood:", err)
      toast.error("Could not save your mood")
    }
  }

  async function saveAnchor(updates: Partial<DailyAnchor>) {
    if (!user) return
    const updated = { ...anchor, ...updates, user_id: user.id, date: todayStr() }
    setAnchor(updated)

    const localKey = `anchor_${user.id}_${todayStr()}`
    setLocalData(localKey, updated)

    // 🔥 Mise à jour optimiste du contexte local pour streaks instantanés
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
        addToSyncQueue({ table: "daily_anchors", action: "upsert", data: record, conflictKey: "user_id,date" })
      }
    } catch (err: any) {
      console.error("Failed to save anchor:", err)
    }
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? ""

  const allAnchorsDone = anchor.future_completed && anchor.mindbody_completed && anchor.life_completed

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <ConfettiBurst active={showConfetti} />
      <OnboardingModal />
      <MorningRitual onComplete={() => {}} />

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

      {/* 🤖 Companion Card */}
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

      {/* 🔥 Streaks Bar */}
      <div className="flex gap-3">
        <Card className={`flex-1 border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] ${streaks.currentMoodStreak > 0 ? "bg-peach/30" : "bg-muted/30"}`}>
          <CardContent className="flex items-center gap-2 p-3">
            <Flame className={`h-4 w-4 ${streaks.currentMoodStreak > 0 ? "text-peach" : "text-muted-foreground"}`} />
            <div>
              <p className="text-xs text-muted-foreground">{t("streaks.mood")}</p>
              <p className="text-sm font-semibold text-foreground">
                {streaks.currentMoodStreak > 0 ? `${streaks.currentMoodStreak} 🔥` : "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className={`flex-1 border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] ${allAnchorsDone ? "bg-sage-light/60" : "bg-muted/30"}`}>
          <CardContent className="flex items-center gap-2 p-3">
            <AnchorIcon className={`h-4 w-4 ${allAnchorsDone ? "text-primary" : "text-muted-foreground"}`} />
            <div>
              <p className="text-xs text-muted-foreground">{t("streaks.anchors")}</p>
              <p className="text-sm font-semibold text-foreground">
                {streaks.currentAnchorStreak > 0 ? `${streaks.currentAnchorStreak} ⚓` : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
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
                {intention}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 3 Anchors */}
      <div className="space-y-4">
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

        <AnchorCard
          borderColor="#7A8B6E"
          icon="&#x1F331;"
          title={t("anchors.future")}
          subtitle={t("anchors.future_sub")}
          task={anchor.future_task}
          completed={anchor.future_completed}
          onTaskChange={(v) => saveAnchor({ future_task: v })}
          onCheckChange={(v) => saveAnchor({ future_completed: v })}
        />

        <AnchorCard
          borderColor="#E8C4C4"
          icon="&#x1F9E0;"
          title={t("anchors.mindbody")}
          subtitle={t("anchors.mindbody_sub")}
          task={anchor.mindbody_task}
          completed={anchor.mindbody_completed}
          onTaskChange={(v) => saveAnchor({ mindbody_task: v })}
          onCheckChange={(v) => saveAnchor({ mindbody_completed: v })}
        />

        <AnchorCard
          borderColor="#D4C5E8"
          icon="&#x1F30D;"
          title={t("anchors.life")}
          subtitle={t("anchors.life_sub")}
          task={anchor.life_task}
          completed={anchor.life_completed}
          onTaskChange={(v) => saveAnchor({ life_task: v })}
          onCheckChange={(v) => saveAnchor({ life_completed: v })}
        />
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
    </div>
  )
}

interface AnchorCardProps {
  borderColor: string
  icon: string
  title: string
  subtitle: string
  task: string
  completed: boolean
  onTaskChange: (value: string) => void
  onCheckChange: (value: boolean) => void
}

function AnchorCard({
  borderColor,
  icon,
  title,
  subtitle,
  task,
  completed,
  onTaskChange,
  onCheckChange,
}: AnchorCardProps) {
  return (
    <Card
      className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]"
      style={{
        borderLeft: `4px solid ${borderColor}`,
        backgroundColor: completed ? "var(--sage-light)" : undefined,
      }}
    >
      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            checked={completed}
            onCheckedChange={(v) => {
              onCheckChange(v === true)
              if (navigator.vibrate) navigator.vibrate(30)
            }}
            className="h-5 w-5 transition-all duration-200 data-[state=checked]:scale-110 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
          />
          <Input
            value={task}
            onChange={(e) => onTaskChange(e.target.value)}
            onBlur={() => onTaskChange(task)}
            placeholder="..."
            className="border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 transition-colors"
          />
        </div>
      </CardContent>
    </Card>
  )
}