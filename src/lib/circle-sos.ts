import { supabase } from "@/lib/supabase"
import { CircleError, bestEffortPost } from "@/lib/circle"

export interface OwnActiveSos {
  id: string
  createdAt: string
}

export interface CircleSosEntry {
  senderId: string
  createdAt: string
}

export interface OwnSosHistoryEntry {
  id: string
  createdAt: string
  resolvedAt: string | null
}

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

export async function sendSos(): Promise<void> {
  const { error } = await supabase.rpc("circle_sos_send")
  if (error) throw toCircleError(error)
  // Best-effort push to the sender's circle — the row already exists by the
  // time this runs, same reasoning as notifyExistingUserInvite/sendEncouragement.
  bestEffortPost("/api/circle/notify-sos", {})
}

export async function getOwnActiveSos(): Promise<OwnActiveSos | null> {
  const { data, error } = await supabase.rpc("circle_sos_get_own_active")
  if (error) throw toCircleError(error)
  const row = (data ?? [])[0] as { id: string; created_at: string } | undefined
  return row ? { id: row.id, createdAt: row.created_at } : null
}

export async function listActiveCircleSos(): Promise<CircleSosEntry[]> {
  const { data, error } = await supabase.rpc("circle_sos_list_active_for_circle")
  if (error) throw toCircleError(error)
  return ((data ?? []) as { sender_id: string; created_at: string }[]).map((row) => ({
    senderId: row.sender_id,
    createdAt: row.created_at,
  }))
}

export async function resolveStaleSos(): Promise<void> {
  const { error } = await supabase.rpc("circle_sos_resolve_stale")
  if (error) throw toCircleError(error)
}

export async function listOwnSosHistory(): Promise<OwnSosHistoryEntry[]> {
  const { data, error } = await supabase.rpc("circle_sos_list_own_history")
  if (error) throw toCircleError(error)
  return ((data ?? []) as { id: string; created_at: string; resolved_at: string | null }[]).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }))
}
