import { supabase } from "@/lib/supabase"
import { bestEffortPost, CircleError } from "@/lib/circle"
import type { CircleSharedIntention } from "@/types"

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

// MISSION 2 "Anchor Together" — propose an intention for the current week.
export async function proposeSharedIntention(recipientId: string, intention: string): Promise<void> {
  const { error } = await supabase.rpc("circle_propose_shared_intention", {
    p_recipient_id: recipientId,
    p_intention: intention,
  })
  if (error) throw toCircleError(error)
  bestEffortPost("/api/circle/notify-shared-intention", { recipient_id: recipientId })
}

export async function respondSharedIntention(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("circle_respond_shared_intention", { p_id: id, p_accept: accept })
  if (error) throw toCircleError(error)
}

// All of this week's proposals involving the caller (either direction,
// pending or accepted) — the caller splits them into "awaiting my
// response" vs. "accepted, pre-fill my intention" client-side.
export async function getActiveSharedIntentions(): Promise<CircleSharedIntention[]> {
  const { data, error } = await supabase.rpc("circle_get_active_shared_intention")
  if (error) throw toCircleError(error)
  return (data ?? []) as CircleSharedIntention[]
}
