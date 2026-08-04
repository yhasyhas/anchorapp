import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { fetchInsightsWithFallback } from "@/lib/ai-service"
import { moodToValue } from "@/lib/constants"
import { localDateStr } from "@/lib/utils"
import { formatWeekRange } from "@/lib/letters"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, Brain, Loader2, BookOpen, ChevronDown, ChevronUp } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "sonner"
import type { MoodLog, DailyAnchor, CheckIn, JournalEntry, ProgressStory, InsightLogEntry } from "@/types"
import { todayStr } from "@/lib/utils"

const INSIGHT_HISTORY_LIMIT = 30

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

function formatEntryDate(dateStr: string, lang: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-US", { month: "short", day: "numeric" })
}

export function PatternsPage() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const [chartData, setChartData] = useState<{ day: string; value: number; mood: string | null }[]>([])
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAi, setLoadingAi] = useState(false)
  const [source, setSource] = useState<"local" | "ai" | "cached_ai">("local")
  const aiEnabled = profile?.ai_enabled ?? false

  const [stories, setStories] = useState<ProgressStory[]>([])
  const [selectedStory, setSelectedStory] = useState<ProgressStory | null>(null)
  const [loadingStory, setLoadingStory] = useState(true)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [insightHistory, setInsightHistory] = useState<InsightLogEntry[] | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  useEffect(() => {
    if (user) loadProgressStories()
  }, [user])

  async function loadProgressStories() {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from("progress_stories")
        .select("*")
        .eq("user_id", user.id)
        .order("period_end", { ascending: false })

      if (error) throw error
      const rows = (data as ProgressStory[]) || []
      setStories(rows)
      setSelectedStory(rows[0] ?? null)
    } catch (err: any) {
      // Not surfaced via toast — this section just falls back to the empty
      // state, which reads fine either way ("no story yet" vs. a failed
      // load look the same to her, and that's an acceptable trade for not
      // stacking a second error toast on top of the insights one below.
      console.error("Failed to load progress stories:", err)
    } finally {
      setLoadingStory(false)
    }
  }

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

      const [{ data: weekMoods }, { data: monthMoods }, { data: anchors }, { data: checkIns }, { data: journal }] = await Promise.all([
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
        supabase
          .from("journal_entries")
          .select("*")
          .eq("user_id", user.id)
          .gte("date", thirtyStr)
          .order("date", { ascending: false }),
      ])

      setJournalEntries((journal as JournalEntry[]) || [])

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

  // Lazy — only fetched the first time she opens the section, same
  // "collapsed by default" spirit as the rest of this page's secondary content.
  async function handleToggleHistory() {
    const opening = !historyOpen
    setHistoryOpen(opening)
    if (opening && insightHistory === null && user) {
      setLoadingHistory(true)
      try {
        const { data, error } = await supabase
          .from("insight_log")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(INSIGHT_HISTORY_LIMIT)
        if (error) throw error
        setInsightHistory((data as InsightLogEntry[]) || [])
      } catch (err) {
        console.error("Failed to load insight history:", err)
        setInsightHistory([])
      } finally {
        setLoadingHistory(false)
      }
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

  const moodTrendData = useMemo(() => {
    if (!selectedStory) return []
    return selectedStory.stats.weeks.map((w, i) => ({
      label: i === 2 ? t("progress_story.this_week_label") : t("progress_story.weeks_ago", { count: 3 - i }),
      value: w.avgMoodValue, // null (not 0) for a quiet week — connectNulls={false} skips the point instead of dipping the line to zero
    }))
  }, [selectedStory, t])

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

      {/* Progress Story — the story is the headline here, the chart below it
          is supporting detail, not the other way around. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-lg font-semibold">{t("progress_story.title")}</h2>
        </div>

        {loadingStory ? (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("progress_story.loading")}</span>
              </div>
            </CardContent>
          </Card>
        ) : selectedStory ? (
          <div className="space-y-3">
            <div className="rounded-3xl bg-gradient-to-br from-lavender/20 via-card to-sage-light/30 p-7 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
              <p className="text-xs text-muted-foreground">
                {formatWeekRange(selectedStory.period_start, selectedStory.period_end, i18n.language)}
              </p>
              <div className="mt-4 whitespace-pre-line font-heading text-lg italic leading-relaxed text-foreground/90">
                {selectedStory.story_text}
              </div>
              <p className="mt-6 text-sm font-medium text-primary">{t("progress_story.closing_line")}</p>
            </div>

            {/* Mood trend across the 3 weeks */}
            <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="p-5">
                <p className="mb-3 text-sm font-medium text-muted-foreground">{t("progress_story.mood_trend")}</p>
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={moodTrendData}>
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis domain={[0, 5]} hide />
                    <Tooltip
                      formatter={(value: any) => [typeof value === "number" ? value.toFixed(1) : "—", t("progress_story.mood_trend")]}
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
                      stroke="var(--chart-3)"
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: "var(--chart-3)", stroke: "var(--card)", strokeWidth: 2 }}
                      activeDot={{ r: 7 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top intentions across the period */}
            {selectedStory.stats.topIntentions.length > 0 && (
              <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <CardContent className="p-5">
                  <p className="mb-3 text-sm font-medium text-muted-foreground">{t("progress_story.top_intentions")}</p>
                  <div className="space-y-2.5">
                    {selectedStory.stats.topIntentions.map((ti) => (
                      <div key={ti.intention} className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{t(`intentions.${ti.intention.toLowerCase()}`)}</span>
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                          {t("progress_story.days_count", { count: ti.days })}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Past stories — simple history, swap the featured card above */}
            {stories.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t("progress_story.past_stories")}</p>
                <div className="flex flex-wrap gap-2">
                  {stories.map((story) => (
                    <button
                      key={story.id}
                      onClick={() => setSelectedStory(story)}
                      className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                        story.id === selectedStory.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {formatWeekRange(story.period_start, story.period_end, i18n.language)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <EmptyState icon="seedling" titleKey="progress_story.empty" descriptionKey="progress_story.empty_sub" />
            </CardContent>
          </Card>
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

      {/* Insights History — collapsed by default, same "secondary content"
          weight as the rest of this page. Only ever contains AI-generated
          insights (see logInsightHistory in src/lib/ai-service.ts). */}
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleHistory}
          className="gap-1.5 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {t("patterns.insights_history_toggle")}
        </Button>

        {historyOpen &&
          (loadingHistory ? (
            <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="p-5">
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t("patterns.loading")}</span>
                </div>
              </CardContent>
            </Card>
          ) : insightHistory && insightHistory.length > 0 ? (
            <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="divide-y divide-border/60 p-0">
                {insightHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 p-4">
                    <span className="mt-0.5 w-14 shrink-0 text-xs font-medium text-muted-foreground">
                      {formatEntryDate(entry.created_at.slice(0, 10), i18n.language)}
                    </span>
                    <p className="text-sm text-foreground/85 leading-relaxed">{entry.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="p-5">
                <EmptyState icon="cloud" titleKey="patterns.insights_history_empty" />
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Journal History */}
      <div className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{t("journal.history_title")}</h2>
          <p className="text-xs text-muted-foreground">{t("journal.history_subtitle")}</p>
        </div>

        {journalEntries.length > 0 ? (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="divide-y divide-border/60 p-0">
              {journalEntries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 w-14 shrink-0 text-xs font-medium text-muted-foreground">
                    {entry.date === todayStr() ? t("journal.today_label") : formatEntryDate(entry.date, i18n.language)}
                  </span>
                  <p className="text-sm italic text-foreground/85 leading-relaxed">{entry.sentence}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <EmptyState icon="flower" titleKey="journal.history_empty" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}