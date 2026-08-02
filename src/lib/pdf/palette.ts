// Fixed brand palette (the app's light-theme values, see src/index.css) — a printed/exported
// keepsake should look the same regardless of the viewer's device theme, same reasoning as
// src/lib/letter-share.ts's share-card palette.
export const PDF_COLORS = {
  background: "#F9F7F2",
  card: "#FDFBF7",
  foreground: "#3D3D3D",
  muted: "#8A8A8A",
  border: "#E8E4DC",
  sage: "#7A8B6E",
  sageLight: "#E8EDE5",
  lavender: "#D4C5E8",
  peach: "#F5D5C5",
  roseAccent: "#E8C4C4",
  moodStressed: "#F5D5D5",
  shadow: "rgba(61, 61, 61, 0.14)",
} as const

export const PDF_MOOD_COLORS: Record<string, string> = {
  great: PDF_COLORS.peach,
  okay: PDF_COLORS.sageLight,
  meh: PDF_COLORS.lavender,
  low: PDF_COLORS.roseAccent,
  stressed: PDF_COLORS.moodStressed,
}

// jsPDF's setFillColor/setDrawColor take r,g,b triples rather than CSS hex strings.
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "")
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return [r, g, b]
}
