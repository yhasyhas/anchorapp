// A discreet, one-time welcome-back message when she returns on her own
// after a long stretch of inactivity — never pushed (no notification, see
// the reminders cron's own 3-strikes circuit breaker for the opposite
// concern: pausing outbound nudges after inactivity, not welcoming a
// return), never a day count, never framed as "you fell behind".
//
// "Last significant activity" is deliberately NOT the same thing streaks
// already track (calculateBestStreakFromDates in src/lib/streaks.ts is
// mood-only, and api/cron/reminders.ts's 3-strikes circuit breaker looks at
// mood_logs/daily_anchors/check_ins/daily_suggestions/reflections/
// weekly_reviews, but not Journal) — this spec explicitly asks for mood
// check-in, a suggestion response, Journal, or Reflection, so it's its own
// small computation rather than reusing either of those.
import { supabase } from "@/lib/supabase"
import { localDateStr } from "@/lib/utils"

export const WELCOME_BACK_ABSENCE_DAYS = 21

export interface LastActivityDates {
  moodDate: string | null
  // daily_suggestions.date for the most recent row she actually responded
  // to (accepted or declined) — a still-pending suggestion isn't a
  // response. Using the suggestion's own `date` column (not responded_at)
  // keeps every source here a plain calendar date, not a mix of dates and
  // timestamps.
  suggestionRespondedDate: string | null
  journalDate: string | null
  reflectionDate: string | null
}

function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

// The most recent (largest) of the given calendar dates, or null when none
// exist at all — a brand-new user with no activity in any of these 4 tables
// has no "last activity" to measure an absence against, so there's no
// return to welcome her back from.
function latestDate(dates: (string | null)[]): string | null {
  const present = dates.filter((d): d is string => !!d)
  if (present.length === 0) return null
  return present.reduce((latest, d) => (dayIndex(d) > dayIndex(latest) ? d : latest))
}

export function daysSinceDate(dateStr: string, now: Date = new Date()): number {
  return dayIndex(localDateStr(now)) - dayIndex(dateStr)
}

// True exactly when both hold:
//  1. Her last significant activity is at least WELCOME_BACK_ABSENCE_DAYS
//     ago (or she has none at all -> false, see latestDate above).
//  2. She hasn't already been shown the message for THIS same absence
//     stretch. welcome_back_shown_at only suppresses a re-show while it's
//     still at or after her last significant activity — i.e., nothing new
//     has happened since we last showed it. The moment fresh activity
//     lands after that stamp, this naturally re-arms for the NEXT absence
//     stretch without any separate "reset" step: a later ≥21-day gap
//     measured from that new activity date will pass this check again.
export function isWelcomeBackEligible(
  dates: LastActivityDates,
  welcomeBackShownAt: string | null,
  now: Date = new Date()
): boolean {
  const last = latestDate([dates.moodDate, dates.suggestionRespondedDate, dates.journalDate, dates.reflectionDate])
  if (last === null) return false
  if (daysSinceDate(last, now) < WELCOME_BACK_ABSENCE_DAYS) return false
  if (!welcomeBackShownAt) return true
  return dayIndex(localDateStr(new Date(welcomeBackShownAt))) < dayIndex(last)
}

interface DateRow {
  date: string
}

async function latestRowDate(
  table: "mood_logs" | "journal_entries" | "reflections",
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from(table)
    .select("date")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as DateRow | null)?.date ?? null
}

async function latestRespondedSuggestionDate(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("daily_suggestions")
    .select("date")
    .eq("user_id", userId)
    .in("status", ["accepted", "declined"])
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as DateRow | null)?.date ?? null
}

// Never throws — a read failure on any one source just resolves that
// source to null (treated as "no activity there"), same fail-soft posture
// as getCompassValueTags: worst case, the banner simply doesn't show this
// time rather than erroring out Home.
export async function getLastActivityDates(userId: string): Promise<LastActivityDates> {
  const [moodDate, suggestionRespondedDate, journalDate, reflectionDate] = await Promise.all([
    latestRowDate("mood_logs", userId).catch(() => null),
    latestRespondedSuggestionDate(userId).catch(() => null),
    latestRowDate("journal_entries", userId).catch(() => null),
    latestRowDate("reflections", userId).catch(() => null),
  ])

  return {
    moodDate,
    suggestionRespondedDate,
    journalDate,
    reflectionDate,
  }
}
