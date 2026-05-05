import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Time gating helpers ───
const ANCHOR_LOCK_DELAY_MS = 3 * 60 * 60 * 1000 // 3 heures
const CHECKIN_START_HOUR = 19

export function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

export function getAnchorLockKey(userId: string): string {
  return `anchor_locked_at_${userId}_${todayStr()}`
}

export function canCheckAnchors(userId: string): boolean {
  const raw = localStorage.getItem(getAnchorLockKey(userId))
  if (!raw) return false // Pas encore locké = pas encore prêt
  const lockedAt = new Date(raw).getTime()
  return Date.now() - lockedAt >= ANCHOR_LOCK_DELAY_MS
}

export function getTimeUntilAnchorCheck(userId: string): string | null {
  const raw = localStorage.getItem(getAnchorLockKey(userId))
  if (!raw) return null
  const remaining = ANCHOR_LOCK_DELAY_MS - (Date.now() - new Date(raw).getTime())
  if (remaining <= 0) return null
  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function isCheckInTime(): boolean {
  return new Date().getHours() >= CHECKIN_START_HOUR
}