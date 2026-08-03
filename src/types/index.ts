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

export interface MoveSuggestion {
  id: string
  user_id: string
  title: string
  category: "physical" | "social" | "mindful" | "novelty"
  is_custom: boolean
  created_at: string
}

export interface AiInsight {
  id: string
  user_id: string
  insight_text: string
  category: "mood_action_correlation" | "pattern" | "suggestion"
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
