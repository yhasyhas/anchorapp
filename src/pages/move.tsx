import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { isOnline } from "@/lib/offline-sync"
import { calculateStreaks } from "@/lib/streaks"
import { generateMoveSuggestions, getWeekKey } from "@/lib/ai-service"
import {
  resolveMoveReason,
  pickFeaturedSuggestion,
  getMoveMoodCorrelation,
  buildVisibleSuggestions,
  materializeDefaultSuggestions,
  defaultAnchorCategoryForActivity,
} from "@/lib/move-selection"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Footprints, Plus, Star, Sparkles } from "lucide-react"
import { todayStr, localDateStr } from "@/lib/utils"
import type { MoveSuggestion, MoodLog, DailyAnchor, AnchorCategory } from "@/types"

const categoryIcons: Record<string, string> = {
  physical: "\u{1F333}",
  novelty: "\u{1FA91}",
  social: "\u{1F48C}",
  mindful: "\u{1F3A7}",
  creative: "\u{1F3A8}",
  rest: "\u{1F6CC}",
}

const anchorCategoryIcons: Record<AnchorCategory, string> = {
  future: "\u{1F331}",
  mindbody: "\u{1F9E0}",
  life: "\u{1F30D}",
}

const ANCHOR_CATEGORIES: AnchorCategory[] = ["future", "mindbody", "life"]

const ALL_MOVE_CATEGORIES = ["physical", "social", "mindful", "novelty", "creative", "rest"] as const

function anchorFieldForCategory(category: AnchorCategory): "future_task" | "mindbody_task" | "life_task" {
  return category === "future" ? "future_task" : category === "mindbody" ? "mindbody_task" : "life_task"
}

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
  const [pendingReplace, setPendingReplace] = useState<{
    title: string
    anchorCategory: AnchorCategory
    currentValue: string
  } | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [newCategory, setNewCategory] = useState<MoveSuggestion["category"]>("physical")
  const [newAnchorCategory, setNewAnchorCategory] = useState<AnchorCategory>("mindbody")
  const [anchorCategoryManual, setAnchorCategoryManual] = useState(false)
  const [addDirectly, setAddDirectly] = useState(false)
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
        anchor_category: g.anchor_category,
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
    const title = newTitle.trim()
    const { data } = await supabase
      .from("move_suggestions")
      .insert({
        user_id: user.id,
        title,
        category: newCategory,
        anchor_category: newAnchorCategory,
        is_custom: true,
      })
      .select()
      .maybeSingle()

    if (data) setSuggestions([data, ...suggestions])
    if (addDirectly) requestAddToAnchor(title, newAnchorCategory)

    setNewTitle("")
    setNewCategory("physical")
    setNewAnchorCategory("mindbody")
    setAnchorCategoryManual(false)
    setAddDirectly(false)
    setShowAddModal(false)
  }

  function handleActivityCategoryPick(category: MoveSuggestion["category"]) {
    setNewCategory(category)
    if (!anchorCategoryManual) setNewAnchorCategory(defaultAnchorCategoryForActivity(category))
  }

  function handleAnchorCategoryPick(category: AnchorCategory) {
    setNewAnchorCategory(category)
    setAnchorCategoryManual(true)
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

  // Every move now carries exactly one anchor_category (Point 3), so there's
  // no more "choose which anchor" step — a tap always targets that move's
  // own category. Fills immediately if the field is empty; otherwise asks
  // for a soft confirmation (pendingReplace) rather than silently
  // overwriting whatever she already wrote there.
  async function pushTitleToAnchor(title: string, anchorCategory: AnchorCategory) {
    if (!user) return
    const field = anchorFieldForCategory(anchorCategory)
    const today = todayStr()

    await supabase.from("daily_anchors").upsert({ user_id: user.id, date: today, [field]: title }, { onConflict: "user_id,date" })

    setRecentAnchors((prev) => {
      const existing = prev.find((a) => a.date === today)
      if (existing) return prev.map((a) => (a.date === today ? { ...a, [field]: title } : a))
      return [
        ...prev,
        {
          id: "",
          user_id: user.id,
          date: today,
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
          [field]: title,
        } as DailyAnchor,
      ]
    })
    toast.success(t("move.added"))
  }

  function requestAddToAnchor(title: string, anchorCategory: AnchorCategory) {
    const today = recentAnchors.find((a) => a.date === todayStr())
    const field = anchorFieldForCategory(anchorCategory)
    const currentValue = today?.[field] ?? ""
    if (!currentValue.trim() || currentValue === title) {
      pushTitleToAnchor(title, anchorCategory)
      return
    }
    setPendingReplace({ title, anchorCategory, currentValue })
  }

  const weekKey = getWeekKey()
  const defaults = materializeDefaultSuggestions(t)
  const sorted = buildVisibleSuggestions(suggestions, weekKey, defaults)

  const streaks = calculateStreaks(recentMoods, recentAnchors)
  const reason = resolveMoveReason({ recentMoods, currentAnchorStreak: streaks.currentAnchorStreak })
  const pickedFeatured = pickFeaturedSuggestion(sorted, reason)
  const absenceFallback: MoveSuggestion = {
    id: "absence-fallback",
    user_id: user?.id ?? "",
    title: t("move.absence_fallback"),
    category: "physical",
    anchor_category: "life",
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

  const todayAnchor = recentAnchors.find((a) => a.date === todayStr())
  const canAddDirectly = !todayAnchor?.anchors_locked_at

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
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => requestAddToAnchor(featured.title, featured.anchor_category)}
                aria-label={t("move.add_to_anchor")}
              >
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
                    onClick={() => requestAddToAnchor(suggestion.title, suggestion.anchor_category)}
                    aria-label={t("move.add_to_anchor")}
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
      <Dialog
        open={showAddModal}
        onOpenChange={(open) => {
          setShowAddModal(open)
          if (!open) {
            setNewCategory("physical")
            setNewAnchorCategory("mindbody")
            setAnchorCategoryManual(false)
            setAddDirectly(false)
          }
        }}
      >
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
                  onClick={() => handleActivityCategoryPick(cat as MoveSuggestion["category"])}
                  className={`rounded-full px-3 py-1 text-sm ${
                    newCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {icon} {t(`move.category.${cat}`)}
                </button>
              ))}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("move.anchor_category_label")}</p>
              <div className="flex gap-2">
                {ANCHOR_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleAnchorCategoryPick(cat)}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
                      newAnchorCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {anchorCategoryIcons[cat]} {t(`anchors.${cat}`)}
                  </button>
                ))}
              </div>
            </div>

            {canAddDirectly && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={addDirectly} onCheckedChange={(v) => setAddDirectly(v === true)} />
                {t("move.add_directly")}
              </label>
            )}

            <Button onClick={addCustomSuggestion} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {t("move.add_custom")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Soft confirm before replacing an anchor that's already filled —
          every move now targets exactly one anchor_category (Point 3), so
          there's no "choose which anchor" step left, only "replace or not". */}
      <Dialog open={pendingReplace !== null} onOpenChange={(open) => !open && setPendingReplace(null)}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {pendingReplace && t("move.replace_confirm_title", { anchor: t(`anchors.${pendingReplace.anchorCategory}`) })}
            </DialogTitle>
          </DialogHeader>
          {pendingReplace && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("move.replace_confirm_body", { current: pendingReplace.currentValue })}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPendingReplace(null)}>
                  {t("move.cancel")}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    pushTitleToAnchor(pendingReplace.title, pendingReplace.anchorCategory)
                    setPendingReplace(null)
                  }}
                >
                  {t("move.replace_confirm_cta")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
