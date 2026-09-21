// Rule-based weekly review — a factual bilan tying the week's activity back
// to Compass, never a verdict, never a score. Generated at most once per
// Monday-Sunday week, lazily, the first time she opens the app on the
// week's eligible day (see isWeeklyReviewEligibleDay) — mirrors
// ensureWrappedGenerated's "generate once, then only ever read the stored
// row" shape (src/lib/wrapped.ts), just at a weekly instead of monthly
// cadence and entirely rule-based (no AI call at all, per spec).
import { supabase } from "@/lib/supabase"
import { getCompass } from "@/lib/compass"
import { topResonatingValues } from "@/lib/daily-suggestion"
import { untouchedGoals } from "@/lib/goal-matching"
import { localDateStr } from "@/lib/utils"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import { weekStartStr, isWeeklyReviewEligibleDay } from "@/lib/week-dates"
import type { CompassGoal, WeeklyReview, WeeklyReviewGoalResponse, WeeklyReviewSnapshot } from "@/types"

export { weekStartStr, isWeeklyReviewEligibleDay }

// ==================== WEEK BOUNDARIES ====================

function weekEndStr(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number)
  const end = new Date(y, m - 1, d)
  end.setDate(end.getDate() + 6)
  return localDateStr(end)
}

function addDaysStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + deltaDays)
  return localDateStr(date)
}

// ==================== ACTIVITY / VALUES THRESHOLDS ====================

// Anti-empty-review guard: below this many suggestion responses + mood
// check-ins combined over the week, there isn't enough to reflect on — the
// week stays silent (no row at all), same "no shaky result from thin data"
// spirit as Wrapped/Patterns' own thresholds.
export const MIN_WEEKLY_ACTIVITY = 2

// Minimum accepted suggestions this week before naming dominant Compass
// values. Deliberately lower than Wrapped's 3 (a calendar month) or
// Patterns' 5 (a rolling 30 days): a week has at most 7 daily suggestions
// to draw from at all, so those monthly-scale thresholds would make the
// values line almost never appear. 2 is chosen as the smallest number that
// still means "more than a single lucky pick" rather than requiring a
// majority of the week's suggestions to land the same way.
export const MIN_ACCEPTED_FOR_WEEKLY_VALUES = 2

// A Compass goal counts as "stale" once none of the accepted suggestions in
// this many trailing weeks resonate with it.
export const GOAL_STALE_WEEKS = 4

// Once a goal has been asked about (goal_prompted_id set on a past weekly
// review), it's skipped from selection for this many weeks — regardless of
// whether she answered the sub-question or just dismissed the card.
export const GOAL_COOLDOWN_WEEKS = 8

// ==================== GOAL <-> SUGGESTION MATCHING ====================

// The keyword-matching itself (goalKeywords / untouchedGoals) lives in
// src/lib/goal-matching.ts so it stays importable without this module's
// supabase dependency chain; re-exported here so existing importers
// (src/lib/wrapped.ts) keep working unchanged.
export { untouchedGoals }

// Among the user's Compass goals, picks the single oldest one that's both
// stale (no matching accepted suggestion in the last GOAL_STALE_WEEKS) and
// not in cooldown (not asked about in the last GOAL_COOLDOWN_WEEKS) — or
// null when none qualify. Never more than one, per spec.
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

// ==================== GENERATION ====================

const WEEKLY_REVIEW_CHECKED_KEY_BASE = "anchor_weekly_review_checked"

interface AcceptedRow {
  suggestion_text: string
}

async function fetchWeekActivity(userId: string, weekStart: string, weekEnd: string) {
  const [suggestionsRes, moodsRes] = await Promise.all([
    supabase
      .from("daily_suggestions")
      .select("suggestion_text,status")
      .eq("user_id", userId)
      .gte("date", weekStart)
      .lte("date", weekEnd),
    supabase.from("mood_logs").select("id").eq("user_id", userId).gte("date", weekStart).lte("date", weekEnd),
  ])
  const suggestions = (suggestionsRes.data as { suggestion_text: string; status: string }[] | null) ?? []
  const moodCount = (moodsRes.data as { id: string }[] | null)?.length ?? 0
  return { suggestions, moodCount }
}

async function fetchRecentlyPromptedGoalIds(userId: string, beforeWeekStart: string): Promise<Set<string>> {
  const cutoff = addDaysStr(beforeWeekStart, -GOAL_COOLDOWN_WEEKS * 7)
  const { data } = await supabase
    .from("weekly_reviews")
    .select("goal_prompted_id")
    .eq("user_id", userId)
    .not("goal_prompted_id", "is", null)
    .gte("week_start", cutoff)
    .lt("week_start", beforeWeekStart)
  return new Set(((data as { goal_prompted_id: string | null }[] | null) ?? []).map((r) => r.goal_prompted_id as string))
}

async function fetchAcceptedTitlesSince(userId: string, sinceDate: string): Promise<AcceptedRow[]> {
  const { data } = await supabase
    .from("daily_suggestions")
    .select("suggestion_text")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .gte("date", sinceDate)
  return (data as AcceptedRow[] | null) ?? []
}

// Idempotent get-or-create for the current week's review. Returns null when
// it's not the eligible day, a review already exists but the week was
// silent (never generated), or this week doesn't have enough activity yet
// — in every "null" case the caller shows nothing, never a placeholder.
// A localStorage flag (per user, per week) short-circuits repeat calls the
// same way ensureWrappedGenerated's WRAPPED_CHECKED_KEY_BASE does, so a
// quiet week isn't re-queried on every Home mount that same Sunday.
export async function getOrCreateWeeklyReview(userId: string): Promise<WeeklyReview | null> {
  const now = new Date()
  if (!isWeeklyReviewEligibleDay(now)) return null

  const weekStart = weekStartStr(now)
  const weekEnd = weekEndStr(weekStart)
  const checkedKey = `${WEEKLY_REVIEW_CHECKED_KEY_BASE}_${weekStart}`

  const alreadyChecked = getUserLocalData<boolean>(checkedKey, userId)

  const { data: existing } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle()

  if (existing) {
    setUserLocalData(checkedKey, userId, true)
    return existing as WeeklyReview
  }

  if (alreadyChecked) return null

  const { suggestions, moodCount } = await fetchWeekActivity(userId, weekStart, weekEnd)
  const answered = suggestions.filter((s) => s.status === "accepted" || s.status === "declined")
  const totalActivity = answered.length + moodCount

  if (totalActivity < MIN_WEEKLY_ACTIVITY) {
    // Genuinely silent week — no row, ever, for this week_start. Flag it
    // checked so we don't re-query it again today.
    setUserLocalData(checkedKey, userId, true)
    return null
  }

  const accepted = answered.filter((s) => s.status === "accepted")
  const declined = answered.filter((s) => s.status === "declined")

  const compass = await getCompass(userId)
  const values = compass?.value_tags ?? []
  const dominantValues =
    accepted.length >= MIN_ACCEPTED_FOR_WEEKLY_VALUES
      ? topResonatingValues(values, accepted.map((s) => ({ title: s.suggestion_text })))
      : null

  let goalPrompted: CompassGoal | null = null
  const goals = compass?.goals ?? []
  if (goals.length > 0) {
    const [recentlyPrompted, acceptedSinceStale] = await Promise.all([
      fetchRecentlyPromptedGoalIds(userId, weekStart),
      fetchAcceptedTitlesSince(userId, addDaysStr(weekStart, -GOAL_STALE_WEEKS * 7)),
    ])
    goalPrompted = pickGoalToPrompt(
      goals,
      acceptedSinceStale.map((s) => ({ title: s.suggestion_text })),
      recentlyPrompted
    )
  }

  const snapshot: WeeklyReviewSnapshot = {
    weekStart,
    weekEnd,
    acceptedCount: accepted.length,
    declinedCount: declined.length,
    dominantValues,
    goalPromptedText: goalPrompted?.text ?? null,
  }

  const { data: inserted, error } = await supabase
    .from("weekly_reviews")
    .upsert(
      {
        user_id: userId,
        week_start: weekStart,
        status: "pending",
        summary_snapshot: snapshot,
        goal_prompted_id: goalPrompted?.id ?? null,
      },
      { onConflict: "user_id,week_start" }
    )
    .select()
    .single()

  setUserLocalData(checkedKey, userId, true)
  if (error) throw error
  return inserted as WeeklyReview
}

// Marks the review as shown (pending -> shown). A no-op once it's already
// shown or dismissed — never regresses dismissed back to shown.
export async function markWeeklyReviewShown(review: WeeklyReview): Promise<void> {
  if (review.status !== "pending") return
  const { error } = await supabase.from("weekly_reviews").update({ status: "shown" }).eq("id", review.id)
  if (error) throw error
}

// Dismiss without necessarily answering the goal question, if one was
// asked — the goal still counts as "prompted" (goal_prompted_id is already
// set from generation) so its cooldown still applies.
export async function dismissWeeklyReview(review: WeeklyReview): Promise<void> {
  const { error } = await supabase
    .from("weekly_reviews")
    .update({ status: "dismissed", interacted_at: new Date().toISOString() })
    .eq("id", review.id)
  if (error) throw error
}

export async function respondWeeklyReviewGoal(
  review: WeeklyReview,
  response: WeeklyReviewGoalResponse
): Promise<void> {
  const { error } = await supabase
    .from("weekly_reviews")
    .update({ goal_response: response, interacted_at: new Date().toISOString() })
    .eq("id", review.id)
  if (error) throw error
}
