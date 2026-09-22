// Companion trigger detection — data foundations only. Each detector is a
// PURE function over plain data (no supabase, no localStorage, no clock —
// "today"/"now" are parameters) that returns either null or a draft of the
// observation worth recording. No text is generated here and nothing is
// shown or sent: a later prompt turns a stored observation's payload into
// words. Fetching the inputs and inserting the drafts lives in
// src/lib/companion-detection.ts; keeping the two apart is what lets
// scripts/check-companion-triggers.ts exercise every rule with fixtures
// under plain tsx (no supabase import chain — same reasoning as
// src/lib/week-dates.ts and src/lib/goal-matching.ts).
//
// Every draft carries a `dedupeKey` in its payload identifying the exact
// condition it describes. The detectors skip a condition whose key already
// exists (acknowledged or not), and the database enforces the same thing
// with a unique index (see the companion tables' migration), so two tabs
// racing the same detection can't store it twice either.
import { LOW_MOODS } from "@/lib/move-selection"
import { goalKeywords, pickGoalToPrompt } from "@/lib/goal-matching"
import { ANCHOR_STREAK_MILESTONES } from "@/lib/streaks"
import { localDateStr } from "@/lib/utils"
import type { CompanionObservationType, CompassGoal, MoodLog, MoveSuggestion } from "@/types"

// ==================== SHARED TYPES ====================

export interface CompanionObservationDraft {
  type: Exclude<CompanionObservationType, "weekly_checkin">
  payload: { trigger: string; dedupeKey: string; [key: string]: unknown }
}

// Just the fields the detectors read back from companion_observations.
export interface ExistingObservation {
  type: CompanionObservationType
  payload: Record<string, unknown>
  acknowledged: boolean
}

function hasDedupeKey(existing: ExistingObservation[], dedupeKey: string): boolean {
  return existing.some((o) => o.payload?.dedupeKey === dedupeKey)
}

// ==================== DATE HELPERS ====================

// Same UTC-based calendar arithmetic as dayIndex in src/lib/streaks.ts: two
// "YYYY-MM-DD" strings compare without any timezone / DST drift.
function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

// ==================== THRESHOLDS ====================

// Hard moment: this many consecutive calendar days logged low/stressed.
// Same "low mood" set (LOW_MOODS) and calendar-day notion of "consecutive"
// as resolveMoveReason in move-selection.ts, which needs 2 days to soften a
// suggestion; 3 is the spec's bar for the Companion to say something.
export const HARD_MOMENT_MIN_DAYS = 3

// Goal gap: NOT a selection window any more (see detectGoalGap below — goal
// selection itself is fully delegated to pickGoalToPrompt, the same
// function weekly-review.ts's own goal question uses, so the two systems
// can never independently pick — or flag — different stale goals). This is
// now purely a message-appropriateness threshold: the goal pickGoalToPrompt
// selected must ALSO be at least this old before Companion is willing to
// call it a "gap" — a stronger claim than weekly-review's light question,
// so it shouldn't fire on a goal that's simply too young to judge yet.
// Deliberately longer than weekly-review's GOAL_STALE_WEEKS (4).
export const GOAL_GAP_WEEKS = 6

// How far back a "first time" event may sit and still be picked up. The
// detectors run on Home open (about once a day), so this only has to bridge
// a few days without opening the app — and it stops the very first run
// after this ships from retroactively announcing old firsts.
export const FIRST_TIME_LOOKBACK_DAYS = 7

// Circle "return": her latest Circle action came at least this long after
// the one before it.
export const CIRCLE_RETURN_ABSENCE_DAYS = 60

// Companion's enriched take on the week (companion-generation.ts, written
// to weekly_reviews.companion_text) only generates for accounts at least
// this old — same bar the old standalone companion_weekly_checkins ritual
// used before it was folded into weekly_reviews.
export const WEEKLY_CHECKIN_MIN_TENURE_DAYS = 21

// ==================== HARD MOMENT ====================

export interface HardMomentInput {
  moods: Pick<MoodLog, "date" | "mood">[]
  // Her local calendar date, "YYYY-MM-DD".
  today: string
  existing: ExistingObservation[]
}

// >= HARD_MOMENT_MIN_DAYS consecutive low/stressed mood logs ending today —
// or yesterday when today isn't logged yet (the day isn't over, same
// convention as currentStreakRun in streaks.ts). Recorded as a 'pattern'.
//
// Two guards against piling up: no new hard-moment while any 'pattern'
// observation is still un-acknowledged (the spec's rule), and never twice
// for the same low run — a run is keyed by its first day, so day 4 of a
// streak she already acknowledged on day 3 doesn't re-trigger.
export function detectHardMoment(input: HardMomentInput): CompanionObservationDraft | null {
  const { moods, today, existing } = input

  if (existing.some((o) => o.type === "pattern" && !o.acknowledged)) return null

  const moodByDate = new Map(moods.map((m) => [m.date, m.mood]))
  const run: string[] = [] // newest -> oldest
  let cursor = moodByDate.has(today) ? today : addDays(today, -1)
  while (LOW_MOODS.has(moodByDate.get(cursor) ?? "")) {
    run.push(cursor)
    cursor = addDays(cursor, -1)
  }
  if (run.length < HARD_MOMENT_MIN_DAYS) return null

  const runEnd = run[0]
  const runStart = run[run.length - 1]
  const dedupeKey = `hard_moment:${runStart}`
  if (hasDedupeKey(existing, dedupeKey)) return null

  return {
    type: "pattern",
    payload: {
      trigger: "hard_moment",
      dedupeKey,
      runStart,
      runEnd,
      runLength: run.length,
      moods: [...run].reverse().map((d) => moodByDate.get(d)),
    },
  }
}

// ==================== GOAL GAP ====================

export interface GoalGapInput {
  goals: CompassGoal[]
  // Accepted suggestions from the last GOAL_STALE_WEEKS (goal-matching.ts's
  // shared window, same one weekly-review.ts uses) — the CALLER filters by
  // date (companion-detection.ts already has the full accepted history
  // fetched for other detectors, so it slices in-memory rather than a
  // second DB query). Not GOAL_GAP_WEEKS: staleness matching itself is
  // pickGoalToPrompt's concern now, not this function's.
  acceptedTitlesSinceStale: { title: string }[]
  // The exact same rolling-cooldown state pickGoalToPrompt uses elsewhere
  // (weekly_reviews.goal_prompted_id history, GOAL_COOLDOWN_WEEKS back,
  // INCLUSIVE of the current week — see fetchRecentlyPromptedGoalIds in
  // weekly-review.ts) — a goal in this set was already asked about by the
  // weekly review this cycle (or recently enough to still be in cooldown)
  // and is never independently re-picked here.
  recentlyPromptedGoalIds: Set<string>
  today: string
  existing: ExistingObservation[]
}

// Goal SELECTION is fully delegated to pickGoalToPrompt (src/lib/goal-
// matching.ts) — the exact same function weekly-review.ts's own goal
// question calls, over the exact same cooldown state (recentlyPromptedGoalIds,
// caller-fetched from weekly_reviews). This used to be a parallel
// reimplementation (its own untouchedGoals filtering, its own age window,
// its own "once per goal ever" cooldown via dedupeKey) — which meant the
// weekly review and the Companion could each pick a DIFFERENT stale goal,
// or worse, both pick and separately flag the SAME one, unaware of each
// other. There is now exactly one selection; this function only decides
// whether to say something ADDITIONAL about the goal that selection
// already chose:
//  - the goal must ALSO be old enough for Companion's stronger claim
//    (GOAL_GAP_WEEKS — a message-appropriateness threshold, not a second
//    selection pass: it can only suppress the shared pick, never choose a
//    different goal);
//  - the goal must yield matchable keywords at all — pickGoalToPrompt (via
//    untouchedGoals) treats an unmatchable goal as "stale" by default (a
//    fine default for the weekly card's light question), but Companion
//    shouldn't claim neglect for a goal the matcher was never able to
//    evaluate;
//  - once per goal, ever, for COMPANION'S OWN observation specifically: an
//    existing gap observation for the same goal id, acknowledged or not,
//    blocks a repeat — independent of (and in addition to) the shared
//    cooldown above.
export function detectGoalGap(input: GoalGapInput): CompanionObservationDraft | null {
  const { goals, acceptedTitlesSinceStale, recentlyPromptedGoalIds, today, existing } = input

  const goal = pickGoalToPrompt(goals, acceptedTitlesSinceStale, recentlyPromptedGoalIds)
  if (!goal) return null

  const windowStart = addDays(today, -GOAL_GAP_WEEKS * 7)
  if (localDateStr(new Date(goal.created_at)) > windowStart) return null
  if (goalKeywords(goal.text).length === 0) return null

  const dedupeKey = `gap:${goal.id}`
  if (hasDedupeKey(existing, dedupeKey)) return null

  return {
    type: "gap",
    payload: {
      trigger: "goal_gap",
      dedupeKey,
      goalId: goal.id,
      goalText: goal.text,
      weeks: GOAL_GAP_WEEKS,
    },
  }
}

// ==================== FIRST TIME ====================

export type SuggestionCategory = MoveSuggestion["category"]

export interface AcceptedWithCategory {
  date: string
  category: SuggestionCategory
}

export interface FirstTimeInput {
  // Accepted daily suggestions with their category already resolved — see
  // resolveAcceptedCategories. Any age.
  accepted: AcceptedWithCategory[]
  // Local "YYYY-MM-DD" dates of her own Circle actions (encouragement or
  // voice message sent, SOS raised), any order, duplicates fine.
  circleActionDates: string[]
  today: string
  existing: ExistingObservation[]
}

// daily_suggestions has no category column — a row only knows its
// source_move_item_id (null for the hardcoded static pool) and the text it
// showed. Resolution order: the move_suggestions row by id, then by
// normalized title among her own rows, then by title among the static pool
// (passed in already translated, since the stored text is whatever language
// she saw that day). Rows that still don't resolve are dropped — better to
// miss a "first" than to claim one for a category we guessed.
export function resolveAcceptedCategories(
  accepted: { date: string; text: string; sourceMoveItemId: string | null }[],
  moveRows: { id: string; title: string; category: SuggestionCategory }[],
  staticPool: { title: string; category: SuggestionCategory }[]
): AcceptedWithCategory[] {
  const norm = (s: string) => s.trim().toLowerCase()
  const byId = new Map(moveRows.map((r) => [r.id, r.category]))
  const byTitle = new Map<string, SuggestionCategory>()
  for (const r of staticPool) byTitle.set(norm(r.title), r.category)
  // Her own rows last so they win over a static entry with the same title.
  for (const r of moveRows) byTitle.set(norm(r.title), r.category)

  const out: AcceptedWithCategory[] = []
  for (const a of accepted) {
    const category = (a.sourceMoveItemId ? byId.get(a.sourceMoveItemId) : undefined) ?? byTitle.get(norm(a.text))
    if (category) out.push({ date: a.date, category })
  }
  return out
}

interface FirstTimeCandidate {
  eventDate: string
  draft: CompanionObservationDraft
}

// Two independent kinds of "first", recorded as 'first_time':
//  1. Her first accepted suggestion in a category she'd never accepted one
//     in before (within FIRST_TIME_LOOKBACK_DAYS). "Touched" means accepted,
//     not merely shown or declined. Her very first acceptance overall counts
//     too — it is a first in its category — and is flagged `isVeryFirst`.
//  2. A return to Circle after >= CIRCLE_RETURN_ABSENCE_DAYS without any
//     Circle action of her own: a day with an action whose previous
//     action-day was that far back. Consecutive action-days are compared
//     pairwise (not just the latest two) so a return followed by a second
//     action the next day is still found.
// One observation per call: the most recent event wins (a category first
// wins a same-day tie); anything else surfaces on a later run while still
// inside the lookback.
export function detectFirstTime(input: FirstTimeInput): CompanionObservationDraft | null {
  const { accepted, circleActionDates, today, existing } = input
  const lookbackStart = addDays(today, -FIRST_TIME_LOOKBACK_DAYS)
  const candidates: FirstTimeCandidate[] = []

  // 1. New category.
  const firstDateByCategory = new Map<SuggestionCategory, string>()
  for (const a of accepted) {
    const known = firstDateByCategory.get(a.category)
    if (known === undefined || a.date < known) firstDateByCategory.set(a.category, a.date)
  }
  const earliestOverall = accepted.reduce<string | null>((min, a) => (min === null || a.date < min ? a.date : min), null)
  for (const [category, firstDate] of firstDateByCategory) {
    const dedupeKey = `category:${category}`
    if (firstDate < lookbackStart || firstDate > today || hasDedupeKey(existing, dedupeKey)) continue
    candidates.push({
      eventDate: firstDate,
      draft: {
        type: "first_time",
        payload: {
          trigger: "first_category",
          dedupeKey,
          category,
          firstDate,
          isVeryFirst: firstDate === earliestOverall,
        },
      },
    })
  }

  // 2. Circle return.
  const actionDays = [...new Set(circleActionDates)].sort().reverse() // newest -> oldest
  for (let i = 0; i < actionDays.length - 1; i++) {
    const returnDate = actionDays[i]
    if (returnDate < lookbackStart || returnDate > today) continue
    const previousDate = actionDays[i + 1]
    const absenceDays = dayIndex(returnDate) - dayIndex(previousDate)
    const dedupeKey = `circle_return:${returnDate}`
    if (absenceDays < CIRCLE_RETURN_ABSENCE_DAYS || hasDedupeKey(existing, dedupeKey)) continue
    candidates.push({
      eventDate: returnDate,
      draft: {
        type: "first_time",
        payload: { trigger: "circle_return", dedupeKey, returnDate, previousDate, absenceDays },
      },
    })
  }

  if (candidates.length === 0) return null
  candidates.sort(
    (a, b) =>
      b.eventDate.localeCompare(a.eventDate) ||
      // Same day: category first, then a stable order on the key.
      Number(b.draft.payload.trigger === "first_category") - Number(a.draft.payload.trigger === "first_category") ||
      a.draft.payload.dedupeKey.localeCompare(b.draft.payload.dedupeKey)
  )
  return candidates[0].draft
}

// ==================== CELEBRATION ====================

export interface CelebrationInput {
  // Current anchor streak, from calculateStreaks (src/lib/streaks.ts) — the
  // caller computes it so this stays independent of the real clock.
  currentAnchorStreak: number
  existing: ExistingObservation[]
}

// No new thresholds: the app's one existing usage ladder is
// ANCHOR_STREAK_MILESTONES (7/14/21/30 days, the full-screen streak modal's
// own milestones), so that's what a Companion celebration keys on. Unlike
// the modal — which needs the streak to equal a milestone on exactly the
// day it happens — this takes the HIGHEST milestone the streak has reached
// and not yet recorded, so it can't be missed just because Home wasn't
// opened that specific day. Once per milestone, ever (same as the modal's
// own "celebrated" list): a streak that breaks and reaches 7 again doesn't
// re-celebrate it. Only the highest is taken, so a 25-day streak seen for
// the first time records 21, not 7 + 14 + 21.
export function detectCelebration(input: CelebrationInput): CompanionObservationDraft | null {
  const { currentAnchorStreak, existing } = input

  const reached = ANCHOR_STREAK_MILESTONES.filter((m) => m <= currentAnchorStreak)
  if (reached.length === 0) return null
  const milestone = reached[reached.length - 1]

  const dedupeKey = `anchor_streak:${milestone}`
  if (hasDedupeKey(existing, dedupeKey)) return null

  return {
    type: "celebration",
    payload: { trigger: "anchor_streak_milestone", dedupeKey, milestone, currentAnchorStreak },
  }
}

