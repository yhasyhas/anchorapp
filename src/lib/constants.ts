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
