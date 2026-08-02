export const colors = {
  bgPrimary: "var(--background)",
  bgSecondary: "var(--secondary)",
  cardBg: "var(--card)",
  sage: "var(--sage)",
  sageLight: "var(--sage-light)",
  rose: "var(--rose-accent)",
  lavender: "var(--lavender)",
  peach: "var(--peach)",
  textPrimary: "var(--foreground)",
  textSecondary: "var(--muted-foreground)",
  moodGreat: "var(--peach)",
  moodOkay: "var(--sage-light)",
  moodMeh: "var(--lavender)",
  moodLow: "var(--rose-accent)",
  moodStressed: "var(--mood-stressed)",
} as const

export const moodConfig = [
  { key: "great" as const, emoji: "\u{1F60A}", color: colors.moodGreat },
  { key: "okay" as const, emoji: "\u{1F642}", color: colors.moodOkay },
  { key: "meh" as const, emoji: "\u{1F610}", color: colors.moodMeh },
  { key: "low" as const, emoji: "\u{1F641}", color: colors.moodLow },
  { key: "stressed" as const, emoji: "\u{1F623}", color: colors.moodStressed },
] as const

export const moodToValue: Record<string, number> = {
  great: 5,
  okay: 4,
  meh: 3,
  low: 2,
  stressed: 1,
}

export const intentions = [
  "Clarity",
  "Courage",
  "Love",
  "Abundance",
  "Peace",
] as const

// The voice used for all AI-generated messages (companion, weekly letter, progress story,
// human reminders) — see src/types/index.ts's `Tone` and supabase/migrations/
// 20260803120000_add_tone_and_onboarded_at_to_profiles.sql. Order here drives display order
// in both the onboarding tone picker and Settings.
export const tones = ["gentle", "direct", "poetic"] as const

// "What brings you here?" — a one-time, optional onboarding question distinct from the daily
// `intentions` above (different concept: a life motivation picked once, not a rotating daily
// anchor), kept as its own list so the two never get conflated even where the words overlap.
export const lifeIntentions = ["clarity", "peace", "discipline", "healing"] as const

// localStorage base key (see src/lib/user-storage.ts's userKey scoping) for the optional
// "what brings you here" chip picked at onboarding — written once by onboarding-modal.tsx,
// read and cleared once by home.tsx so it only ever enriches the very first companion message.
export const FIRST_INTENTION_KEY_BASE = "anchor_first_intention"
