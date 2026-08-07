import { supabase } from "@/lib/supabase"
import { CircleError } from "@/lib/circle"
import type { CircleGraceGift, CircleStreakAlert } from "@/types"

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

// MISSION 3 — send a grace gift. No push per spec (the recipient learns
// about it passively via her own streak card, see use-daily-cycle.ts).
export async function sendGraceGift(recipientId: string): Promise<void> {
  const { error } = await supabase.rpc("circle_send_grace_gift", { p_recipient_id: recipientId })
  if (error) throw toCircleError(error)
}

// Caller's own unconsumed gift, if any.
export async function getMyGraceGift(): Promise<CircleGraceGift | null> {
  const { data, error } = await supabase.rpc("circle_get_my_grace_gift")
  if (error) throw toCircleError(error)
  const rows = (data ?? []) as CircleGraceGift[]
  return rows[0] ?? null
}

// Called once use-daily-cycle.ts detects the extra grace token actually
// protected a real gap (see streaks.ts's currentStreakRun) — fire-and-forget
// from the caller's perspective, failures just mean the gift stays "active"
// and gets detected again next load.
export async function markGraceGiftConsumed(id: string): Promise<void> {
  const { error } = await supabase.rpc("circle_mark_grace_gift_consumed", { p_id: id })
  if (error) throw toCircleError(error)
}

// Soft "she hasn't shown up in 2 days" signal for active circle friends —
// drives the "Send {name} a grace day?" prompt on the Circle page.
export async function getStreakAlerts(): Promise<CircleStreakAlert[]> {
  const { data, error } = await supabase.rpc("circle_get_streak_alerts")
  if (error) throw toCircleError(error)
  return (data ?? []) as CircleStreakAlert[]
}
