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
import { goalKeywords, untouchedGoals } from "@/lib/goal-matching"
import { ANCHOR_STREAK_MILESTONES } from "@/lib/streaks"
import { localDateStr } from "@/lib/utils"
import { isWeeklyReviewEligibleDay, weekStartStr } from "@/lib/week-dates"
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

// Goal gap: a Compass goal is a "gap" once it has existed at least this long
// AND none of the accepted suggestions in that same trailing window resonate
// with it. Deliberately longer than weekly-review's GOAL_STALE_WEEKS (4):
// the weekly card asks a light question, a Companion observation is a
// stronger claim and shouldn't fire on a short lull.
export const GOAL_GAP_WEEKS = 6

// How far back a "first time" event may sit and still be picked up. The
// detectors run on Home open (about once a day), so this only has to bridge
// a few days without opening the app — and it stops the very first run
// after this ships from retroactively announcing old firsts.
export const FIRST_TIME_LOOKBACK_DAYS = 7

// Circle "return": her latest Circle action came at least this long after
// the one before it.
export const CIRCLE_RETURN_ABSENCE_DAYS = 60

// Weekly ritual: only for accounts at least this old.
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
  // Every accepted daily suggestion she has (any age) — the detector applies
  // the GOAL_GAP_WEEKS window itself.
  accepted: { date: string; title: string }[]
  today: string
  existing: ExistingObservation[]
}

// A Compass goal with no matching accepted suggestion for GOAL_GAP_WEEKS
// weeks. Matching is untouchedGoals from src/lib/goal-matching.ts — the same
// keyword match weekly-review and Wrapped use, not a second implementation.
//
// Three extra conditions, all specific to a gap being a *claim* about her:
//  - the goal must be old enough to have had the whole window (a goal she
//    set last week has no gap yet);
//  - the goal must yield matchable keywords at all — untouchedGoals counts
//    an unmatchable goal as "no match" (a fine default for the weekly
//    card's light question), but the Companion shouldn't tell her she's
//    neglected a goal the matcher was never able to evaluate;
//  - once per goal, ever: an existing gap observation for the same goal id,
//    acknowledged or not, blocks it.
// Returns the oldest qualifying goal; the rest surface on later runs, one
// at a time, rather than arriving together.
export function detectGoalGap(input: GoalGapInput): CompanionObservationDraft | null {
  const { goals, accepted, today, existing } = input

  const windowStart = addDays(today, -GOAL_GAP_WEEKS * 7)
  const acceptedInWindow = accepted.filter((a) => a.date >= windowStart).map((a) => ({ title: a.title }))

  const candidates = goals.filter(
    (g) =>
      localDateStr(new Date(g.created_at)) <= windowStart &&
      goalKeywords(g.text).length > 0 &&
      !hasDedupeKey(existing, `gap:${g.id}`)
  )

  const gaps = untouchedGoals(candidates, acceptedInWindow)
  if (gaps.length === 0) return null

  const goal = [...gaps].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
  return {
    type: "gap",
    payload: {
      trigger: "goal_gap",
      dedupeKey: `gap:${goal.id}`,
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

// ==================== WEEKLY RITUAL ====================

export interface WeeklyCheckinInput {
  now: Date
  // profiles.created_at.
  profileCreatedAt: string
  // week_start of every companion_weekly_checkins row she already has.
  existingWeekStarts: string[]
}

// Not a detection, just the decision to create this week's pending row:
// it's Sunday (same eligible day as the weekly review), the account is at
// least WEEKLY_CHECKIN_MIN_TENURE_DAYS old, and no row exists yet for this
// week's Monday. UNIQUE (user_id, week_start) backs the last condition in
// the database.
export function planWeeklyCheckin(input: WeeklyCheckinInput): { week_start: string } | null {
  const { now, profileCreatedAt, existingWeekStarts } = input

  if (!isWeeklyReviewEligibleDay(now)) return null

  const tenureMs = now.getTime() - new Date(profileCreatedAt).getTime()
  if (!(tenureMs >= WEEKLY_CHECKIN_MIN_TENURE_DAYS * 86400000)) return null

  const weekStart = weekStartStr(now)
  if (existingWeekStarts.includes(weekStart)) return null

  return { week_start: weekStart }
}
