import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { fetchInsightsWithFallback } from "@/lib/ai-service"
import { moodToValue } from "@/lib/constants"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, Brain, Loader2 } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
import { EmptyState } from "@/components/ui/empty-state"
import type { MoodLog, DailyAnchor, CheckIn } from "@/types"

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const moodColors: Record<string, string> = {
  great: "#F5D5C5",
  okay: "#E8EDE5",
  meh: "#D4C5E8",
  low: "#E8C4C4",
  stressed: "#F5D5D5",
}

interface InsightItem {
  text: string
  category: string
  source: "local" | "ai" | "cached_ai"
}

export function PatternsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [chartData, setChartData] = useState<{ day: string; value: number; mood: string | null }[]>([])
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAi, setLoadingAi] = useState(false)
  const [source, setSource] = useState<"local" | "ai" | "cached_ai">("local")

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData(forceAi = false) {
    if (!user) return
    setLoading(true)

    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 6)
    const weekStr = weekAgo.toISOString().split("T")[0]

    const thirtyAgo = new Date()
    thirtyAgo.setDate(thirtyAgo.getDate() - 30)
    const thirtyStr = thirtyAgo.toISOString().split("T")[0]

    // Récupérer données
    const [{ data: weekMoods }, { data: monthMoods }, { data: anchors }, { data: checkIns }] = await Promise.all([
      supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", weekStr).order("date", { ascending: true }),
      supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", thirtyStr).order("date", { ascending: true }),
      supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", thirtyStr).order("date", { ascending: true }),
      supabase.from("check_ins").select("*").eq("user_id", user.id).gte("date", thirtyStr).order("date", { ascending: true }),
    ])

    // Chart (7 derniers jours)
    if (weekMoods && weekMoods.length > 0) {
      setChartData(buildChartData(weekMoods as MoodLog[]))
    }

    // Insights
    if (monthMoods && anchors) {
      const result = await fetchInsightsWithFallback(
        monthMoods as MoodLog[],
        anchors as DailyAnchor[],
        (checkIns as CheckIn[]) || undefined,
        forceAi
      )
      setInsights(result.insights)
      setSource(result.source)
    }

    setLoading(false)
  }

  async function handleDeepInsights() {
    setLoadingAi(true)
    await loadData(true)
    setLoadingAi(false)
  }

  function buildChartData(moods: MoodLog[]) {
    const today = new Date()
    const points: { day: string; value: number; mood: string | null }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split("T")[0]
      const mood = moods.find((m) => m.date === dateStr)
      points.push({
        day: dayLabels[d.getDay()],
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
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            AI
          </span>
        )}
      </div>

      {/* Mood Chart */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <p className="mb-4 text-sm font-medium text-muted-foreground">{t("patterns.this_week")}</p>
          {hasData ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#8A8A8A" }} />
                <YAxis domain={[0, 5]} hide />
                <Tooltip
                  formatter={(value, _name, props: any) => {
                    const labels = ["", "Stressed", "Low", "Meh", "Okay", "Great"]
                    const moodKey = props?.payload?.mood
                    const label = moodKey ? moodKey.charAt(0).toUpperCase() + moodKey.slice(1) : labels[value as number]
                    return [label, "Mood"]
                  }}
                  contentStyle={{ backgroundColor: "#FDFBF7", border: "none", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#7A8B6E"
                  strokeWidth={2.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props
                    const color = payload.mood ? moodColors[payload.mood] : "#E8E4DC"
                    return <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />
                  }}
                  activeDot={{ r: 7, fill: "#7A8B6E" }}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDeepInsights}
          disabled={loadingAi}
          className="gap-1.5 text-primary hover:bg-primary/5"
        >
          {loadingAi ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          {loadingAi ? t("patterns.analyzing") : t("patterns.deep_insights")}
        </Button>
      </div>

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
                      AI
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

// import { useEffect, useState } from "react"
// import { useTranslation } from "react-i18next"
// import { useAuth } from "@/lib/auth-context"
// import { supabase } from "@/lib/supabase"
// import { generateInsights } from "@/lib/ai-insights"
// import { moodToValue } from "@/lib/constants"
// import { Card, CardContent } from "@/components/ui/card"
// import { Sparkles } from "lucide-react"
// import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
// import type { MoodLog, DailyAnchor, MoodType } from "@/types"
// import { EmptyState } from "@/components/ui/empty-state"

// const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// const moodColors: Record<string, string> = {
//   great: "#F5D5C5",
//   okay: "#E8EDE5",
//   meh: "#D4C5E8",
//   low: "#E8C4C4",
//   stressed: "#F5D5D5",
// }

// export function PatternsPage() {
//   const { t } = useTranslation()
//   const { user } = useAuth()
//   const [chartData, setChartData] = useState<{ day: string; value: number; mood: MoodType | null }[]>([])
//   const [insights, setInsights] = useState<{ text: string; category: string }[]>([])

//   useEffect(() => {
//     if (user) loadData()
//   }, [user])

//   async function loadData() {
//     if (!user) return

//     const weekAgo = new Date()
//     weekAgo.setDate(weekAgo.getDate() - 6)
//     const weekStr = weekAgo.toISOString().split("T")[0]

//     const { data: moods } = await supabase
//       .from("mood_logs")
//       .select("*")
//       .eq("user_id", user.id)
//       .gte("date", weekStr)
//       .order("date", { ascending: true })

//     const { data: anchors } = await supabase
//       .from("daily_anchors")
//       .select("*")
//       .eq("user_id", user.id)
//       .gte("date", weekStr)
//       .order("date", { ascending: true })

//     if (moods && moods.length > 0) {
//       const points = buildChartData(moods as MoodLog[])
//       setChartData(points)
//     }

//     if (moods && anchors) {
//       const generated = generateInsights(moods as MoodLog[], anchors as DailyAnchor[])
//       setInsights(generated)
//     }
//   }

//   function buildChartData(moods: MoodLog[]) {
//     const today = new Date()
//     const points: { day: string; value: number; mood: MoodType | null }[] = []

//     for (let i = 6; i >= 0; i--) {
//       const d = new Date(today)
//       d.setDate(d.getDate() - i)
//       const dateStr = d.toISOString().split("T")[0]
//       const mood = moods.find((m) => m.date === dateStr)
//       points.push({
//         day: dayLabels[d.getDay()],
//         value: mood ? moodToValue[mood.mood] ?? 3 : 0,
//         mood: mood ? mood.mood : null,
//       })
//     }
//     return points
//   }

//   const insightIcons = ["\u2600\uFE0F", "\u{1F4DE}", "\u{1F319}"]
//   const hasData = chartData.some((d) => d.value > 0)

//   return (
//     <div className="mx-auto max-w-lg space-y-6">
//       <div className="flex items-center gap-2">
//         <Sparkles className="h-5 w-5 text-primary" />
//         <h1 className="font-heading text-2xl font-bold">{t("patterns.title")}</h1>
//       </div>

//       {/* Mood Chart */}
//       <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//         <CardContent className="p-5">
//           <p className="mb-4 text-sm font-medium text-muted-foreground">{t("patterns.this_week")}</p>
//           {hasData ? (
//             <ResponsiveContainer width="100%" height={180}>
//               <LineChart data={chartData}>
//                 <XAxis
//                   dataKey="day"
//                   axisLine={false}
//                   tickLine={false}
//                   tick={{ fontSize: 12, fill: "#8A8A8A" }}
//                 />
//                 <YAxis
//                   domain={[0, 5]}
//                   hide
//                 />
//                 <Tooltip
//                   formatter={(value, _name, props: any) => {
//                     const labels = ["", "Stressed", "Low", "Meh", "Okay", "Great"]
//                     const moodKey = props?.payload?.mood
//                     const label = moodKey ? moodKey.charAt(0).toUpperCase() + moodKey.slice(1) : labels[value as number]
//                     return [label, "Mood"]
//                   }}
//                   contentStyle={{
//                     backgroundColor: "#FDFBF7",
//                     border: "none",
//                     borderRadius: "12px",
//                     boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
//                   }}
//                 />
//                 <Line
//                   type="monotone"
//                   dataKey="value"
//                   stroke="#7A8B6E"
//                   strokeWidth={2.5}
//                   dot={(props: any) => {
//                     const { cx, cy, payload } = props
//                     const color = payload.mood ? moodColors[payload.mood] : "#E8E4DC"
//                     return (
//                       <circle
//                         cx={cx}
//                         cy={cy}
//                         r={5}
//                         fill={color}
//                         stroke="#fff"
//                         strokeWidth={2}
//                       />
//                     )
//                   }}
//                   activeDot={{ r: 7, fill: "#7A8B6E" }}
//                   connectNulls={false}
//                 />
//               </LineChart>
//             </ResponsiveContainer>
//           ) : (
//             // <p className="py-8 text-center text-sm text-muted-foreground">{t("patterns.no_data")}</p>
//             <EmptyState
//               icon="moon"
//               titleKey="patterns.empty"
//             />
//           )}
//         </CardContent>
//       </Card>

//       {/* AI Insights */}
//       <div className="space-y-3">
//         <h2 className="font-heading text-lg font-semibold">{t("patterns.insights")}</h2>
//         {insights.length > 0 ? (
//           insights.map((insight, i) => (
//             <Card key={i} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//               <CardContent className="flex items-start gap-3 p-4">
//                 <span className="text-lg">{insightIcons[i % insightIcons.length]}</span>
//                 <p className="text-sm text-foreground/85">{insight.text}</p>
//               </CardContent>
//             </Card>
//           ))
//         ) : (
//           <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//             <CardContent className="p-5">
//               <p className="text-center text-sm text-muted-foreground">{t("patterns.empty")}</p>
//             </CardContent>
//           </Card>
//         )}
//       </div>
//     </div>
//   )
// }

// import { useEffect, useState } from "react"
// import { useTranslation } from "react-i18next"
// import { useAuth } from "@/lib/auth-context"
// import { supabase } from "@/lib/supabase"
// import { generateInsights } from "@/lib/ai-insights"
// import { moodToValue } from "@/lib/constants"
// import { Card, CardContent } from "@/components/ui/card"
// import { Sparkles } from "lucide-react"
// import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
// import type { MoodLog, DailyAnchor } from "@/types"

// const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// export function PatternsPage() {
//   const { t } = useTranslation()
//   const { user } = useAuth()
//   const [chartData, setChartData] = useState<{ day: string; value: number }[]>([])
//   const [insights, setInsights] = useState<{ text: string; category: string }[]>([])

//   useEffect(() => {
//     if (user) loadData()
//   }, [user])

//   async function loadData() {
//     if (!user) return

//     const weekAgo = new Date()
//     weekAgo.setDate(weekAgo.getDate() - 6)
//     const weekStr = weekAgo.toISOString().split("T")[0]

//     const { data: moods } = await supabase
//       .from("mood_logs")
//       .select("*")
//       .eq("user_id", user.id)
//       .gte("date", weekStr)
//       .order("date", { ascending: true })

//     const { data: anchors } = await supabase
//       .from("daily_anchors")
//       .select("*")
//       .eq("user_id", user.id)
//       .gte("date", weekStr)
//       .order("date", { ascending: true })

//     if (moods && moods.length > 0) {
//       const points = buildChartData(moods as MoodLog[])
//       setChartData(points)
//     }

//     if (moods && anchors) {
//       const generated = generateInsights(moods as MoodLog[], anchors as DailyAnchor[])
//       setInsights(generated)
//     }
//   }

//   function buildChartData(moods: MoodLog[]) {
//     const today = new Date()
//     const points: { day: string; value: number }[] = []

//     for (let i = 6; i >= 0; i--) {
//       const d = new Date(today)
//       d.setDate(d.getDate() - i)
//       const dateStr = d.toISOString().split("T")[0]
//       const mood = moods.find((m) => m.date === dateStr)
//       points.push({
//         day: dayLabels[d.getDay()],
//         value: mood ? moodToValue[mood.mood] ?? 3 : 0,
//       })
//     }
//     return points
//   }

//   const insightIcons = ["\u2600\uFE0F", "\u{1F4DE}", "\u{1F319}"]
//   const hasData = chartData.some((d) => d.value > 0)

//   return (
//     <div className="mx-auto max-w-lg space-y-6">
//       <div className="flex items-center gap-2">
//         <Sparkles className="h-5 w-5 text-primary" />
//         <h1 className="font-heading text-2xl font-bold">{t("patterns.title")}</h1>
//       </div>

//       {/* Mood Chart */}
//       <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//         <CardContent className="p-5">
//           <p className="mb-4 text-sm font-medium text-muted-foreground">{t("patterns.this_week")}</p>
//           {hasData ? (
//             <ResponsiveContainer width="100%" height={180}>
//               <LineChart data={chartData}>
//                 <XAxis
//                   dataKey="day"
//                   axisLine={false}
//                   tickLine={false}
//                   tick={{ fontSize: 12, fill: "#8A8A8A" }}
//                 />
//                 <YAxis
//                   domain={[0, 5]}
//                   hide
//                 />
//                 <Tooltip
//                   formatter={(value) => {
//                     const labels = ["", "Stressed", "Low", "Meh", "Okay", "Great"]
//                     return [labels[value as number] ?? "", "Mood"]
//                   }}
//                   contentStyle={{
//                     backgroundColor: "#FDFBF7",
//                     border: "none",
//                     borderRadius: "12px",
//                     boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
//                   }}
//                 />
//                 <Line
//                   type="monotone"
//                   dataKey="value"
//                   stroke="#7A8B6E"
//                   strokeWidth={2.5}
//                   dot={{ fill: "#7A8B6E", r: 5 }}
//                   activeDot={{ r: 7 }}
//                   connectNulls={false}
//                 />
//               </LineChart>
//             </ResponsiveContainer>
//           ) : (
//             <p className="py-8 text-center text-sm text-muted-foreground">{t("patterns.no_data")}</p>
//           )}
//         </CardContent>
//       </Card>

//       {/* AI Insights */}
//       <div className="space-y-3">
//         <h2 className="font-heading text-lg font-semibold">{t("patterns.insights")}</h2>
//         {insights.length > 0 ? (
//           insights.map((insight, i) => (
//             <Card key={i} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//               <CardContent className="flex items-start gap-3 p-4">
//                 <span className="text-lg">{insightIcons[i % insightIcons.length]}</span>
//                 <p className="text-sm text-foreground/85">{insight.text}</p>
//               </CardContent>
//             </Card>
//           ))
//         ) : (
//           <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//             <CardContent className="p-5">
//               <p className="text-center text-sm text-muted-foreground">{t("patterns.empty")}</p>
//             </CardContent>
//           </Card>
//         )}
//       </div>
//     </div>
//   )
// }
