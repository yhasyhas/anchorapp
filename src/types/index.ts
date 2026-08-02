export interface Profile {
  id: string
  full_name: string
  preferred_language: "en" | "sw"
  ai_enabled: boolean
  ai_checkins_enabled: boolean
  timezone: string
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
  evening_release: string
  evening_mood: string | null  // ← AJOUTÉ
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
