import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Time gating helpers ───
const ANCHOR_LOCK_DELAY_MS = 3 * 60 * 60 * 1000 // 3 heures
const CHECKIN_START_HOUR = 19

// Formate une date en YYYY-MM-DD selon le fuseau horaire LOCAL de l'appareil (pas UTC)
// Toute date "du jour" doit passer par ici, jamais par toISOString().split("T")[0]
export function localDateStr(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd")
}

export function todayStr(): string {
  return localDateStr()
}

// Le verrou est maintenant stocké côté serveur (daily_anchors.anchors_locked_at) pour
// survivre à un changement d'appareil ou un vidage de cache. `lockedAt` vient donc de
// l'état `anchor` chargé depuis Supabase — absence de valeur (null/undefined) = pas
// encore locké, fallback gracieux vers "pas prêt" plutôt qu'une erreur.
export function canCheckAnchors(lockedAt: string | null | undefined): boolean {
  if (!lockedAt) return false // Pas encore locké = pas encore prêt
  const lockedAtMs = new Date(lockedAt).getTime()
  return Date.now() - lockedAtMs >= ANCHOR_LOCK_DELAY_MS
}

export function getTimeUntilAnchorCheck(lockedAt: string | null | undefined): string | null {
  if (!lockedAt) return null
  const remaining = ANCHOR_LOCK_DELAY_MS - (Date.now() - new Date(lockedAt).getTime())
  if (remaining <= 0) return null
  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function isCheckInTime(): boolean {
  return new Date().getHours() >= CHECKIN_START_HOUR
}