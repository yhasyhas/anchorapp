// Pure Compass-goal <-> accepted-suggestion keyword matching, split out of
// weekly-review.ts so it can be imported without that module's supabase/
// compass dependency chain — same reasoning as src/lib/week-dates.ts (a
// plain-tsx verification script can't evaluate `@/lib/supabase`, whose
// top-level createClient reads import.meta.env). Depends only on
// daily-suggestion.ts's pure keyword matcher — keep it that way.
// weekly-review.ts re-exports untouchedGoals, so existing importers
// (src/lib/wrapped.ts) are unaffected.
import { filterByKeywords } from "@/lib/daily-suggestion"
import type { CompassGoal } from "@/types"

// Small stopword list — just enough to keep single-letter connectors out of
// a goal's derived keyword list; not a general NLP stopword table.
const GOAL_STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "for", "and", "or", "my", "in", "on", "with",
  "be", "more", "less", "get", "that", "this", "into", "at", "up", "out",
  "some", "each", "day", "week", "time",
])

// Derives a small keyword list straight from a goal's own free text (goals
// have no fixed keyword table like Compass values do — see VALUE_KEYWORDS
// in daily-suggestion.ts), then reuses filterByKeywords, the exact same
// substring matcher VALUE_KEYWORDS-based matching already uses, rather than
// inventing a second matching technique for free text.
export function goalKeywords(goalText: string): string[] {
  return goalText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GOAL_STOPWORDS.has(w))
}

// True when at least one accepted suggestion in the window resonates with
// this goal's own words. A goal whose text yields no usable keywords (all
// short/generic words) can't be evaluated either way — treated as "no
// match" (stale) rather than silently excluded from ever being asked about.
function goalHasRecentMatch(goal: CompassGoal, acceptedTitles: { title: string }[]): boolean {
  const keywords = goalKeywords(goal.text)
  if (keywords.length === 0) return false
  return filterByKeywords(acceptedTitles, keywords).length > 0
}

// Compass goals with no accepted-suggestion match anywhere in the given
// list — the same underlying keyword match pickGoalToPrompt's own staleness
// check uses, exposed directly for callers that just want "which goals
// are untouched" without the weekly-specific stale-window/cooldown
// selection on top of it (e.g. Wrapped's monthly untouched-goals mirror in
// src/lib/wrapped.ts, which imports this rather than duplicating the
// keyword-matching logic a second time).
export function untouchedGoals(goals: CompassGoal[], acceptedTitles: { title: string }[]): CompassGoal[] {
  return goals.filter((g) => !goalHasRecentMatch(g, acceptedTitles))
}
