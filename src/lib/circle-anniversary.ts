import { differenceInCalendarMonths } from "date-fns"
import { supabase } from "@/lib/supabase"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"

// MISSION 5 — no new schema: circle_memberships.accepted_at already marks
// when the circle became active. Pure client-side computation, same
// "no cron needed, recomputed opportunistically on load" spirit as the
// reminders circuit-breaker and the SOS staleness check.
export const ANNIVERSARY_MONTHS = [1, 3, 6, 12] as const

export function monthsSinceAccepted(acceptedAt: string): number {
  return differenceInCalendarMonths(new Date(), new Date(acceptedAt))
}

export function reachedAnniversaryMonth(acceptedAt: string): number | null {
  const months = monthsSinceAccepted(acceptedAt)
  return (ANNIVERSARY_MONTHS as readonly number[]).includes(months) ? months : null
}

// Aggregate only (text + voice encouragements combined) — never message
// content, per the "agrégat simple, pas de détail" requirement.
export async function getEncouragementCount(friendId: string): Promise<number> {
  const { data, error } = await supabase.rpc("circle_get_encouragement_count", { p_friend_id: friendId })
  if (error) return 0
  return typeof data === "number" ? data : 0
}

const SEEN_KEY_BASE = "anchor_circle_anniversaries_seen"

function seenKey(friendId: string, months: number): string {
  return `${friendId}:${months}`
}

export function hasSeenAnniversary(userId: string, friendId: string, months: number): boolean {
  const seen = new Set(getUserLocalData<string[]>(SEEN_KEY_BASE, userId) ?? [])
  return seen.has(seenKey(friendId, months))
}

export function markAnniversarySeen(userId: string, friendId: string, months: number): void {
  const seen = new Set(getUserLocalData<string[]>(SEEN_KEY_BASE, userId) ?? [])
  seen.add(seenKey(friendId, months))
  setUserLocalData(SEEN_KEY_BASE, userId, [...seen])
}
