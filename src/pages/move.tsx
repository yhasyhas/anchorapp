import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { isOnline } from "@/lib/offline-sync"
import { calculateStreaks } from "@/lib/streaks"
import { generateMoveSuggestions, getWeekKey } from "@/lib/ai-service"
import {
  resolveMoveReason,
  pickFeaturedSuggestion,
  getMoveMoodCorrelation,
  filterVisibleMoveSuggestions,
} from "@/lib/move-selection"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Footprints, Plus, Star, Sparkles } from "lucide-react"
import { todayStr, localDateStr } from "@/lib/utils"
import type { MoveSuggestion, MoodLog, DailyAnchor } from "@/types"

const defaultSuggestions: { titleKey: string; category: MoveSuggestion["category"]; is_custom: false }[] = [
  { titleKey: "move.default.walk", category: "physical", is_custom: false },
  { titleKey: "move.default.new_spot", category: "novelty", is_custom: false },
  { titleKey: "move.default.text_someone", category: "social", is_custom: false },
  { titleKey: "move.default.playlist", category: "mindful", is_custom: false },
  { titleKey: "move.default.stretch", category: "physical", is_custom: false },
]

const categoryIcons: Record<string, string> = {
  physical: "\u{1F333}",
  novelty: "\u{1FA91}",
  social: "\u{1F48C}",
  mindful: "\u{1F3A7}",
  creative: "\u{1F3A8}",
  rest: "\u{1F6CC}",
}

const ALL_MOVE_CATEGORIES = ["physical", "social", "mindful", "novelty", "creative", "rest"] as const

type AnchorType = "future" | "mindbody" | "life"

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

export function MovePage() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const [suggestions, setSuggestions] = useState<MoveSuggestion[]>([])
  const [recentMoods, setRecentMoods] = useState<MoodLog[]>([])
  const [recentAnchors, setRecentAnchors] = useState<DailyAnchor[]>([])
  const [recentCheckIns, setRecentCheckIns] = useState<{ date: string; evening_mood: string | null }[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAnchorModal, setShowAnchorModal] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [newCategory, setNewCategory] = useState<string>("physical")
  const generatingRef = useRef(false)

  useEffect(() => {
    if (user) loadAll()
  }, [user])

  async function loadAll() {
    if (!user) return
    const since = daysAgoStr(29)

    const [{ data: allSuggestions }, { data: moods }, { data: anchors }, { data: checkIns }] = await Promise.all([
      supabase.from("move_suggestions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("mood_logs").select("*").eq("user_id", user.id).gte("date", since),
      supabase.from("daily_anchors").select("*").eq("user_id", user.id).gte("date", since),
      supabase.from("check_ins").select("date, evening_mood").eq("user_id", user.id).gte("date", since),
    ])

    const suggestionsList = (allSuggestions as MoveSuggestion[]) || []
    const moodsList = (moods as MoodLog[]) || []
    const anchorsList = (anchors as DailyAnchor[]) || []
    setSuggestions(suggestionsList)
    setRecentMoods(moodsList)
    setRecentAnchors(anchorsList)
    setRecentCheckIns((checkIns as { date: string; evening_mood: string | null }[]) || [])

    ensureWeeklySuggestions(suggestionsList, anchorsList, moodsList)
  }

  // Generated once per ISO week (see move_suggestions.week_key, same format
  // as getWeekKey() in ai-service.ts) — checked against everything already
  // fetched for this user, so reopening the page later the same week is a
  // no-op, and offline never attempts it (isOnline() guard) so already-
  // generated suggestions just stay visible from local state.
  async function ensureWeeklySuggestions(allSuggestions: MoveSuggestion[], anchors30: DailyAnchor[], moods30: MoodLog[]) {
    if (!user || generatingRef.current) return
    const weekKey = getWeekKey()
    const hasThisWeek = allSuggestions.some((s) => s.generated_by === "ai" && s.week_key === weekKey)
    if (hasThisWeek) return
    if (!profile?.ai_enabled) return
    if (!isOnline()) return

    generatingRef.current = true
    try {
      const since14 = daysAgoStr(13)
      const moodTrend = moods30
        .filter((m) => m.date >= since14)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((m) => ({ date: m.date, mood: m.mood }))

      const anchors14 = anchors30.filter((a) => a.date >= since14)
      const pct = (fn: (a: DailyAnchor) => boolean) =>
        anchors14.length > 0 ? Math.round((anchors14.filter(fn).length / anchors14.length) * 100) : 0
      const anchorCompletion = {
        future: pct((a) => a.future_completed),
        mindbody: pct((a) => a.mindbody_completed),
        life: pct((a) => a.life_completed),
      }

      const intentionFreq: Record<string, number> = {}
      for (const a of anchors14) {
        if (a.daily_intention) intentionFreq[a.daily_intention] = (intentionFreq[a.daily_intention] || 0) + 1
      }
      const topIntentions = Object.entries(intentionFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name)

      const triedCategories = [...new Set(allSuggestions.map((s) => s.category))]
      const untriedCategories = ALL_MOVE_CATEGORIES.filter((c) => !triedCategories.includes(c))

      const generated = await generateMoveSuggestions(
        true,
        { moodTrend, anchorCompletion, topIntentions, triedCategories, untriedCategories },
        i18n.language as "en" | "sw",
        profile?.tone ?? "gentle"
      )
      if (generated.length === 0) return

      const rows = generated.map((g) => ({
        user_id: user.id,
        title: g.title,
        category: g.category,
        intensity: g.intensity,
        is_custom: false,
        generated_by: "ai",
        week_key: weekKey,
      }))
      const { data: inserted } = await supabase.from("move_suggestions").insert(rows).select()
      if (inserted) setSuggestions((prev) => [...(inserted as MoveSuggestion[]), ...prev])
    } catch (err) {
      console.error("Failed to generate weekly move suggestions:", err)
    } finally {
      generatingRef.current = false
    }
  }

  async function addCustomSuggestion() {
    if (!user || !newTitle.trim()) return
    const { data } = await supabase
      .from("move_suggestions")
      .insert({
        user_id: user.id,
        title: newTitle.trim(),
        category: newCategory,
        is_custom: true,
      })
      .select()
      .maybeSingle()

    if (data) setSuggestions([data, ...suggestions])
    setNewTitle("")
    setShowAddModal(false)
  }

  async function toggleFavorite(suggestion: MoveSuggestion) {
    if (!user || suggestion.id.startsWith("default-") || suggestion.id === "absence-fallback") return
    const next = !suggestion.is_favorite
    setSuggestions((prev) => prev.map((s) => (s.id === suggestion.id ? { ...s, is_favorite: next } : s)))
    const { error } = await supabase.from("move_suggestions").update({ is_favorite: next }).eq("id", suggestion.id)
    if (error) {
      console.error("Failed to toggle favorite:", error)
      setSuggestions((prev) => prev.map((s) => (s.id === suggestion.id ? { ...s, is_favorite: !next } : s)))
    }
  }

  async function addToAnchor(type: AnchorType) {
    if (!user || !selectedSuggestion) return
    const today = todayStr()

    const field = type === "future" ? "future_task"
      : type === "mindbody" ? "mindbody_task"
      : "life_task"

    await supabase
      .from("daily_anchors")
      .upsert(
        { user_id: user.id, date: today, [field]: selectedSuggestion },
        { onConflict: "user_id,date" }
      )

    setShowAnchorModal(false)
    setSelectedSuggestion("")
  }

  const weekKey = getWeekKey()

  const dbVisible = filterVisibleMoveSuggestions(suggestions, weekKey)
  const defaultsVisible = defaultSuggestions
    .map((d, i) => ({
      ...d,
      title: t(d.titleKey),
      id: `default-${i}`,
      user_id: "",
      created_at: "",
      generated_by: "user" as const,
      week_key: null,
      is_favorite: false,
      intensity: "standard" as const,
    }))
    .filter((d) => !dbVisible.some((s) => s.title === d.title))

  const allVisible = [...dbVisible, ...defaultsVisible] as MoveSuggestion[]

  const sorted = [...allVisible].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
    const aThisWeek = a.generated_by === "ai" && a.week_key === weekKey ? 0 : 1
    const bThisWeek = b.generated_by === "ai" && b.week_key === weekKey ? 0 : 1
    return aThisWeek - bThisWeek
  })

  const streaks = calculateStreaks(recentMoods, recentAnchors)
  const reason = resolveMoveReason({ recentMoods, currentAnchorStreak: streaks.currentAnchorStreak })
  const pickedFeatured = pickFeaturedSuggestion(sorted, reason)
  const absenceFallback: MoveSuggestion = {
    id: "absence-fallback",
    user_id: user?.id ?? "",
    title: t("move.absence_fallback"),
    category: "physical",
    is_custom: false,
    generated_by: "user",
    week_key: null,
    is_favorite: false,
    intensity: "gentle",
    created_at: "",
  }
  const featured = reason === "absence" ? absenceFallback : pickedFeatured
  const listSuggestions = sorted.filter((s) => s.id !== featured?.id).slice(0, 6)

  const correlationKeyword = featured ? getMoveMoodCorrelation(featured.title, recentAnchors, recentCheckIns) : null

  function openAnchorModal(title: string) {
    setSelectedSuggestion(title)
    setShowAnchorModal(true)
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Footprints className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("move.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("move.subtitle")}</p>
      </div>

      {featured && (
        <Card className="border-0 bg-gradient-to-br from-lavender/30 to-peach/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">{t("move.featured_title")}</p>
              {featured.generated_by === "ai" && (
                <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                  <Sparkles className="mr-1 h-3 w-3" />
                  {t("checkin.personalized_badge")}
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">{categoryIcons[featured.category] ?? "\u{1F333}"}</span>
                <p className="text-base font-medium text-foreground">{featured.title}</p>
              </div>
              <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => openAnchorModal(featured.title)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {correlationKeyword && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("move.correlation_hint", { keyword: correlationKeyword })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {listSuggestions.map((suggestion) => {
          const isRealRow = !suggestion.id.startsWith("default-")
          return (
            <Card key={suggestion.id} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{categoryIcons[suggestion.category] ?? "\u{1F333}"}</span>
                  <p className="text-sm font-medium text-foreground">{suggestion.title}</p>
                </div>
                <div className="flex items-center gap-1">
                  {isRealRow && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 ${suggestion.is_favorite ? "text-primary" : "text-muted-foreground"}`}
                      onClick={() => toggleFavorite(suggestion)}
                      aria-label={t("move.favorite")}
                    >
                      <Star className="h-4 w-4" fill={suggestion.is_favorite ? "currentColor" : "none"} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-primary"
                    onClick={() => openAnchorModal(suggestion.title)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Button
        variant="outline"
        className="w-full border-dashed border-primary/30 text-primary"
        onClick={() => setShowAddModal(true)}
      >
        <Plus className="mr-2 h-4 w-4" />
        {t("move.add_custom")}
      </Button>

      {/* Add Custom Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("move.add_custom")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="..."
            />
            <div className="flex flex-wrap gap-2">
              {Object.entries(categoryIcons).map(([cat, icon]) => (
                <button
                  key={cat}
                  onClick={() => setNewCategory(cat)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    newCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {icon} {t(`move.category.${cat}`)}
                </button>
              ))}
            </div>
            <Button onClick={addCustomSuggestion} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {t("move.add_custom")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add to Anchor Modal */}
      <Dialog open={showAnchorModal} onOpenChange={setShowAnchorModal}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("move.choose_anchor")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addToAnchor("future")}
            >
              <span className="mr-2">&#x1F331;</span> {t("anchors.future")}
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addToAnchor("mindbody")}
            >
              <span className="mr-2">&#x1F9E0;</span> {t("anchors.mindbody")}
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addToAnchor("life")}
            >
              <span className="mr-2">&#x1F30D;</span> {t("anchors.life")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
