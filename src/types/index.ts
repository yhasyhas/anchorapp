export type Tone = "gentle" | "direct" | "poetic"

export interface Profile {
  id: string
  full_name: string
  preferred_language: "en" | "sw"
  ai_enabled: boolean
  ai_checkins_enabled: boolean
  timezone: string
  tone: Tone
  onboarded_at: string | null
  share_presence_enabled: boolean
  soft_mode: boolean
  soft_mode_since: string | null
  created_at: string
}

export interface DailyAnchor {
  id: string
  user_id: string
  date: string
  future_task: string
  future_completed: boolean
  mindbody_task: string
  mindbody_completed: boolean
  life_task: string
  life_completed: boolean
  daily_intention: string
  anchors_locked_at: string | null
  // True when this day's row was saved while soft mode was active — see
  // isAnchorDayComplete in src/lib/streaks.ts for how this changes what
  // counts as a "complete" anchor day for streak purposes.
  soft_mode_day: boolean
  created_at: string
}

export interface MoodLog {
  id: string
  user_id: string
  date: string
  mood: MoodType
  timestamp: string
}

export type MoodType = "great" | "okay" | "meh" | "low" | "stressed"

export interface CheckIn {
  id: string
  user_id: string
  date: string
  what_matters: string
  what_avoiding: string
  what_felt_real: string
  voice_note_url: string | null
  voice_transcript: string | null
  evening_release: string
  evening_mood: string | null  // ← AJOUTÉ
  evening_mood_note: string
  // NULL = not yet attempted today (by any device), '' = attempted and
  // resolved to "no personalization", non-empty = the resolved question.
  // See supabase/migrations/20260803170000_add_check_in_personal_question.sql
  personal_question: string | null
  created_at: string
}

export type AnchorCategory = "future" | "mindbody" | "life"

export interface MoveSuggestion {
  id: string
  user_id: string
  title: string
  category: "physical" | "social" | "mindful" | "novelty" | "creative" | "rest"
  // Exactly one of the app's 3 daily anchor types this move is meant to
  // fill — see supabase/migrations/20260806140000_add_anchor_category_to_move_suggestions.sql.
  anchor_category: AnchorCategory
  is_custom: boolean
  // 'user' for customs, 'ai' for the weekly Groq-generated batch — the
  // hardcoded static pool is never a DB row at all.
  generated_by: "user" | "ai"
  // ISO week the AI batch was generated for (see getWeekKey in ai-service.ts),
  // null for customs. Drives the "archive last week's AI batch" filter.
  week_key: string | null
  is_favorite: boolean
  intensity: "gentle" | "standard" | "ambitious"
  created_at: string
}

export interface Gratitude {
  id: string
  user_id: string
  text: string
  created_at: string
}

export interface AiInsight {
  id: string
  user_id: string
  insight_text: string
  category: "mood_action_correlation" | "pattern" | "suggestion"
  created_at: string
}

// Archived AI-generated Patterns insights — see insight_log migration and
// logInsightHistory in src/lib/ai-service.ts.
export interface InsightLogEntry {
  id: string
  week_key: string
  text: string
  category: string
  created_at: string
}

export interface JournalEntry {
  id: string
  user_id: string
  date: string
  sentence: string
  created_at: string
}

export interface NotificationPreferences {
  user_id: string
  reminders_enabled: boolean
  morning_enabled: boolean
  midday_enabled: boolean
  evening_enabled: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: number
  quiet_hours_end: number
  updated_at: string
}

export interface WeeklyLetterHighlights {
  dominantIntention: string | null
  moodCounts: Record<string, number>
  anchorsCompletedDays: number
  totalDaysLogged: number
  // Consecutive days (ending on week_end) with all 3 anchors completed,
  // computed within this single week only — not the same figure as Home's
  // multi-week grace-day anchor streak (see src/lib/streaks.ts), which needs
  // a wider historical window this weekly aggregation doesn't fetch.
  anchorStreakThisWeek: number
  bestJournalSentence: string | null
  bestJournalDate: string | null
}

export interface WeeklyLetter {
  id: string
  user_id: string
  week_start: string
  week_end: string
  letter_text: string
  highlights: WeeklyLetterHighlights
  shared_with_circle: boolean
  created_at: string
}

export interface ProgressStoryWeekStat {
  weekStart: string
  weekEnd: string
  dominantIntention: string | null
  // 1-5 scale (see moodToValue in src/lib/constants.ts), null when no mood
  // was logged that week at all — distinct from a low average.
  avgMoodValue: number | null
  moodCounts: Record<string, number>
  anchorsCompletedDays: number
  activeDays: number
}

export interface ProgressStoryStats {
  // Chronological, oldest first — always length 3: [3 weeks ago, 2 weeks ago, this week]
  weeks: ProgressStoryWeekStat[]
  topIntentions: { intention: string; days: number }[]
  // % of days-with-any-anchor-task where all 3 were completed, over the
  // full 21-day window — not the same denominator as a raw 21-day average.
  completionRate: number
  totalActiveDays: number
}

export interface ProgressStory {
  id: string
  user_id: string
  period_start: string
  period_end: string
  story_text: string
  stats: ProgressStoryStats
  created_at: string
}

export interface WrappedMoodTrend {
  thisMonthAvg: number | null
  prevMonthAvg: number | null
}

export interface WrappedJournalHighlight {
  date: string
  sentence: string
}

export interface WrappedStats {
  daysPresent: number
  dominantIntention: string | null
  dominantIntentionDays: number
  bestMoodStreak: number
  bestAnchorStreak: number
  gratitudeCount: number
  journalHighlight: WrappedJournalHighlight | null
  moodTrend: WrappedMoodTrend
  // Dominant daily_intention in the first vs second half of the month —
  // feeds the "you started the month seeking X, you ended it choosing Y"
  // evolution sentence (see src/lib/wrapped.ts).
  startIntention: string | null
  endIntention: string | null
  // Top 1-2 Compass values (canonical English strings, see COMPASS_VALUES
  // in src/lib/compass.ts) her accepted daily suggestions leaned toward
  // this month — null when she has no Compass, had fewer than 3 accepted
  // suggestions, or none matched any of her values. Optional (not just
  // nullable) because a recap generated before this field existed has no
  // such key in its stored jsonb at all — every reader treats a missing
  // key the same as null (section hidden); recaps are snapshots and are
  // never backfilled.
  compassTopValues?: string[] | null
  // Compass goal texts (snapshotted at generation time) that no accepted
  // suggestion this month resonated with — a quiet mirror, never a
  // question (contrast the weekly review, which actually asks about one
  // stale goal). Null when there's nothing to show: no Compass goals at
  // all, or every goal was touched this month. Optional for the same
  // "older recap predates this field" reason as compassTopValues above.
  untouchedGoalTexts?: string[] | null
}

export interface MonthlyRecap {
  id: string
  user_id: string
  month_start: string
  month_end: string
  evolution_sentence: string
  stats: WrappedStats
  created_at: string
}

// Native (Capacitor/FCM) push registration — see src/lib/push.ts's native
// branch. Separate from the Web Push subscription shape stored in
// push_subscriptions; only the native app writes rows here.
export type PushTokenPlatform = "ios" | "android"

export interface PushToken {
  id: string
  user_id: string
  platform: PushTokenPlatform
  token: string
  created_at: string
  updated_at: string
}

// Compass — the optional "foundations" pillar (product spec section 3):
// values, vision, goals, future self. One row per user (user_compass,
// UNIQUE on user_id); absent until the first explicit save.
export interface CompassGoal {
  id: string
  text: string
  created_at: string
}

export interface Compass {
  id: string
  user_id: string
  // Canonical English value strings (see COMPASS_VALUES in src/lib/compass.ts),
  // displayed via t(`compass.values.<lowercased>`) — same store-English /
  // display-translated convention as daily_intention.
  value_tags: string[]
  vision: string
  goals: CompassGoal[]
  future_self: string
  updated_at: string
  created_at: string
}

// Daily suggestion — one gentle action offered at the top of Home, drawn
// from the Move pool (see src/lib/daily-suggestion.ts). One row per user
// per day (daily_suggestions, UNIQUE on user_id,date); upserted like the
// daily anchor. None of the statuses feed the streak.
export type DailySuggestionStatus = "pending" | "accepted" | "declined" | "snoozed"

export interface DailySuggestion {
  id: string
  user_id: string
  date: string
  // move_suggestions row id when the pick was a real DB row, null when it
  // came from the hardcoded static pool (no DB row) — see the migration.
  source_move_item_id: string | null
  // Snapshot of the text shown that day; the card reads this directly.
  suggestion_text: string
  status: DailySuggestionStatus
  responded_at: string | null
  follow_up_shown: boolean
  follow_up_response: string | null
  created_at: string
  updated_at: string
}

// User-created intention, alongside the 5 hardcoded native ones in
// src/lib/constants.ts — see src/lib/custom-intentions.ts and
// src/lib/intentions.ts for how these are created/resolved for display.
export interface CustomIntention {
  id: string
  user_id: string
  label_en: string
  label_sw: string
  is_archived: boolean
  created_at: string
}

export type CircleMembershipStatus = "pending" | "active" | "declined"

export interface CircleMembership {
  id: string
  user_id: string
  friend_id: string
  status: CircleMembershipStatus
  invited_by: string
  invited_at: string
  accepted_at: string | null
}

export type CircleInviteStatus = "pending" | "accepted"

export interface CircleInvite {
  id: string
  token: string
  inviter_id: string
  invitee_email: string
  status: CircleInviteStatus
  created_at: string
  expires_at: string
}

export const ENCOURAGEMENT_PRESET_KEYS = [
  "thinking_of_you",
  "proud_of_you",
  "one_gentle_step",
  "sending_warmth",
  "you_are_doing_great",
  "here_for_you",
  "small_steps_count",
  "holding_you_gently",
] as const

export type EncouragementPresetKey = (typeof ENCOURAGEMENT_PRESET_KEYS)[number]

// Received encouragements have `read_at`; sent ones never do — the RPC that
// lists sent encouragements has no read_at column at all (see the migration
// comment), so a sender can never learn whether her message was read.
export interface CircleEncouragement {
  id: string
  message: string
  is_preset: boolean
  created_at: string
}

export interface ReceivedEncouragement extends CircleEncouragement {
  sender_id: string
  read_at: string | null
}

export interface SentEncouragement extends CircleEncouragement {
  recipient_id: string
}

export interface CirclePresence {
  friend_id: string
  present: boolean
}

export interface SharedLetter {
  friend_id: string
  week_start: string
  week_end: string
  letter_text: string
}

export interface CircleVoiceEncouragement {
  id: string
  storage_path: string
  duration_seconds: number
  created_at: string
  reply_to_id: string | null
}

export interface ReceivedVoiceEncouragement extends CircleVoiceEncouragement {
  sender_id: string
  read_at: string | null
}

export interface SentVoiceEncouragement extends CircleVoiceEncouragement {
  recipient_id: string
}

export type CircleSharedIntentionStatus = "pending" | "accepted" | "declined"

export interface CircleSharedIntention {
  id: string
  proposer_id: string
  recipient_id: string
  intention: string
  status: CircleSharedIntentionStatus
  proposed_at: string
}

export interface CircleGraceGift {
  id: string
  sender_id: string
  sent_at: string
}

// Weekly shared ritual — one question, one thread per active friendship
// (see supabase/migrations/20260915120000_create_circle_weekly_ritual.sql
// for why this is pairwise, not per-N-person-circle). `responses` and
// `otherAnswered` are only ever populated once `myResponse` is set — the
// RPC itself withholds them until then, this shape just carries that
// through to the client.
export interface CircleWeeklyRitualResponse {
  userId: string
  response: string
}

export interface CircleWeeklyRitual {
  promptId: string
  weekKey: string
  promptKey: string
  myResponse: string | null
  otherAnswered: boolean | null
  revealed: boolean
  responses: CircleWeeklyRitualResponse[] | null
}

export interface CircleWeeklyRitualHistoryEntry {
  weekKey: string
  promptKey: string
  myResponse: string
  friendResponse: string
  createdAt: string
}

export interface CircleStreakAlert {
  friend_id: string
  absent: boolean
}

export interface CircleMilestone {
  friend_id: string
  milestone: number
  reached_at: string
}

// Metadata only — `content` deliberately isn't part of this shape, since
// it's never selectable from the client until deliver_on arrives (see
// supabase/migrations/20260807120000_create_future_letters.sql). Fetch it
// via the get_future_letter_content(id) RPC once due.
export interface FutureLetter {
  id: string
  user_id: string
  written_at: string
  deliver_on: string
  delivered_at: string | null
  opened_at: string | null
}

// Optional deeper evening reflection — additive alongside the evening
// check-in and Journal, never required. One row per user per day
// (reflections, UNIQUE on user_id,date), absent until the first explicit save.
export interface Reflection {
  id: string
  user_id: string
  date: string
  meaningful_today: string
  learned_today: string
  better_tomorrow: string
  created_at: string
}

// Daily awe thought — one small factual/perspective-giving thought shown
// once per day on Home (see src/lib/awe-thought.ts). awe_thoughts is a
// shared reference catalog (every user reads the same rows), NOT per-user.
export type AweThoughtCategory = "psychology" | "nature" | "philosophy" | "art" | "space" | "people"

export interface AweThought {
  id: string
  category: AweThoughtCategory
  content_en: string
  content_sw: string
  source_note: string | null
  created_at: string
}

// One row per user per day (awe_thought_shown, UNIQUE on user_id,date) —
// which catalog entry she got today, and whether she's seen it yet.
export interface AweThoughtShown {
  id: string
  user_id: string
  awe_thought_id: string
  date: string
  opened: boolean
  created_at: string
}

// Rule-based weekly review — one row per user per Monday-Sunday week (see
// src/lib/weekly-review.ts). Never a verdict: a factual mirror of the
// week's activity, generated once and then read as-is.
export type WeeklyReviewStatus = "pending" | "shown" | "dismissed"
export type WeeklyReviewGoalResponse = "still_true" | "changed" | "prefer_not"

// The exact computed values behind this week's sentences — stored so the
// review stays stable even if the computation logic changes later (same
// reasoning as monthly_recaps.stats for Wrapped).
export interface WeeklyReviewSnapshot {
  weekStart: string
  weekEnd: string
  acceptedCount: number
  declinedCount: number
  // 1-2 Compass values, or null when there wasn't enough signal (or no
  // Compass) to say anything meaningful this week.
  dominantValues: string[] | null
  // The text of the goal this week's review asked about, if any — snapshot
  // of the goal at prompt time, since user_compass.goals can change later.
  goalPromptedText: string | null
}

export interface WeeklyReview {
  id: string
  user_id: string
  week_start: string
  status: WeeklyReviewStatus
  summary_snapshot: WeeklyReviewSnapshot
  goal_prompted_id: string | null
  goal_response: WeeklyReviewGoalResponse | null
  // Stamped by api/cron/reminders.ts once the "your week in review is
  // ready" push has gone out for this row — never written by the client.
  notification_sent_at: string | null
  created_at: string
}

// Display-ready shape returned by getTodaysAweThought — already resolved
// to the caller's language, so the card never has to know about content_en
// vs content_sw.
export interface TodaysAweThought {
  category: AweThoughtCategory
  content: string
  sourceNote: string | null
  opened: boolean
}
