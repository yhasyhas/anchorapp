import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { fetchInsightsWithFallback } from "@/lib/ai-service"
import { moodToValue } from "@/lib/constants"
import { localDateStr } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, Brain, Loader2 } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "sonner"
import type { MoodLog, DailyAnchor, CheckIn } from "@/types"

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

const moodColors: Record<string, string> = {
  great: "var(--peach)",
  okay: "var(--sage-light)",
  meh: "var(--lavender)",
  low: "var(--rose-accent)",
  stressed: "var(--mood-stressed)",
}

interface InsightItem {
  text: string
  category: string
  source: "local" | "ai" | "cached_ai"
}

export function PatternsPage() {
  const { t } = useTranslation()
  const { user, profile } = useAuth()
  const [chartData, setChartData] = useState<{ day: string; value: number; mood: string | null }[]>([])
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAi, setLoadingAi] = useState(false)
  const [source, setSource] = useState<"local" | "ai" | "cached_ai">("local")
  const aiEnabled = profile?.ai_enabled ?? false

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData(forceAi = false) {
    if (!user) return
    setLoading(true)

    try {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 6)
      const weekStr = localDateStr(weekAgo)

      const thirtyAgo = new Date()
      thirtyAgo.setDate(thirtyAgo.getDate() - 30)
      const thirtyStr = localDateStr(thirtyAgo)

      const [{ data: weekMoods }, { data: monthMoods }, { data: anchors }, { data: checkIns }] = await Promise.all([
        supabase
          .from("mood_logs")
          .select("*")
          .eq("user_id", user.id)
          .gte("date", weekStr)
          .order("date", { ascending: true }),
        supabase
          .from("mood_logs")
          .select("*")
          .eq("user_id", user.id)
          .gte("date", thirtyStr)
          .order("date", { ascending: true }),
        supabase
          .from("daily_anchors")
          .select("*")
          .eq("user_id", user.id)
          .gte("date", thirtyStr)
          .order("date", { ascending: true }),
        supabase
          .from("check_ins")
          .select("*")
          .eq("user_id", user.id)
          .gte("date", thirtyStr)
          .order("date", { ascending: true }),
      ])

      if (weekMoods && weekMoods.length > 0) {
        setChartData(buildChartData(weekMoods as MoodLog[]))
      }

      if (monthMoods && anchors) {
        const result = await fetchInsightsWithFallback(
          user.id,
          aiEnabled,
          profile?.ai_checkins_enabled ?? false,
          monthMoods as MoodLog[],
          anchors as DailyAnchor[],
          (checkIns as CheckIn[]) || undefined,
          forceAi
        )
        setInsights(result.insights)
        setSource(result.source)
      }
    } catch (err: any) {
      console.error("Failed to load patterns:", err)
      toast.error(t("patterns.error_load"))
    } finally {
      setLoading(false)
    }
  }

  async function handleDeepInsights() {
    setLoadingAi(true)
    try {
      await loadData(true)
    } catch (err: any) {
      console.error("Deep insights failed:", err)
      toast.error(t("patterns.error_ai"))
    } finally {
      setLoadingAi(false)
    }
  }

  function buildChartData(moods: MoodLog[]) {
    const today = new Date()
    const points: { day: string; value: number; mood: string | null }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = localDateStr(d)
      const mood = moods.find((m) => m.date === dateStr)
      points.push({
        day: t(`patterns.days.${dayKeys[d.getDay()]}`),
        value: mood ? moodToValue[mood.mood] ?? 3 : 0,
        mood: mood ? mood.mood : null,
      })
    }
    return points
  }

  const insightIcons: Record<string, string> = {
    mood_action_correlation: "\u2600\uFE0F",
    pattern: "\u{1F319}",
    suggestion: "\u{1F33F}",
  }

  const hasData = chartData.some((d) => d.value > 0)

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("patterns.title")}</h1>
        </div>
        {source === "ai" && (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{t("patterns.ai_badge")}</span>
        )}
      </div>

      {/* Mood Chart */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <p className="mb-4 text-sm font-medium text-muted-foreground">{t("patterns.this_week")}</p>
          {hasData ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                <YAxis domain={[0, 5]} hide />
                <Tooltip
                  formatter={(_value, _name, props: any) => {
                    const moodKey = props?.payload?.mood
                    const label = moodKey ? t(`mood.${moodKey}`) : ""
                    return [label, t("patterns.mood_label")]
                  }}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "none",
                    borderRadius: "12px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                  }}
                  labelStyle={{ color: "var(--card-foreground)" }}
                  itemStyle={{ color: "var(--card-foreground)" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props
                    const color = payload.mood ? moodColors[payload.mood] : "var(--border)"
                    return <circle cx={cx} cy={cy} r={5} fill={color} stroke="var(--card)" strokeWidth={2} />
                  }}
                  activeDot={{ r: 7, fill: "var(--chart-1)" }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon="moon" titleKey="patterns.empty" />
          )}
        </CardContent>
      </Card>

      {/* AI Insights Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">{t("patterns.insights")}</h2>
        {aiEnabled && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeepInsights}
            disabled={loadingAi}
            className="gap-1.5 text-primary hover:bg-primary/5"
          >
            {loadingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {loadingAi ? t("patterns.analyzing") : t("patterns.deep_insights")}
          </Button>
        )}
      </div>
      {!aiEnabled && (
        <p className="-mt-4 text-xs text-muted-foreground">{t("patterns.ai_disabled")}</p>
      )}

      {/* Insights List */}
      <div className="space-y-3">
        {loading && !insights.length ? (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("patterns.loading")}</span>
              </div>
            </CardContent>
          </Card>
        ) : insights.length > 0 ? (
          insights.map((insight, i) => (
            <Card
              key={`${insight.source}-${i}`}
              className={`border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)] ${
                insight.source === "ai" || insight.source === "cached_ai"
                  ? "bg-gradient-to-r from-lavender/20 to-transparent"
                  : ""
              }`}
            >
              <CardContent className="flex items-start gap-3 p-4">
                <span className="text-lg">{insightIcons[insight.category] || "\u2728"}</span>
                <div className="flex-1">
                  <p className="text-sm text-foreground/85 leading-relaxed">{insight.text}</p>
                  {insight.source === "ai" && (
                    <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {t("patterns.ai_badge")}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <EmptyState icon="seedling" titleKey="patterns.empty" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}