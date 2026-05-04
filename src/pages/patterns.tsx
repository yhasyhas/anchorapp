import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { generateInsights } from "@/lib/ai-insights"
import { moodToValue } from "@/lib/constants"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkles } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
import type { MoodLog, DailyAnchor } from "@/types"

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function PatternsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [chartData, setChartData] = useState<{ day: string; value: number }[]>([])
  const [insights, setInsights] = useState<{ text: string; category: string }[]>([])

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    if (!user) return

    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 6)
    const weekStr = weekAgo.toISOString().split("T")[0]

    const { data: moods } = await supabase
      .from("mood_logs")
      .select("*")
      .eq("user_id", user.id)
      .gte("date", weekStr)
      .order("date", { ascending: true })

    const { data: anchors } = await supabase
      .from("daily_anchors")
      .select("*")
      .eq("user_id", user.id)
      .gte("date", weekStr)
      .order("date", { ascending: true })

    if (moods && moods.length > 0) {
      const points = buildChartData(moods as MoodLog[])
      setChartData(points)
    }

    if (moods && anchors) {
      const generated = generateInsights(moods as MoodLog[], anchors as DailyAnchor[])
      setInsights(generated)
    }
  }

  function buildChartData(moods: MoodLog[]) {
    const today = new Date()
    const points: { day: string; value: number }[] = []

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split("T")[0]
      const mood = moods.find((m) => m.date === dateStr)
      points.push({
        day: dayLabels[d.getDay()],
        value: mood ? moodToValue[mood.mood] ?? 3 : 0,
      })
    }
    return points
  }

  const insightIcons = ["\u2600\uFE0F", "\u{1F4DE}", "\u{1F319}"]
  const hasData = chartData.some((d) => d.value > 0)

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="font-heading text-2xl font-bold">{t("patterns.title")}</h1>
      </div>

      {/* Mood Chart */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <p className="mb-4 text-sm font-medium text-muted-foreground">{t("patterns.this_week")}</p>
          {hasData ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#8A8A8A" }}
                />
                <YAxis
                  domain={[0, 5]}
                  hide
                />
                <Tooltip
                  formatter={(value) => {
                    const labels = ["", "Stressed", "Low", "Meh", "Okay", "Great"]
                    return [labels[value as number] ?? "", "Mood"]
                  }}
                  contentStyle={{
                    backgroundColor: "#FDFBF7",
                    border: "none",
                    borderRadius: "12px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#7A8B6E"
                  strokeWidth={2.5}
                  dot={{ fill: "#7A8B6E", r: 5 }}
                  activeDot={{ r: 7 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("patterns.no_data")}</p>
          )}
        </CardContent>
      </Card>

      {/* AI Insights */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t("patterns.insights")}</h2>
        {insights.length > 0 ? (
          insights.map((insight, i) => (
            <Card key={i} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="flex items-start gap-3 p-4">
                <span className="text-lg">{insightIcons[i % insightIcons.length]}</span>
                <p className="text-sm text-foreground/85">{insight.text}</p>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <p className="text-center text-sm text-muted-foreground">{t("patterns.empty")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
