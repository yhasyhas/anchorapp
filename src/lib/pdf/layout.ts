// A4, points (jsPDF default unit) — shared by every page builder so images and
// vector content line up against the same margins.
export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const MARGIN = 46
export const FOOTER_H = 24

export const CONTENT_X = MARGIN
export const CONTENT_W = PAGE_W - MARGIN * 2
export const CONTENT_TOP = MARGIN
export const CONTENT_BOTTOM = PAGE_H - MARGIN - FOOTER_H
export const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP

// Pixel size for full-page "insert card" images (cover, letters, journal, story,
// closing) — sized to the content box's aspect ratio at a print-quality scale
// (~2.5x), then placed back at CONTENT_W x CONTENT_H so text stays crisp without
// the PNG/JPEG ballooning in size.
const CARD_SCALE = 2.5
export const CARD_PX_W = Math.round(CONTENT_W * CARD_SCALE)
export const CARD_PX_H = Math.round(CONTENT_H * CARD_SCALE)
