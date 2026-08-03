// Picks which suggestion gets featured as "the move of the day" on both the
// Move page and Home, and finds a light "this tends to help" correlation
// hint to show under it — shared by src/pages/move.tsx and src/pages/home.tsx
// so the logic (and its documentation) lives in exactly one place.

import { MIN_STREAK_FOR_INTENTION } from "@/lib/streaks"
import { localDateStr } from "@/lib/utils"
import type { MoodLog, MoveSuggestion } from "@/types"

export type MoveReason = "absence" | "low_mood" | "streak" | "neutral"

// Item 6 "archiving": a suggestion is visible when it's a custom, a
// favorite, or belongs to the current week's AI batch — previous weeks'
// non-favorited AI rows just stop matching, nothing is deleted. Shared by
// src/pages/move.tsx and src/pages/home.tsx so both pages agree on what
// "this week's suggestions" means.
export function filterVisibleMoveSuggestions(suggestions: MoveSuggestion[], weekKey: string): MoveSuggestion[] {
  return suggestions.filter((s) => s.is_custom || s.is_favorite || (s.generated_by === "ai" && s.week_key === weekKey))
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
