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
