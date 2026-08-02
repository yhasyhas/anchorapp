// Renders a weekly letter onto a canvas "paper card" and shares it as an
// image — this is the app's main viral loop (screenshot/share to WhatsApp
// Stories etc.), so the rendered card is deliberately branded and
// self-contained rather than a plain text share. No image-generation
// dependency is added for this: a canvas draw is small and fully
// controllable, and this is the only place in the app that needs one.

export interface LetterShareOptions {
  letterText: string
  weekLabel: string
  badge: string
  signature: string
}

export type ShareResult = "shared" | "downloaded" | "copied" | "failed"

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350

// Fixed brand palette (the app's light-theme values, see src/index.css)
// regardless of the viewer's own device theme — a keepsake/share image
// should look the same for everyone, like Spotify Wrapped or Duolingo share
// cards, not shift with whoever happens to be in dark mode.
const COLORS = {
  background: "#F9F7F2",
  card: "#FDFBF7",
  foreground: "#3D3D3D",
  muted: "#8A8A8A",
  sage: "#7A8B6E",
  sageLight: "#E8EDE5",
  lavenderWash: "rgba(212, 197, 232, 0.35)",
  shadow: "rgba(61, 61, 61, 0.14)",
}

async function ensureFontsLoaded(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load("italic 400 40px 'Playfair Display'"),
      document.fonts.load("italic 600 34px 'Playfair Display'"),
      document.fonts.load("600 26px 'Inter'"),
      document.fonts.load("400 24px 'Inter'"),
    ])
  } catch {
    // Best effort — canvas falls back to the system serif/sans if the
    // webfont hasn't finished loading in time, still perfectly readable.
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
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

async function renderLetterCard(opts: LetterShareOptions): Promise<HTMLCanvasElement> {
  await ensureFontsLoaded()

  const canvas = document.createElement("canvas")
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not supported")

  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
  gradient.addColorStop(0, COLORS.sageLight)
  gradient.addColorStop(0.55, COLORS.background)
  gradient.addColorStop(1, COLORS.lavenderWash)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const margin = 64
  const cardX = margin
  const cardY = margin
  const cardW = CARD_WIDTH - margin * 2
  const cardH = CARD_HEIGHT - margin * 2

  ctx.save()
  ctx.shadowColor = COLORS.shadow
  ctx.shadowBlur = 44
  ctx.shadowOffsetY = 14
  ctx.fillStyle = COLORS.card
  roundRect(ctx, cardX, cardY, cardW, cardH, 32)
  ctx.fill()
  ctx.restore()

  let y = cardY + 96

  ctx.textAlign = "center"
  ctx.fillStyle = COLORS.sage
  ctx.font = "600 26px 'Inter', sans-serif"
  ctx.fillText(opts.badge.toUpperCase(), CARD_WIDTH / 2, y)
  y += 36

  ctx.fillStyle = COLORS.muted
  ctx.font = "400 24px 'Inter', sans-serif"
  ctx.fillText(opts.weekLabel, CARD_WIDTH / 2, y)
  y += 90

  ctx.textAlign = "left"
  ctx.fillStyle = COLORS.foreground
  ctx.font = "italic 400 40px 'Playfair Display', serif"
  const textMaxWidth = cardW - 120
  const textX = cardX + 60
  const lineHeight = 58

  const lines = wrapText(ctx, opts.letterText, textMaxWidth)
  const reservedForSignature = 140
  const availableHeight = cardY + cardH - reservedForSignature - y
  const bodyHeight = lines.length * lineHeight
  let lineY = y + Math.max(0, (availableHeight - bodyHeight) / 2)

  for (const line of lines) {
    ctx.fillText(line, textX, lineY)
    lineY += lineHeight
  }

  ctx.textAlign = "right"
  ctx.fillStyle = COLORS.sage
  ctx.font = "italic 600 34px 'Playfair Display', serif"
  ctx.fillText(opts.signature, cardX + cardW - 60, cardY + cardH - 60)

  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95))
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

export async function shareLetter(opts: LetterShareOptions): Promise<ShareResult> {
  try {
    const canvas = await renderLetterCard(opts)
    const blob = await canvasToBlob(canvas)

    if (blob) {
      const file = new File([blob], "anchor-letter.png", { type: "image/png" })

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: opts.badge })
          return "shared"
        } catch (err) {
          if (isAbort(err)) return "shared"
          // Fall through to download below.
        }
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "anchor-letter.png"
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      return "downloaded"
    }
  } catch {
    // Canvas rendering failed (unlikely) — fall through to a plain text share.
  }

  if (navigator.share) {
    try {
      await navigator.share({ text: opts.letterText, title: opts.badge })
      return "shared"
    } catch (err) {
      if (isAbort(err)) return "shared"
    }
  }

  try {
    await navigator.clipboard.writeText(opts.letterText)
    return "copied"
  } catch {
    return "failed"
  }
}
