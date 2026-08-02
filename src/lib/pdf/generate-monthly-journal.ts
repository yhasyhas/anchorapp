import { jsPDF } from "jspdf"
import type { TFunction } from "i18next"
import { formatWeekRange } from "@/lib/letters"
import {
  renderClosingCard,
  renderCoverCard,
  renderJournalCard,
  renderLetterCard,
  renderStoryCard,
} from "./canvas-cards"
import { CONTENT_H, CONTENT_TOP, CONTENT_W, CONTENT_X, MARGIN, PAGE_H, PAGE_W } from "./layout"
import { drawMoodTrendChart } from "./mini-chart"
import { hexToRgb, PDF_COLORS } from "./palette"
import { buildMoodChartPoints, computeMonthStats, pickJournalHighlights } from "./stats"
import type { MonthlyJournalData, MonthStats, MoodChartPoint } from "./types"

function localeFor(lang: "en" | "sw"): string {
  return lang === "sw" ? "sw-TZ" : "en-US"
}

function addFullPageImage(doc: jsPDF, isFirstPage: boolean, dataUrl: string): void {
  if (!isFirstPage) doc.addPage()
  doc.addImage(dataUrl, "JPEG", CONTENT_X, CONTENT_TOP, CONTENT_W, CONTENT_H)
}

function addStatsPage(doc: jsPDF, stats: MonthStats, chartPoints: MoodChartPoint[], t: TFunction): void {
  doc.addPage()
  let y = CONTENT_TOP + 16

  doc.setFont("times", "bolditalic")
  doc.setFontSize(24)
  doc.setTextColor(...hexToRgb(PDF_COLORS.foreground))
  doc.text(t("pdf.section_stats"), CONTENT_X, y)
  y += 34

  const hasMoodData = chartPoints.some((p) => p.value != null)

  if (hasMoodData) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...hexToRgb(PDF_COLORS.sage))
    doc.text(t("pdf.section_mood_trend").toUpperCase(), CONTENT_X, y)
    y += 16

    const chartBoxH = 128
    doc.setFillColor(...hexToRgb(PDF_COLORS.sageLight))
    doc.roundedRect(CONTENT_X, y, CONTENT_W, chartBoxH, 14, 14, "F")
    drawMoodTrendChart(doc, CONTENT_X + 20, y + 18, CONTENT_W - 40, chartBoxH - 46, chartPoints)
    y += chartBoxH + 30
  }

  if (stats.isQuietMonth) {
    doc.setFont("times", "italic")
    doc.setFontSize(14)
    doc.setTextColor(...hexToRgb(PDF_COLORS.muted))
    const lines = doc.splitTextToSize(t("pdf.empty_month_body"), CONTENT_W - 60)
    doc.text(lines, CONTENT_X + CONTENT_W / 2, y + 30, { align: "center" })
    return
  }

  const tiles: { value: number; label: string; color: string }[] = [
    { value: stats.daysPresent, label: t("pdf.stat_days_present"), color: PDF_COLORS.sageLight },
    { value: stats.anchorsCompletedDays, label: t("pdf.stat_anchors_completed"), color: PDF_COLORS.peach },
    { value: stats.bestMoodStreak, label: t("pdf.stat_best_mood_streak"), color: PDF_COLORS.lavender },
    { value: stats.bestAnchorStreak, label: t("pdf.stat_best_anchor_streak"), color: PDF_COLORS.roseAccent },
  ]

  const gap = 14
  const tileW = (CONTENT_W - gap) / 2
  const tileH = 78

  tiles.forEach((tile, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const tx = CONTENT_X + col * (tileW + gap)
    const ty = y + row * (tileH + gap)

    doc.setFillColor(...hexToRgb(tile.color))
    doc.roundedRect(tx, ty, tileW, tileH, 14, 14, "F")

    doc.setFont("times", "bold")
    doc.setFontSize(28)
    doc.setTextColor(...hexToRgb(PDF_COLORS.foreground))
    doc.text(String(tile.value), tx + tileW / 2, ty + 40, { align: "center" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text(tile.label, tx + tileW / 2, ty + 60, { align: "center", maxWidth: tileW - 24 })
  })
}

function drawFooter(doc: jsPDF, monthLabel: string, pageNum: number): void {
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...hexToRgb(PDF_COLORS.muted))
  doc.text(`Anchor — ${monthLabel}`, MARGIN, PAGE_H - 16)
  doc.text(String(pageNum), PAGE_W - MARGIN, PAGE_H - 16, { align: "right" })
}

export async function generateMonthlyJournalPdf(data: MonthlyJournalData, t: TFunction): Promise<jsPDF> {
  const locale = localeFor(data.lang)
  const monthDate = new Date(`${data.monthStart}T00:00:00`)
  const monthLabel = monthDate.toLocaleDateString(locale, { month: "long", year: "numeric" })

  const stats = computeMonthStats(data)
  const chartPoints = buildMoodChartPoints(data)

  const doc = new jsPDF({ unit: "pt", format: "a4" })

  const dominantIntentionLabel = stats.dominantIntention ? t(`intentions.${stats.dominantIntention.toLowerCase()}`) : null
  const intentionLine = dominantIntentionLabel ? t("pdf.cover_intention_line", { intention: dominantIntentionLabel }) : null
  const openingLine = dominantIntentionLabel
    ? t("pdf.cover_opening_with_intention", { intention: dominantIntentionLabel })
    : t("pdf.cover_opening_quiet")

  const coverCard = await renderCoverCard({
    eyebrow: t("pdf.eyebrow"),
    monthLabel,
    greeting: t("pdf.cover_greeting", { name: data.firstName || t("pdf.cover_greeting_fallback_name") }),
    intentionLine,
    openingLine,
  })
  addFullPageImage(doc, true, coverCard.dataUrl)

  addStatsPage(doc, stats, chartPoints, t)

  for (const letter of data.weeklyLetters) {
    const card = await renderLetterCard({
      badge: t("letters.badge"),
      weekLabel: formatWeekRange(letter.week_start, letter.week_end, data.lang),
      letterText: letter.letter_text,
      signature: t("letters.signature"),
    })
    addFullPageImage(doc, false, card.dataUrl)
  }

  const highlights = pickJournalHighlights(data.journalEntries)
  if (highlights.length > 0) {
    const entries = highlights.map((entry) => ({
      dateLabel: new Date(`${entry.date}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" }),
      sentence: entry.sentence,
    }))
    const card = await renderJournalCard({
      title: t("pdf.section_journal"),
      subtitle: t("pdf.journal_subtitle"),
      entries,
    })
    addFullPageImage(doc, false, card.dataUrl)
  }

  if (data.progressStory) {
    const card = await renderStoryCard({
      title: t("pdf.section_story"),
      dateLabel: formatWeekRange(data.progressStory.period_start, data.progressStory.period_end, data.lang),
      storyText: data.progressStory.story_text,
      closingLine: t("progress_story.closing_line"),
    })
    addFullPageImage(doc, false, card.dataUrl)
  }

  const closingCard = await renderClosingCard({
    quoteLine: t("pdf.closing_quote"),
    notesLabel: t("pdf.closing_notes_label"),
  })
  addFullPageImage(doc, false, closingCard.dataUrl)

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    drawFooter(doc, monthLabel, i)
  }

  return doc
}

export function monthlyJournalFilename(monthIso: string): string {
  return `anchor-journal-${monthIso}.pdf`
}

export async function downloadMonthlyJournalPdf(data: MonthlyJournalData, t: TFunction, monthIso: string): Promise<void> {
  const doc = await generateMonthlyJournalPdf(data, t)
  doc.save(monthlyJournalFilename(monthIso))
}
