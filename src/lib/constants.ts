export const colors = {
  bgPrimary: "#F9F7F2",
  bgSecondary: "#F5F1E8",
  cardBg: "#FDFBF7",
  sage: "#7A8B6E",
  sageLight: "#E8EDE5",
  rose: "#E8C4C4",
  lavender: "#D4C5E8",
  peach: "#F5D5C5",
  textPrimary: "#3D3D3D",
  textSecondary: "#8A8A8A",
  moodGreat: "#F5D5C5",
  moodOkay: "#E8EDE5",
  moodMeh: "#D4C5E8",
  moodLow: "#E8C4C4",
  moodStressed: "#F5D5D5",
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
