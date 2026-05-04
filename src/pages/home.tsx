import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { addToSyncQueue, isOnline, setLocalData, getLocalData } from "@/lib/offline-sync"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Settings, Info, Heart } from "lucide-react"
import { moodConfig, intentions } from "@/lib/constants"
import type { DailyAnchor, MoodType } from "@/types"

function getGreetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "home.greeting"
  if (hour < 18) return "home.greeting_afternoon"
  return "home.greeting_evening"
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

export function HomePage() {
  const { t } = useTranslation()
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

  useEffect(() => {
    loadTodayData()
  }, [user])

  async function loadTodayData() {
    if (!user) return
    const localKey = `anchor_${user.id}_${todayStr()}`
    const cached = getLocalData<DailyAnchor>(localKey)

    if (isOnline()) {
      const { data } = await supabase
        .from("daily_anchors")
        .select("*")
        .eq("user_id", user.id)
        .eq("date", todayStr())
        .maybeSingle()

      if (data) {
        setAnchor(data)
        setLocalData(localKey, data)
      } else if (cached) {
        setAnchor(cached)
      }

      const { data: moodData } = await supabase
        .from("mood_logs")
        .select("mood")
        .eq("user_id", user.id)
        .eq("date", todayStr())
        .maybeSingle()

      if (moodData) setSelectedMood(moodData.mood as MoodType)
    } else if (cached) {
      setAnchor(cached)
    }
  }

  async function handleMoodSelect(mood: MoodType) {
    if (!user) return
    setSelectedMood(mood)

    const record = { user_id: user.id, date: todayStr(), mood }

    if (isOnline()) {
      await supabase.from("mood_logs").upsert(record, { onConflict: "user_id,date" })
    } else {
      addToSyncQueue({ table: "mood_logs", action: "upsert", data: record, conflictKey: "user_id,date" })
    }
  }

  async function saveAnchor(updates: Partial<DailyAnchor>) {
    if (!user) return
    const updated = { ...anchor, ...updates, user_id: user.id, date: todayStr() }
    setAnchor(updated)

    const localKey = `anchor_${user.id}_${todayStr()}`
    setLocalData(localKey, updated)

    const { id, created_at, ...record } = updated
    void id
    void created_at

    if (isOnline()) {
      await supabase.from("daily_anchors").upsert(record, { onConflict: "user_id,date" })
    } else {
      addToSyncQueue({ table: "daily_anchors", action: "upsert", data: record, conflictKey: "user_id,date" })
    }
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? ""

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {t(getGreetingKey())}{firstName ? `, ${firstName}` : ""} &#x1F33B;
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="text-muted-foreground">
            <Settings className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      {/* Mood Selector */}
      <div className="flex justify-between gap-2">
        {moodConfig.map(({ key, emoji, color }) => (
          <button
            key={key}
            onClick={() => handleMoodSelect(key)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl p-3 transition-all ${
              selectedMood === key
                ? "ring-2 ring-primary ring-offset-2 scale-105"
                : "hover:scale-102"
            }`}
            style={{ backgroundColor: color }}
          >
            <span className="text-2xl">{emoji}</span>
            <span className="text-xs font-medium text-foreground">{t(`mood.${key}`)}</span>
          </button>
        ))}
      </div>

      {/* Daily Intention */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <p className="mb-3 text-sm font-medium text-muted-foreground">{t("home.intention_label")}</p>
          <div className="flex flex-wrap gap-2">
            {intentions.map((intention) => (
              <button
                key={intention}
                onClick={() => saveAnchor({ daily_intention: intention })}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  anchor.daily_intention === intention
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground hover:bg-accent"
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
                <button className="text-muted-foreground"><Info className="h-4 w-4" /></button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">{t("home.why_three")}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Future Anchor */}
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

        {/* Mind/Body Anchor */}
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

        {/* Life Anchor */}
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
      <Card className="border-0 bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
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
      className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-colors"
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
            onCheckedChange={(v) => onCheckChange(v === true)}
            className="h-5 w-5"
          />
          <Input
            value={task}
            onChange={(e) => onTaskChange(e.target.value)}
            onBlur={() => onTaskChange(task)}
            placeholder="..."
            className="border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </CardContent>
    </Card>
  )
}
