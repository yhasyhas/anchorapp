import type { jsPDF } from "jspdf"
import { hexToRgb, PDF_COLORS, PDF_MOOD_COLORS } from "./palette"
import type { MoodChartPoint } from "./types"

// Drawn as PDF vector primitives (not a canvas image) — a month of dots and a line stays
// tiny either way, and vector keeps it crisp at any zoom/print size.
export function drawMoodTrendChart(doc: jsPDF, x: number, y: number, w: number, h: number, points: MoodChartPoint[]): void {
  const n = points.length
  if (n === 0) return

  const stepX = n > 1 ? w / (n - 1) : 0
  const valueToY = (value: number) => y + h - ((value - 1) / 4) * h

  // Faint horizontal guide at the midline, purely decorative.
  doc.setDrawColor(...hexToRgb(PDF_COLORS.border))
  doc.setLineWidth(0.6)
  doc.line(x, y + h / 2, x + w, y + h / 2)

  doc.setDrawColor(...hexToRgb(PDF_COLORS.sage))
  doc.setLineWidth(1.4)
  let prevPoint: { px: number; py: number } | null = null
  for (let i = 0; i < n; i++) {
    const point = points[i]
    const px = x + stepX * i
    if (point.value == null) {
      prevPoint = null
      continue
    }
    const py = valueToY(point.value)
    if (prevPoint) doc.line(prevPoint.px, prevPoint.py, px, py)
    prevPoint = { px, py }
  }

  for (let i = 0; i < n; i++) {
    const point = points[i]
    if (point.value == null) continue
    const px = x + stepX * i
    const py = valueToY(point.value)
    const color = point.mood ? PDF_MOOD_COLORS[point.mood] ?? PDF_COLORS.sage : PDF_COLORS.sage
    doc.setFillColor(...hexToRgb(color))
    doc.setDrawColor(...hexToRgb(PDF_COLORS.card))
    doc.setLineWidth(0.8)
    doc.circle(px, py, 2.4, "FD")
  }

  // Sparse day-of-month ticks along the bottom so the axis stays legible without
  // crowding every single day into the available width.
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(...hexToRgb(PDF_COLORS.muted))
  const tickEvery = n > 20 ? 5 : n > 10 ? 2 : 1
  for (let i = 0; i < n; i += tickEvery) {
    const day = Number(points[i].date.split("-")[2])
    const px = x + stepX * i
    doc.text(String(day), px, y + h + 12, { align: "center" })
  }
}
