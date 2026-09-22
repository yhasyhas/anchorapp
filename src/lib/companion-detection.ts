// Fetch -> detect -> store for the Companion's trigger detection (the pure
// rules live in src/lib/companion-triggers.ts). Runs client-side on Home
// open, same as getOrCreateWeeklyReview — no server cron. Stores rows with
// shown_at = NULL and nothing else: no text generation, no notification, no
// UI. See src/hooks/use-companion-detection.ts for the call site.
import { supabase } from "@/lib/supabase"
import i18n from "@/lib/i18n"
import { getCompass } from "@/lib/compass"
import { GOAL_STALE_WEEKS, fetchRecentlyPromptedGoalIds } from "@/lib/weekly-review"
import { listSentEncouragements } from "@/lib/circle"
import { listSentVoiceEncouragements } from "@/lib/circle-voice"
import { listOwnSosHistory } from "@/lib/circle-sos"
import { materializeDefaultSuggestions } from "@/lib/move-selection"
import { calculateStreaks } from "@/lib/streaks"
import { runOncePerPeriod } from "@/lib/once-per-period"
import { localDateStr } from "@/lib/utils"
import { weekStartStr } from "@/lib/week-dates"
import {
  detectCelebration,
  detectFirstTime,
  detectGoalGap,
  detectHardMoment,
  resolveAcceptedCategories,
  type CompanionObservationDraft,
  type ExistingObservation,
  type SuggestionCategory,
} from "@/lib/companion-triggers"
import type { DailyAnchor, MoodLog } from "@/types"

// Mood/anchor history read for the hard-moment run and the anchor streak.
// The longest streak milestone is 30 days, plus the built-in grace day.
const HISTORY_DAYS = 45

const RAN_KEY_BASE = "anchor_companion_detection_ran"

// Postgres unique_violation — the DB-level duplicate guard (see the
// companion tables' migration) firing means "this exact condition is
// already recorded", which is the desired end state, not a failure.
const UNIQUE_VIOLATION = "23505"

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

async function insertObservation(userId: string, draft: CompanionObservationDraft): Promise<boolean> {
  const { error } = await supabase
    .from("companion_observations")
    .insert({ user_id: userId, type: draft.type, payload: draft.payload })
  if (!error) return true
  if (error.code === UNIQUE_VIOLATION) return false
  throw error
}

// The static pool's titles in BOTH languages: a stored suggestion_text is
// whatever language she had on when it was shown, so matching against only
// the current language would miss the other.
function staticPoolBothLanguages(): { title: string; category: SuggestionCategory }[] {
  return (["en", "sw"] as const).flatMap((lng) => {
    const fixed = i18n.getFixedT(lng)
    return materializeDefaultSuggestions((key) => String(fixed(key))).map((s) => ({
      title: s.title,
      category: s.category,
    }))
  })
}

// Circle activity she can actually read back from the client: Circle tables
// are RPC-only, so this is the three "sent by me" lists (encouragement,
// voice encouragement, SOS). Each is capped at her latest 50 by its own
// RPC, which is plenty — only the latest gaps matter. A failing/empty read
// just means no Circle signal this run, never a failed detection.
async function fetchCircleActionDates(): Promise<string[]> {
  const [encouragements, voices, sos] = await Promise.all([
    listSentEncouragements().catch(() => []),
    listSentVoiceEncouragements().catch(() => []),
    listOwnSosHistory().catch(() => []),
  ])
  return [
    ...encouragements.map((e) => e.created_at),
    ...voices.map((v) => v.created_at),
    ...sos.map((s) => s.createdAt),
  ].map((ts) => localDateStr(new Date(ts)))
}

export interface CompanionDetectionResult {
  observationsCreated: string[]
}

export interface CompanionDetectionSubject {
  userId: string
  // profiles.ai_enabled — Settings' "Enable AI insights" toggle (default
  // false, opt-in). The Companion is an AI-adjacent feature, so with it off
  // nothing here runs at all. See the guard at the top of both entry points.
  aiEnabled: boolean
}

const NOTHING_DETECTED: CompanionDetectionResult = { observationsCreated: [] }

// One full detection pass. Throws if a core read or an insert fails (a
// duplicate is not a failure) so the caller can leave the once-a-day flag
// unset and retry next session.
//
// Guard first: with "Enable AI insights" off this returns immediately —
// before any read, before any insert, leaving nothing behind. (The weekly
// ritual row this used to also create here — companion_weekly_checkins —
// was folded into weekly_reviews.companion_text; see
// src/lib/companion-generation.ts, which reads/writes that instead.)
export async function runCompanionDetection(
  subject: CompanionDetectionSubject,
  now: Date = new Date()
): Promise<CompanionDetectionResult> {
  if (!subject.aiEnabled) return NOTHING_DETECTED

  const { userId } = subject
  const today = localDateStr(now)
  const historyFloor = addDays(today, -HISTORY_DAYS)
  const weekStart = weekStartStr(now)

  const [moodsRes, anchorsRes, acceptedRes, moveRes, observationsRes, compass, recentlyPromptedGoalIds] =
    await Promise.all([
      supabase.from("mood_logs").select("*").eq("user_id", userId).gte("date", historyFloor),
      supabase.from("daily_anchors").select("*").eq("user_id", userId).gte("date", historyFloor),
      supabase
        .from("daily_suggestions")
        .select("date,suggestion_text,source_move_item_id")
        .eq("user_id", userId)
        .eq("status", "accepted"),
      supabase.from("move_suggestions").select("id,title,category").eq("user_id", userId),
      supabase.from("companion_observations").select("type,payload,acknowledged").eq("user_id", userId),
      getCompass(userId),
      // The exact same cooldown state pickGoalToPrompt uses for the weekly
      // review's own goal question (weekly-review.ts) — see detectGoalGap's
      // own comment for why this can't be a separate, independently-tracked
      // cooldown any more.
      fetchRecentlyPromptedGoalIds(userId, weekStart),
    ])
  for (const res of [moodsRes, anchorsRes, acceptedRes, moveRes, observationsRes]) {
    if (res.error) throw res.error
  }

  const moods = (moodsRes.data ?? []) as MoodLog[]
  const anchors = (anchorsRes.data ?? []) as DailyAnchor[]
  const acceptedRows = (acceptedRes.data ?? []) as {
    date: string
    suggestion_text: string
    source_move_item_id: string | null
  }[]
  const moveRows = (moveRes.data ?? []) as { id: string; title: string; category: SuggestionCategory }[]
  // Read once for the whole run. The four detectors emit at most one draft
  // each and never the same dedupeKey, so they don't need to see each
  // other's inserts; the DB's unique indexes cover any race beyond that.
  const existing = (observationsRes.data ?? []) as ExistingObservation[]

  const acceptedWithCategory = resolveAcceptedCategories(
    acceptedRows.map((r) => ({ date: r.date, text: r.suggestion_text, sourceMoveItemId: r.source_move_item_id })),
    moveRows,
    staticPoolBothLanguages()
  )
  const circleActionDates = await fetchCircleActionDates()
  const currentAnchorStreak = calculateStreaks(moods, anchors).currentAnchorStreak

  // Same GOAL_STALE_WEEKS window weekly-review.ts's own fetchAcceptedTitlesSince
  // applies via a DB query — done in-memory here since acceptedRows already
  // has the full all-time history fetched above for the other detectors.
  const staleFloor = addDays(today, -GOAL_STALE_WEEKS * 7)
  const acceptedTitlesSinceStale = acceptedRows
    .filter((r) => r.date >= staleFloor)
    .map((r) => ({ title: r.suggestion_text }))

  const drafts = [
    detectHardMoment({ moods, today, existing }),
    detectGoalGap({
      goals: compass?.goals ?? [],
      acceptedTitlesSinceStale,
      recentlyPromptedGoalIds,
      today,
      existing,
    }),
    detectFirstTime({ accepted: acceptedWithCategory, circleActionDates, today, existing }),
    detectCelebration({ currentAnchorStreak, existing }),
  ]

  const observationsCreated: string[] = []
  for (const draft of drafts) {
    if (!draft) continue
    if (await insertObservation(userId, draft)) {
      observationsCreated.push(draft.payload.dedupeKey)
    }
  }

  return { observationsCreated }
}

// Runs the detection at most once per user per local day — the shared
// once-per-period guard (src/lib/once-per-period.ts) against StrictMode
// double-effects / Home remounting while a run is in flight or has just
// failed, same mechanism companion-generation.ts's OncePerDay wrapper and
// weekly-review.ts's own once-per-week check use. A failed run leaves the
// persisted flag unset (so the next session retries) but isn't retried
// again within the same page load.
export async function runCompanionDetectionOncePerDay(
  subject: CompanionDetectionSubject,
  now: Date = new Date()
): Promise<CompanionDetectionResult | null> {
  // Checked before the once-a-day bookkeeping on purpose: a skipped run
  // must not burn today's slot, or turning the toggle on later the same day
  // would still be locked out until tomorrow.
  if (!subject.aiEnabled) return null

  return runOncePerPeriod(RAN_KEY_BASE, subject.userId, localDateStr(now), () => runCompanionDetection(subject, now))
}
