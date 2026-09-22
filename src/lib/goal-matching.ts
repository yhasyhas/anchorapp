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

// ==================== SHARED STALE-GOAL SELECTION ====================
//
// Moved here from weekly-review.ts (which re-exports both, so existing
// importers there are unaffected) specifically so companion-triggers.ts can
// reuse the exact same selection — not a parallel reimplementation of it —
// without pulling in weekly-review.ts's supabase/compass dependency chain
// (companion-triggers.ts must stay importable under plain tsx, same
// reasoning as untouchedGoals/goalKeywords above). This was the actual bug
// behind weekly_reviews and the Companion's "gap" observation being able to
// independently pick, and separately flag, the SAME stale goal to the same
// user the same week: two selection algorithms with two different cooldown
// policies over the same underlying signal. There is now exactly one.

// A Compass goal counts as "stale" once none of the accepted suggestions in
// this many trailing weeks resonate with it.
export const GOAL_STALE_WEEKS = 4

// Once a goal has been asked about (goal_prompted_id set on a past weekly
// review), it's skipped from selection for this many weeks — regardless of
// whether she answered the sub-question or just dismissed the card.
export const GOAL_COOLDOWN_WEEKS = 8

// Among the user's Compass goals, picks the single oldest one that's both
// stale (no matching accepted suggestion in the last GOAL_STALE_WEEKS) and
// not in cooldown (not asked about in the last GOAL_COOLDOWN_WEEKS) — or
// null when none qualify. Never more than one, per spec. The single
// selection function both weekly_reviews' goal question (weekly-review.ts)
// and the Companion's "gap" observation (companion-triggers.ts) call — see
// that module's detectGoalGap for how it layers its own stronger-claim
// threshold on top without re-selecting anything.
export function pickGoalToPrompt(
  goals: CompassGoal[],
  acceptedTitlesSinceStale: { title: string }[],
  recentlyPromptedGoalIds: Set<string>
): CompassGoal | null {
  const eligible = untouchedGoals(goals, acceptedTitlesSinceStale).filter((g) => !recentlyPromptedGoalIds.has(g.id))
  if (eligible.length === 0) return null
  eligible.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return eligible[0]
}
