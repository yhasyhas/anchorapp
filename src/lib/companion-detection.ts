// Fetch -> detect -> store for the Companion's trigger detection (the pure
// rules live in src/lib/companion-triggers.ts). Runs client-side on Home
// open, same as getOrCreateWeeklyReview — no server cron. Stores rows with
// shown_at = NULL and nothing else: no text generation, no notification, no
// UI. See src/hooks/use-companion-detection.ts for the call site.
import { supabase } from "@/lib/supabase"
import i18n from "@/lib/i18n"
import { getCompass } from "@/lib/compass"
import { listSentEncouragements } from "@/lib/circle"
import { listSentVoiceEncouragements } from "@/lib/circle-voice"
import { listOwnSosHistory } from "@/lib/circle-sos"
import { materializeDefaultSuggestions } from "@/lib/move-selection"
import { calculateStreaks } from "@/lib/streaks"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import { localDateStr } from "@/lib/utils"
import {
  detectCelebration,
  detectFirstTime,
  detectGoalGap,
  detectHardMoment,
  planWeeklyCheckin,
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
  weeklyCheckinCreated: boolean
}

// One full detection pass. Throws if a core read or an insert fails (a
// duplicate is not a failure) so the caller can leave the once-a-day flag
// unset and retry next session.
export async function runCompanionDetection(
  userId: string,
  profileCreatedAt: string,
  now: Date = new Date()
): Promise<CompanionDetectionResult> {
  const today = localDateStr(now)
  const historyFloor = addDays(today, -HISTORY_DAYS)

  const [moodsRes, anchorsRes, acceptedRes, moveRes, observationsRes, compass] = await Promise.all([
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

  const drafts = [
    detectHardMoment({ moods, today, existing }),
    detectGoalGap({
      goals: compass?.goals ?? [],
      accepted: acceptedRows.map((r) => ({ date: r.date, title: r.suggestion_text })),
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

  // Weekly ritual: a plain row, only on the eligible Sunday.
  let weeklyCheckinCreated = false
  const weekly = planWeeklyCheckin({ now, profileCreatedAt, existingWeekStarts: [] })
  if (weekly) {
    // Only read this week's rows when the (cheap) date/tenure checks already
    // passed — every other day of the week skips the query entirely.
    const { data, error } = await supabase
      .from("companion_weekly_checkins")
      .select("week_start")
      .eq("user_id", userId)
      .eq("week_start", weekly.week_start)
    if (error) throw error
    const existingWeekStarts = ((data ?? []) as { week_start: string }[]).map((r) => r.week_start)
    if (planWeeklyCheckin({ now, profileCreatedAt, existingWeekStarts })) {
      const { error: insertError } = await supabase
        .from("companion_weekly_checkins")
        .insert({ user_id: userId, week_start: weekly.week_start, status: "pending" })
      if (!insertError) weeklyCheckinCreated = true
      else if (insertError.code !== UNIQUE_VIOLATION) throw insertError
    }
  }

  return { observationsCreated, weeklyCheckinCreated }
}

// Session-level guard against StrictMode double-effects / Home remounting
// while a run is in flight or has just failed: one attempt per user per day
// per page load. A successful run additionally persists its date in
// localStorage, so later sessions the same day skip even the attempt.
const attemptedThisSession = new Set<string>()

// Runs the detection at most once per user per local day. Not called per
// render: the hook calls it from an effect keyed on the user, and this
// guard turns repeat calls into a cheap no-op. A failed run leaves the
// persisted flag unset (so the next session retries) but isn't retried
// again within the same page load.
export async function runCompanionDetectionOncePerDay(
  userId: string,
  profileCreatedAt: string,
  now: Date = new Date()
): Promise<CompanionDetectionResult | null> {
  const today = localDateStr(now)
  const sessionKey = `${userId}:${today}`
  if (attemptedThisSession.has(sessionKey)) return null
  if (getUserLocalData<string>(RAN_KEY_BASE, userId) === today) return null
  attemptedThisSession.add(sessionKey)

  const result = await runCompanionDetection(userId, profileCreatedAt, now)
  setUserLocalData(RAN_KEY_BASE, userId, today)
  return result
}
