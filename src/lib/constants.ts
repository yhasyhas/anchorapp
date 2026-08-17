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

// `icon` is additive — `emoji`/`color` stay untouched since checkin.tsx's
// evening mood picker still consumes them; only home.tsx's mood selector
// (anchor-web-spec.md) has moved to the signature mood-* icons so far.
export const moodConfig = [
  { key: "great" as const, emoji: "\u{1F60A}", color: colors.moodGreat, icon: "mood-great" as const },
  { key: "okay" as const, emoji: "\u{1F642}", color: colors.moodOkay, icon: "mood-okay" as const },
  { key: "meh" as const, emoji: "\u{1F610}", color: colors.moodMeh, icon: "mood-meh" as const },
  { key: "low" as const, emoji: "\u{1F641}", color: colors.moodLow, icon: "mood-low" as const },
  { key: "stressed" as const, emoji: "\u{1F623}", color: colors.moodStressed, icon: "mood-stressed" as const },
] as const

// Per-mood ink stroke color — anchor-redesign-spec.md section 3's table.
// Consumed by home.tsx's mood selector so its selected icon/label tint
// matches the native app's mood card exactly (see feature/capacitor-mobile's
// src/pages/home.tsx, which this mirrors). CSS vars rather than literal hex
// so each mood stays legible in both themes (see src/index.css's
// --mood-ink-*/--mood-wash-*, brought over in the design-system merge).
export const moodInk: Record<"great" | "okay" | "meh" | "low" | "stressed", string> = {
  great: "var(--mood-ink-great)",
  okay: "var(--mood-ink-okay)",
  meh: "var(--mood-ink-meh)",
  low: "var(--mood-ink-low)",
  stressed: "var(--mood-ink-stressed)",
}

// Soft tinted-circle background behind the selected mood.
export const moodWash: Record<"great" | "okay" | "meh" | "low" | "stressed", string> = {
  great: "var(--mood-wash-great)",
  okay: "var(--mood-wash-okay)",
  meh: "var(--mood-wash-meh)",
  low: "var(--mood-wash-low)",
  stressed: "var(--mood-wash-stressed)",
}

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
