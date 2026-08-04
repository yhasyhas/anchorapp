// Shared canvas drawing primitives for this app's "render a branded card to
// an image" surfaces (src/lib/pdf/canvas-cards.ts, src/lib/letter-share.ts,
// src/lib/wrapped-share.ts) — all three are plain client modules bundled
// together by Vite (unlike the api/*.ts Vercel Edge Functions, which
// legitimately duplicate their own small helpers because each one is
// bundled separately), so there's no reason for each to hand-roll its own
// copy of these.

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

// Each caller passes the exact font specs it renders with (weights/sizes
// differ per card type) — this only centralizes the load-and-swallow-errors
// mechanics, not which fonts get preloaded.
export async function loadCanvasFonts(specs: string[]): Promise<void> {
  try {
    await Promise.all(specs.map((spec) => document.fonts.load(spec)))
  } catch {
    // Best effort — canvas falls back to the system serif/sans if a webfont
    // hasn't finished loading yet, still perfectly readable.
  }
}
