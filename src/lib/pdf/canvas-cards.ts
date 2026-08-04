// Renders each "insert card" page (cover, letters, journal highlights, progress story,
// closing) onto a canvas using the app's real webfonts, the same technique as
// src/lib/letter-share.ts's share card — a canvas draw is small, fully controllable, and
// (unlike html2canvas) never depends on live DOM layout. The generated PDF embeds these as
// JPEGs; only the stats/chart page (src/lib/pdf/mini-chart.ts) is drawn as PDF vector text.
import { CARD_PX_H, CARD_PX_W } from "./layout"
import { PDF_COLORS } from "./palette"
import { roundRect, wrapText, loadCanvasFonts } from "@/lib/canvas-utils"

export interface RenderedCard {
  dataUrl: string
  width: number
  height: number
}

// Same fixed set for every card type below — none of them currently need a
// different weight/size mix, so there's just the one shared list.
const CARD_FONT_SPECS = [
  "italic 400 40px 'Playfair Display'",
  "italic 600 40px 'Playfair Display'",
  "700 40px 'Playfair Display'",
  "400 40px 'Playfair Display'",
  "400 24px 'Inter'",
  "600 24px 'Inter'",
  "700 24px 'Inter'",
]

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas")
  canvas.width = CARD_PX_W
  canvas.height = CARD_PX_H
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not supported")
  return { canvas, ctx }
}

function paintBackgroundCard(
  ctx: CanvasRenderingContext2D,
  gradientStops: [number, string][],
  margin: number
): { cardX: number; cardY: number; cardW: number; cardH: number } {
  const gradient = ctx.createLinearGradient(0, 0, CARD_PX_W, CARD_PX_H)
  for (const [stop, color] of gradientStops) gradient.addColorStop(stop, color)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_PX_W, CARD_PX_H)

  const cardX = margin
  const cardY = margin
  const cardW = CARD_PX_W - margin * 2
  const cardH = CARD_PX_H - margin * 2

  ctx.save()
  ctx.shadowColor = PDF_COLORS.shadow
  ctx.shadowBlur = 50
  ctx.shadowOffsetY = 16
  ctx.fillStyle = PDF_COLORS.card
  roundRect(ctx, cardX, cardY, cardW, cardH, 36)
  ctx.fill()
  ctx.restore()

  return { cardX, cardY, cardW, cardH }
}

function toResult(canvas: HTMLCanvasElement): RenderedCard {
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width: canvas.width, height: canvas.height }
}

export interface CoverCardOptions {
  eyebrow: string
  monthLabel: string
  greeting: string
  intentionLine: string | null
  openingLine: string
}

export async function renderCoverCard(opts: CoverCardOptions): Promise<RenderedCard> {
  await loadCanvasFonts(CARD_FONT_SPECS)
  const { canvas, ctx } = newCanvas()
  const margin = 56
  const { cardY, cardW, cardH } = paintBackgroundCard(
    ctx,
    [
      [0, PDF_COLORS.sageLight],
      [0.55, PDF_COLORS.background],
      [1, "rgba(212, 197, 232, 0.35)"],
    ],
    margin
  )

  const centerX = CARD_PX_W / 2
  let y = cardY + cardH * 0.16

  ctx.textAlign = "center"
  ctx.fillStyle = PDF_COLORS.sage
  ctx.font = "700 26px 'Inter', sans-serif"
  ctx.fillText(opts.eyebrow.toUpperCase(), centerX, y)
  y += 76

  ctx.fillStyle = PDF_COLORS.foreground
  ctx.font = "700 78px 'Playfair Display', serif"
  ctx.fillText(opts.monthLabel, centerX, y)
  y += 56

  ctx.fillStyle = PDF_COLORS.muted
  ctx.font = "italic 400 32px 'Playfair Display', serif"
  ctx.fillText(opts.greeting, centerX, y)
  y += 70

  if (opts.intentionLine) {
    ctx.fillStyle = PDF_COLORS.sage
    ctx.font = "600 24px 'Inter', sans-serif"
    const lines = wrapText(ctx, opts.intentionLine, cardW - 200)
    for (const line of lines) {
      ctx.fillText(line, centerX, y)
      y += 34
    }
    y += 30
  }

  ctx.fillStyle = PDF_COLORS.foreground
  ctx.font = "italic 400 34px 'Playfair Display', serif"
  const maxTextWidth = cardW - 220
  const lineHeight = 50
  const openingLines = wrapText(ctx, opts.openingLine, maxTextWidth)
  const reservedBottom = 90
  // Cap the centering window instead of spanning the full remaining card height — the
  // opening line should sit fairly close under the intention line, with the leftover
  // space read as breathing room above the signature rather than a symmetric gap.
  const availableHeight = Math.min(320, cardY + cardH - reservedBottom - y)
  const bodyHeight = openingLines.length * lineHeight
  let lineY = y + Math.max(48, (availableHeight - bodyHeight) / 2)
  for (const line of openingLines) {
    ctx.fillText(line, centerX, lineY)
    lineY += lineHeight
  }

  ctx.fillStyle = PDF_COLORS.sage
  ctx.font = "italic 600 30px 'Playfair Display', serif"
  ctx.fillText("— your Anchor ⚓", centerX, cardY + cardH - 56)

  return toResult(canvas)
}

export interface LetterCardOptions {
  badge: string
  weekLabel: string
  letterText: string
  signature: string
}

export async function renderLetterCard(opts: LetterCardOptions): Promise<RenderedCard> {
  await loadCanvasFonts(CARD_FONT_SPECS)
  const { canvas, ctx } = newCanvas()
  const margin = 56
  const { cardX, cardY, cardW, cardH } = paintBackgroundCard(
    ctx,
    [
      [0, "rgba(232, 237, 229, 0.6)"],
      [0.6, PDF_COLORS.card],
      [1, "rgba(212, 197, 232, 0.25)"],
    ],
    margin
  )

  let y = cardY + 100

  ctx.textAlign = "center"
  ctx.fillStyle = PDF_COLORS.sage
  ctx.font = "700 24px 'Inter', sans-serif"
  ctx.fillText(opts.badge.toUpperCase(), CARD_PX_W / 2, y)
  y += 34

  ctx.fillStyle = PDF_COLORS.muted
  ctx.font = "400 22px 'Inter', sans-serif"
  ctx.fillText(opts.weekLabel, CARD_PX_W / 2, y)
  y += 90

  ctx.textAlign = "left"
  ctx.fillStyle = PDF_COLORS.foreground
  const textMaxWidth = cardW - 140
  const textX = cardX + 70
  let fontSizePx = 38
  let lineHeight = 54
  let lines: string[]

  // Shrink-to-fit rather than paginate: weekly letters are short reflections, so a
  // single card per letter reads like a keepsake insert. An unusually long letter
  // just steps the type down a little instead of spilling onto a second page.
  const reservedForSignature = 130
  const availableHeight = cardY + cardH - reservedForSignature - y
  while (fontSizePx > 22) {
    ctx.font = `italic 400 ${fontSizePx}px 'Playfair Display', serif`
    lines = wrapText(ctx, opts.letterText, textMaxWidth)
    if (lines.length * lineHeight <= availableHeight) break
    fontSizePx -= 2
    lineHeight -= 3
  }
  ctx.font = `italic 400 ${fontSizePx}px 'Playfair Display', serif`
  lines = wrapText(ctx, opts.letterText, textMaxWidth)

  const bodyHeight = lines.length * lineHeight
  let lineY = y + Math.max(0, (availableHeight - bodyHeight) / 2)
  for (const line of lines) {
    ctx.fillText(line, textX, lineY)
    lineY += lineHeight
  }

  ctx.textAlign = "right"
  ctx.fillStyle = PDF_COLORS.sage
  ctx.font = "italic 600 30px 'Playfair Display', serif"
  ctx.fillText(opts.signature, cardX + cardW - 70, cardY + cardH - 60)

  return toResult(canvas)
}

export interface JournalCardOptions {
  title: string
  subtitle: string
  entries: { dateLabel: string; sentence: string }[]
}

export async function renderJournalCard(opts: JournalCardOptions): Promise<RenderedCard> {
  await loadCanvasFonts(CARD_FONT_SPECS)
  const { canvas, ctx } = newCanvas()
  const margin = 56
  const { cardX, cardY, cardW, cardH } = paintBackgroundCard(
    ctx,
    [
      [0, "rgba(245, 213, 197, 0.35)"],
      [0.6, PDF_COLORS.card],
      [1, "rgba(232, 237, 229, 0.5)"],
    ],
    margin
  )

  let y = cardY + 92
  ctx.textAlign = "center"
  ctx.fillStyle = PDF_COLORS.foreground
  ctx.font = "700 42px 'Playfair Display', serif"
  ctx.fillText(opts.title, CARD_PX_W / 2, y)
  y += 40

  ctx.fillStyle = PDF_COLORS.muted
  ctx.font = "400 22px 'Inter', sans-serif"
  ctx.fillText(opts.subtitle, CARD_PX_W / 2, y)
  y += 76

  const textMaxWidth = cardW - 160
  const textX = cardX + 80
  ctx.textAlign = "left"

  const dateLabelH = 36
  const sentenceLineH = 40
  const entryGap = 34
  ctx.font = "italic 400 30px 'Playfair Display', serif"
  const measuredEntries = opts.entries.map((entry) => ({
    entry,
    lines: wrapText(ctx, `"${entry.sentence}"`, textMaxWidth),
  }))
  const blockHeight = measuredEntries.reduce(
    (sum, m) => sum + dateLabelH + m.lines.length * sentenceLineH + entryGap,
    0
  )

  // Centered (within a capped window) rather than always flush under the subtitle, so a
  // handful of highlights still reads as a deliberate, balanced page instead of a mostly
  // empty card with everything crammed at the top.
  const availableHeight = Math.min(560, cardY + cardH - 70 - y)
  y += Math.max(0, (availableHeight - blockHeight) / 2)

  for (const { entry, lines } of measuredEntries) {
    ctx.fillStyle = PDF_COLORS.sage
    ctx.font = "600 20px 'Inter', sans-serif"
    ctx.fillText(entry.dateLabel.toUpperCase(), textX, y)
    y += dateLabelH

    ctx.fillStyle = PDF_COLORS.foreground
    ctx.font = "italic 400 30px 'Playfair Display', serif"
    for (const line of lines) {
      ctx.fillText(line, textX, y)
      y += sentenceLineH
    }
    y += entryGap
  }

  return toResult(canvas)
}

export interface StoryCardOptions {
  title: string
  dateLabel: string
  storyText: string
  closingLine: string
}

export async function renderStoryCard(opts: StoryCardOptions): Promise<RenderedCard> {
  await loadCanvasFonts(CARD_FONT_SPECS)
  const { canvas, ctx } = newCanvas()
  const margin = 56
  const { cardX, cardY, cardW, cardH } = paintBackgroundCard(
    ctx,
    [
      [0, "rgba(212, 197, 232, 0.3)"],
      [0.55, PDF_COLORS.card],
      [1, "rgba(232, 237, 229, 0.45)"],
    ],
    margin
  )

  let y = cardY + 96
  ctx.textAlign = "center"
  ctx.fillStyle = PDF_COLORS.foreground
  ctx.font = "700 40px 'Playfair Display', serif"
  ctx.fillText(opts.title, CARD_PX_W / 2, y)
  y += 38

  ctx.fillStyle = PDF_COLORS.muted
  ctx.font = "400 22px 'Inter', sans-serif"
  ctx.fillText(opts.dateLabel, CARD_PX_W / 2, y)
  y += 84

  ctx.textAlign = "left"
  ctx.fillStyle = PDF_COLORS.foreground
  ctx.font = "italic 400 32px 'Playfair Display', serif"
  const textMaxWidth = cardW - 140
  const textX = cardX + 70
  const lineHeight = 46
  const lines = wrapText(ctx, opts.storyText, textMaxWidth)
  const reservedBottom = 110
  const availableHeight = cardY + cardH - reservedBottom - y
  const bodyHeight = lines.length * lineHeight
  let lineY = y + Math.max(0, (availableHeight - bodyHeight) / 2)
  for (const line of lines) {
    ctx.fillText(line, textX, lineY)
    lineY += lineHeight
  }

  ctx.textAlign = "center"
  ctx.fillStyle = PDF_COLORS.sage
  ctx.font = "600 24px 'Inter', sans-serif"
  ctx.fillText(opts.closingLine, CARD_PX_W / 2, cardY + cardH - 56)

  return toResult(canvas)
}

export interface ClosingCardOptions {
  quoteLine: string
  notesLabel: string
}

export async function renderClosingCard(opts: ClosingCardOptions): Promise<RenderedCard> {
  await loadCanvasFonts(CARD_FONT_SPECS)
  const { canvas, ctx } = newCanvas()
  const margin = 56
  const { cardX, cardY, cardW, cardH } = paintBackgroundCard(
    ctx,
    [
      [0, PDF_COLORS.sageLight],
      [0.5, PDF_COLORS.background],
      [1, "rgba(212, 197, 232, 0.3)"],
    ],
    margin
  )

  let y = cardY + 130
  ctx.textAlign = "center"
  ctx.fillStyle = PDF_COLORS.foreground
  ctx.font = "italic 700 42px 'Playfair Display', serif"
  const quoteLines = wrapText(ctx, opts.quoteLine, cardW - 180)
  for (const line of quoteLines) {
    ctx.fillText(line, CARD_PX_W / 2, y)
    y += 56
  }
  y += 50

  ctx.fillStyle = PDF_COLORS.sage
  ctx.font = "700 24px 'Inter', sans-serif"
  ctx.fillText(opts.notesLabel.toUpperCase(), CARD_PX_W / 2, y)
  y += 44

  ctx.strokeStyle = "rgba(122, 139, 110, 0.35)"
  ctx.lineWidth = 2
  const ruleX1 = cardX + 90
  const ruleX2 = cardX + cardW - 90
  const ruleBottom = cardY + cardH - 70
  const ruleGap = 56
  for (; y < ruleBottom; y += ruleGap) {
    ctx.beginPath()
    ctx.moveTo(ruleX1, y)
    ctx.lineTo(ruleX2, y)
    ctx.stroke()
  }

  return toResult(canvas)
}
