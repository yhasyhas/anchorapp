// Renders a single Wrapped card onto a canvas and shares it as a 9:16 image —
// same technique as src/lib/letter-share.ts (this app's other share-image
// surface): a canvas draw is small, fully controllable, and independent of
// live DOM layout, so no image-generation dependency (html2canvas etc.) is
// needed. Helpers are deliberately duplicated rather than imported, same
// per-module convention as letter-share.ts / src/lib/pdf/canvas-cards.ts.
import type { WrappedCard } from "@/lib/wrapped"

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1920 // 9:16 — Stories/Reels portrait format

const COLORS = {
  background: "#F9F7F2",
  foreground: "#3D3D3D",
  muted: "#8A8A8A",
  sage: "#7A8B6E",
  sageLight: "#E8EDE5",
  lavenderWash: "rgba(212, 197, 232, 0.35)",
}

async function ensureFontsLoaded(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load("italic 700 60px 'Playfair Display'"),
      document.fonts.load("700 200px 'Playfair Display'"),
      document.fonts.load("italic 400 40px 'Playfair Display'"),
      document.fonts.load("600 30px 'Inter'"),
      document.fonts.load("400 32px 'Inter'"),
    ])
  } catch {
    // Best effort — canvas falls back to the system serif/sans if the webfont
    // hasn't finished loading in time, still perfectly readable.
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("")
      continue
    }
    let current = ""
    for (const word of paragraph.split(/\s+/)) {
      const attempt = current ? `${current} ${word}` : word
      if (current && ctx.measureText(attempt).width > maxWidth) {
        lines.push(current)
        current = word
      } else {
        current = attempt
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

function drawWrappedLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const lines = wrapText(ctx, text, maxWidth)
  let cursor = y
  for (const line of lines) {
    ctx.fillText(line, x, cursor)
    cursor += lineHeight
  }
}

function paintBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  gradient.addColorStop(0, COLORS.sageLight)
  gradient.addColorStop(0.5, COLORS.background)
  gradient.addColorStop(1, COLORS.lavenderWash)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
}

function drawEyebrow(ctx: CanvasRenderingContext2D, eyebrow: string): void {
  ctx.textAlign = "center"
  ctx.fillStyle = COLORS.sage
  ctx.font = "700 30px 'Inter', sans-serif"
  ctx.fillText(eyebrow.toUpperCase(), CARD_WIDTH / 2, 220)
}

function drawWatermark(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "center"
  ctx.fillStyle = COLORS.sage
  ctx.font = "600 30px 'Inter', sans-serif"
  ctx.fillText("Anchor ⚓", CARD_WIDTH / 2, CARD_HEIGHT - 90)
}

// Single big number/emoji + caption — "days", "intention", "mood_trend" cards.
function drawBigNumberCard(ctx: CanvasRenderingContext2D, card: WrappedCard): void {
  const centerX = CARD_WIDTH / 2
  ctx.fillStyle = COLORS.foreground
  ctx.font = "700 220px 'Playfair Display', serif"
  ctx.fillText(card.title, centerX, CARD_HEIGHT * 0.48)

  ctx.fillStyle = COLORS.muted
  ctx.font = "400 34px 'Inter', sans-serif"
  drawWrappedLines(ctx, card.subtitle, centerX, CARD_HEIGHT * 0.48 + 90, CARD_WIDTH - 220, 46)
}

// Two stat tiles side by side — the "streaks" card (mood streak + anchor streak).
function drawTwoStatsCard(ctx: CanvasRenderingContext2D, card: WrappedCard): void {
  const y = CARD_HEIGHT * 0.46
  const leftX = CARD_WIDTH * 0.28
  const rightX = CARD_WIDTH * 0.72

  ctx.fillStyle = COLORS.foreground
  ctx.font = "700 130px 'Playfair Display', serif"
  ctx.fillText(card.title, leftX, y)
  ctx.fillText(card.title2 ?? "", rightX, y)

  ctx.fillStyle = COLORS.muted
  ctx.font = "400 28px 'Inter', sans-serif"
  drawWrappedLines(ctx, card.subtitle, leftX, y + 60, CARD_WIDTH * 0.4, 36)
  drawWrappedLines(ctx, card.subtitle2 ?? "", rightX, y + 60, CARD_WIDTH * 0.4, 36)
}

// Title + optional subtitle + optional longer quote/sentence + optional
// footer tagline — "cover", "treasures", "closing" cards.
function drawSentenceCard(ctx: CanvasRenderingContext2D, card: WrappedCard): void {
  const centerX = CARD_WIDTH / 2
  let y = CARD_HEIGHT * 0.4

  ctx.textAlign = "center"
  ctx.fillStyle = COLORS.foreground
  ctx.font = "italic 700 68px 'Playfair Display', serif"
  const titleLines = wrapText(ctx, card.title, CARD_WIDTH - 200)
  for (const line of titleLines) {
    ctx.fillText(line, centerX, y)
    y += 82
  }

  if (card.subtitle) {
    ctx.fillStyle = COLORS.muted
    ctx.font = "400 32px 'Inter', sans-serif"
    ctx.fillText(card.subtitle, centerX, y + 16)
    y += 70
  }

  if (card.body) {
    y += 40
    ctx.fillStyle = COLORS.foreground
    ctx.font = "italic 400 42px 'Playfair Display', serif"
    drawWrappedLines(ctx, card.body, centerX, y, CARD_WIDTH - 220, 58)
  }

  if (card.footer) {
    ctx.fillStyle = COLORS.sage
    ctx.font = "600 30px 'Inter', sans-serif"
    ctx.fillText(card.footer, centerX, CARD_HEIGHT - 260)
  }
}

async function renderWrappedCard(card: WrappedCard): Promise<HTMLCanvasElement> {
  await ensureFontsLoaded()

  const canvas = document.createElement("canvas")
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not supported")

  paintBackground(ctx)
  drawEyebrow(ctx, card.eyebrow)

  if (card.title2 !== undefined) {
    drawTwoStatsCard(ctx, card)
  } else if (card.kind === "cover" || card.kind === "treasures" || card.kind === "closing") {
    drawSentenceCard(ctx, card)
  } else {
    drawBigNumberCard(ctx, card)
  }

  drawWatermark(ctx)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95))
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

export type WrappedShareResult = "shared" | "downloaded" | "failed"

// No clipboard-text fallback (unlike shareLetter) — a stat card has no
// natural text equivalent to copy, so any non-share path just downloads.
export async function shareWrappedCard(card: WrappedCard, shareTitle: string): Promise<WrappedShareResult> {
  try {
    const canvas = await renderWrappedCard(card)
    const blob = await canvasToBlob(canvas)
    if (!blob) return "failed"

    const file = new File([blob], "anchor-wrapped.png", { type: "image/png" })

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: shareTitle })
        return "shared"
      } catch (err) {
        if (isAbort(err)) return "shared"
        // Fall through to download below.
      }
    }

    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "anchor-wrapped.png"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return "downloaded"
  } catch {
    return "failed"
  }
}
