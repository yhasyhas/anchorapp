// Picks which suggestion gets featured as "the move of the day" on both the
// Move page and Home, and finds a light "this tends to help" correlation
// hint to show under it — shared by src/pages/move.tsx and src/pages/home.tsx
// so the logic (and its documentation) lives in exactly one place.

import { MIN_STREAK_FOR_INTENTION } from "@/lib/streaks"
import { localDateStr } from "@/lib/utils"
import type { AnchorCategory, DailyAnchor, MoodLog, MoveSuggestion } from "@/types"

export type MoveReason = "absence" | "low_mood" | "streak" | "neutral"

// Item 6 "archiving": a suggestion is visible when it's a custom, a
// favorite, or belongs to the current week's AI batch — previous weeks'
// non-favorited AI rows just stop matching, nothing is deleted. Shared by
// src/pages/move.tsx and src/pages/home.tsx so both pages agree on what
// "this week's suggestions" means.
export function filterVisibleMoveSuggestions(suggestions: MoveSuggestion[], weekKey: string): MoveSuggestion[] {
  return suggestions.filter((s) => s.is_custom || s.is_favorite || (s.generated_by === "ai" && s.week_key === weekKey))
}

// Smart default when creating a custom move or backfilling AI/legacy rows
// with no anchor_category of their own — same mapping as the migration's
// SQL backfill (see supabase/migrations/20260806140000_add_anchor_category_to_move_suggestions.sql),
// kept in one place so both stay in sync if the rule ever changes.
const ACTIVITY_TO_ANCHOR_CATEGORY: Record<MoveSuggestion["category"], AnchorCategory> = {
  physical: "mindbody",
  mindful: "mindbody",
  rest: "mindbody",
  social: "life",
  novelty: "life",
  creative: "future",
}

export function defaultAnchorCategoryForActivity(activityCategory: MoveSuggestion["category"]): AnchorCategory {
  return ACTIVITY_TO_ANCHOR_CATEGORY[activityCategory] ?? "mindbody"
}

// The hardcoded static pool — never stored as DB rows, rendered client-side
// (see filterVisibleMoveSuggestions's own comment). Lives here (not in
// src/pages/move.tsx) so src/pages/home.tsx's planning picker (Point 2) can
// build the exact same combined list without duplicating this array.
// One default per anchor_category minimum, so every planning card always
// has at least one suggestion even fully offline / before any custom or AI
// suggestion exists.
const DEFAULT_SUGGESTIONS: {
  titleKey: string
  category: MoveSuggestion["category"]
  anchor_category: AnchorCategory
}[] = [
  { titleKey: "move.default.walk", category: "physical", anchor_category: "mindbody" },
  { titleKey: "move.default.stretch", category: "physical", anchor_category: "mindbody" },
  { titleKey: "move.default.playlist", category: "mindful", anchor_category: "mindbody" },
  { titleKey: "move.default.new_spot", category: "novelty", anchor_category: "life" },
  { titleKey: "move.default.text_someone", category: "social", anchor_category: "life" },
  { titleKey: "move.default.learn", category: "creative", anchor_category: "future" },
]

// Turns the static pool above into full MoveSuggestion-shaped objects (fake
// stable ids, no user_id/created_at) so it can be merged with real DB rows
// through the same filtering/sorting/picking functions below.
export function materializeDefaultSuggestions(t: (key: string) => string): MoveSuggestion[] {
  return DEFAULT_SUGGESTIONS.map((d, i) => ({
    id: `default-${i}`,
    user_id: "",
    title: t(d.titleKey),
    category: d.category,
    anchor_category: d.anchor_category,
    is_custom: false,
    generated_by: "user" as const,
    week_key: null,
    is_favorite: false,
    intensity: "standard" as const,
    created_at: "",
  }))
}

// Combines real DB rows (favorites/customs/this-week's AI batch) with the
// static pool (skipping any default whose title a real row already covers),
// sorted favorites-first then this-week's AI batch first — the exact
// ordering src/pages/move.tsx used to build inline; now shared so
// src/pages/home.tsx's planning picker agrees on the same order.
export function buildVisibleSuggestions(
  dbSuggestions: MoveSuggestion[],
  weekKey: string,
  defaults: MoveSuggestion[]
): MoveSuggestion[] {
  const dbVisible = filterVisibleMoveSuggestions(dbSuggestions, weekKey)
  const defaultsVisible = defaults.filter((d) => !dbVisible.some((s) => s.title === d.title))
  const all = [...dbVisible, ...defaultsVisible]

  return [...all].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
    const aThisWeek = a.generated_by === "ai" && a.week_key === weekKey ? 0 : 1
    const bThisWeek = b.generated_by === "ai" && b.week_key === weekKey ? 0 : 1
    return aThisWeek - bThisWeek
  })
}

// Point 1a: a suggestion is only ever relevant to the ONE anchor category
// it's tagged with.
export function filterByAnchorCategory(suggestions: MoveSuggestion[], anchorCategory: AnchorCategory): MoveSuggestion[] {
  return suggestions.filter((s) => s.anchor_category === anchorCategory)
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

// Point 1b: draw-without-replacement across today's 3 anchor cards — a
// suggestion already sitting in one field must never be offered again for
// another. Also used to strip out a suggestion that was just picked before
// re-picking for a different card.
export function excludeUsedTitles(suggestions: MoveSuggestion[], usedTitles: Set<string>): MoveSuggestion[] {
  return suggestions.filter((s) => !usedTitles.has(normalizeTitle(s.title)))
}

export function usedTitlesForToday(anchor: Pick<DailyAnchor, "future_task" | "mindbody_task" | "life_task">): Set<string> {
  return new Set(
    [anchor.future_task, anchor.mindbody_task, anchor.life_task].filter(Boolean).map((title) => normalizeTitle(title))
  )
}

// Point 1c: a soft (not hard) exclusion — titles that appeared in any of the
// 3 anchor fields on the last `days` calendar days, so the same move doesn't
// keep resurfacing day after day. Callers should fall back to the
// un-varied pool if this empties it out (a small favorites-only pool
// shouldn't go silent just because it was used yesterday).
export function getRecentlyUsedTitles(recentAnchors: DailyAnchor[], days: number): Set<string> {
  const today = localDateStr(new Date())
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = localDateStr(cutoff)

  const titles = new Set<string>()
  for (const a of recentAnchors) {
    if (a.date === today || a.date < cutoffStr) continue
    for (const task of [a.future_task, a.mindbody_task, a.life_task]) {
      if (task) titles.add(normalizeTitle(task))
    }
  }
  return titles
}

const LOW_MOODS = new Set(["low", "stressed"])
const GOOD_MOODS = new Set(["great", "okay"])

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

// Documented precedence, most specific (and most urgent to respond to)
// first:
//   1. absence  — no mood logged for the 3 days immediately before today,
//      but she's here now. An empty stretch deserves the lowest possible
//      bar back in, not a menu of options.
//   2. low_mood — the last 2 calendar days (yesterday and the day before)
//      BOTH logged low/stressed. Two data points, not one, so a single
//      rough day doesn't soften the whole suggestion set.
//   3. streak   — an active anchor streak (same MIN_STREAK_FOR_INTENTION
//      threshold already used everywhere else a streak is treated as
//      "established", see src/lib/streaks.ts) earns a slightly more
//      ambitious nudge.
//   4. neutral  — everything else.
export function resolveMoveReason(params: { recentMoods: MoodLog[]; currentAnchorStreak: number }): MoveReason {
  const { recentMoods, currentAnchorStreak } = params
  const moodByDate = new Map(recentMoods.map((m) => [m.date, m.mood]))

  const lastThree = [1, 2, 3].map((n) => daysAgoStr(n))
  if (!lastThree.some((d) => moodByDate.has(d))) return "absence"

  const lastTwo = [1, 2].map((n) => daysAgoStr(n))
  if (lastTwo.every((d) => LOW_MOODS.has(moodByDate.get(d) ?? ""))) return "low_mood"

  if (currentAnchorStreak >= MIN_STREAK_FOR_INTENTION) return "streak"

  return "neutral"
}

// null only ever means "absence" (caller renders the hardcoded minimal
// fallback, see move.absence_fallback) or an empty suggestion pool.
export function pickFeaturedSuggestion(suggestions: MoveSuggestion[], reason: MoveReason): MoveSuggestion | null {
  if (reason === "absence" || suggestions.length === 0) return null

  if (reason === "low_mood") {
    return (
      suggestions.find((s) => s.intensity === "gentle") ??
      suggestions.find((s) => s.intensity !== "ambitious") ??
      suggestions[0]
    )
  }

  if (reason === "streak") {
    return (
      suggestions.find((s) => s.intensity === "ambitious") ??
      suggestions.find((s) => s.intensity === "standard") ??
      suggestions[0]
    )
  }

  // neutral — the caller already sorts favorites first, so the first item
  // IS the favorite-preferred pick; find() here is just an explicit
  // safety net in case the caller's list isn't pre-sorted.
  return suggestions.find((s) => s.is_favorite) ?? suggestions[0]
}

const KEYWORD_STOPWORDS = new Set([
  "take",
  "do",
  "a",
  "an",
  "the",
  "your",
  "to",
  "for",
  "with",
  "some",
  "gentle",
  "min",
  "mins",
  "minute",
  "minutes",
  "today",
  "at",
  "in",
  "on",
  "of",
  "and",
  "or",
  "go",
  "get",
  "have",
  "up",
  "out",
])

// Simple, deliberately unsophisticated heuristic — same spirit as the rest
// of this app's local pattern matching (e.g. generateLocalInsights's
// `.includes("walk")` check in src/lib/ai-service.ts): strip a small
// stopword list, keep the longest remaining word as the "topic" of the
// suggestion title.
function extractKeyword(title: string): string | null {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !KEYWORD_STOPWORDS.has(w) && !/^\d+$/.test(w))

  if (words.length === 0) return null
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), words[0])
}

const MIN_CORRELATION_OCCURRENCES = 3
// How much higher the good-mood rate needs to be on matching days vs.
// overall, before calling it a real pattern rather than noise — same
// "don't oversell a coincidence" spirit as the 0.5/0.6 ratio thresholds
// already used in generateLocalInsights.
const CORRELATION_MARGIN = 0.15

// Returns the matched keyword (for the "...on {{keyword}} days" hint) when
// there's a real pattern, null otherwise. Looks for anchor task text
// (any of the 3 daily anchors) containing the suggestion's keyword, and
// compares the evening-mood good-rate on those matching dates against the
// overall good-rate — requires 3+ matching dates with a logged mood
// (the spec's own threshold) before it's willing to claim anything at all.
export function getMoveMoodCorrelation(
  suggestionTitle: string,
  recentAnchors: { date: string; future_task: string; mindbody_task: string; life_task: string }[],
  recentCheckIns: { date: string; evening_mood: string | null }[]
): string | null {
  const keyword = extractKeyword(suggestionTitle)
  if (!keyword) return null

  const moodByDate = new Map<string, string>()
  for (const c of recentCheckIns) {
    if (c.evening_mood) moodByDate.set(c.date, c.evening_mood)
  }
  if (moodByDate.size === 0) return null

  const matchDates = recentAnchors
    .filter((a) => [a.future_task, a.mindbody_task, a.life_task].some((t) => t.toLowerCase().includes(keyword)))
    .map((a) => a.date)
    .filter((d) => moodByDate.has(d))

  if (matchDates.length < MIN_CORRELATION_OCCURRENCES) return null

  const goodRate = (dates: string[]) => dates.filter((d) => GOOD_MOODS.has(moodByDate.get(d)!)).length / dates.length

  const matchRate = goodRate(matchDates)
  const overallRate = goodRate([...moodByDate.keys()])

  return matchRate > overallRate + CORRELATION_MARGIN ? keyword : null
}
