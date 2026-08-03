import { supabase } from "@/lib/supabase"
import type {
  CircleInvite,
  CircleMembership,
  CirclePresence,
  EncouragementPresetKey,
  ReceivedEncouragement,
  SentEncouragement,
  SharedLetter,
} from "@/types"

export const MAX_CIRCLE_MEMBERS = 2

// Postgres functions raise `RAISE EXCEPTION '<code>'`, which postgrest-js
// surfaces as error.message === '<code>' — this wraps that so callers can
// switch on a stable code (circle_full, already_member, ...) rather than
// pattern-matching a Postgres error string, and translate it via i18n.
export class CircleError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

export async function listMemberships(): Promise<CircleMembership[]> {
  const { data, error } = await supabase
    .from("circle_memberships")
    .select("*")
    .order("invited_at", { ascending: false })
  if (error) throw toCircleError(error)
  return (data ?? []) as CircleMembership[]
}

// Pending invites the caller RECEIVED (someone else invited her) — a single
// targeted query rather than listMemberships() + client-side filtering, so
// call sites that only need this (the home screen badge/nudge) don't pull
// every membership row just to check for one thing.
export async function listPendingReceivedInvites(userId: string): Promise<CircleMembership[]> {
  const { data, error } = await supabase
    .from("circle_memberships")
    .select("*")
    .eq("status", "pending")
    .neq("invited_by", userId)
  if (error) throw toCircleError(error)
  return (data ?? []) as CircleMembership[]
}

// Email invites still awaiting signup (invite-by-email branch, no account
// existed yet at invite time). RLS already scopes this to the caller's own
// sent invites.
export async function listSentEmailInvites(): Promise<CircleInvite[]> {
  const { data, error } = await supabase
    .from("circle_invites")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
  if (error) throw toCircleError(error)
  return (data ?? []) as CircleInvite[]
}

export async function getMemberNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc("circle_get_member_names")
  if (error) throw toCircleError(error)
  const map: Record<string, string> = {}
  for (const row of (data ?? []) as { friend_id: string; full_name: string }[]) {
    map[row.friend_id] = row.full_name
  }
  return map
}

export interface InviteByEmailResult {
  matched: boolean
  friendId?: string
  token?: string
  inviteeEmail?: string
}

export async function inviteByEmail(email: string): Promise<InviteByEmailResult> {
  const { data, error } = await supabase.rpc("circle_invite_by_email", { p_email: email })
  if (error) throw toCircleError(error)
  const result = data as { matched: boolean; friend_id?: string; token?: string; invitee_email?: string }
  return {
    matched: result.matched,
    friendId: result.friend_id,
    token: result.token,
    inviteeEmail: result.invitee_email,
  }
}

export async function acceptPending(inviterId: string): Promise<void> {
  const { error } = await supabase.rpc("circle_accept_pending", { p_inviter_id: inviterId })
  if (error) throw toCircleError(error)
}

export async function declinePending(inviterId: string): Promise<void> {
  const { error } = await supabase.rpc("circle_decline_pending", { p_inviter_id: inviterId })
  if (error) throw toCircleError(error)
}

export async function removeMember(friendId: string): Promise<void> {
  const { error } = await supabase.rpc("circle_remove_member", { p_friend_id: friendId })
  if (error) throw toCircleError(error)
}

export interface InvitePreview {
  status: "invalid" | "expired" | "accepted" | "pending"
  inviterName?: string
  inviteeEmail?: string
  expiresAt?: string
}

export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const { data, error } = await supabase.rpc("circle_get_invite_preview", { p_token: token })
  if (error) throw toCircleError(error)
  const result = data as { status: string; inviter_name?: string; invitee_email?: string; expires_at?: string }
  return {
    status: result.status as InvitePreview["status"],
    inviterName: result.inviter_name,
    inviteeEmail: result.invitee_email,
    expiresAt: result.expires_at,
  }
}

export async function acceptInviteByToken(token: string): Promise<void> {
  const { error } = await supabase.rpc("circle_accept_invite_by_token", { p_token: token })
  if (error) throw toCircleError(error)
}

// Best-effort side effects after a successful write (invite, encouragement,
// SOS...) — the underlying row already exists by the time these run, so a
// failure here (offline, provider hiccup) is a soft miss, never a reason to
// roll back or re-surface an error to the caller. Exported so other
// circle-adjacent modules (e.g. circle-sos.ts) can reuse the same
// session/fetch plumbing instead of duplicating it.
export async function bestEffortPost(path: string, body: unknown): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return
  try {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
  } catch {
    // best-effort — see comment above
  }
}

export function notifyExistingUserInvite(friendId: string): Promise<void> {
  return bestEffortPost("/api/circle/notify-invite", { friend_id: friendId })
}

export function sendInviteEmail(token: string): Promise<void> {
  return bestEffortPost("/api/circle/send-invite-email", { token })
}

// ============================================================================
// Shared experience: presence, encouragements, shared letters
// ============================================================================

export async function getPresenceToday(): Promise<CirclePresence[]> {
  const { data, error } = await supabase.rpc("circle_get_presence_today")
  if (error) throw toCircleError(error)
  return (data ?? []) as CirclePresence[]
}

export async function sendEncouragement(
  recipientId: string,
  message: string,
  isPreset: boolean
): Promise<void> {
  const { error } = await supabase.rpc("circle_send_encouragement", {
    p_recipient_id: recipientId,
    p_message: message,
    p_is_preset: isPreset,
  })
  if (error) throw toCircleError(error)
  // Best-effort push — the encouragement row already exists by the time
  // this runs, same reasoning as notifyExistingUserInvite.
  bestEffortPost("/api/circle/notify-encouragement", { recipient_id: recipientId })
}

export async function sendPresetEncouragement(recipientId: string, presetKey: EncouragementPresetKey): Promise<void> {
  return sendEncouragement(recipientId, presetKey, true)
}

export async function listReceivedEncouragements(): Promise<ReceivedEncouragement[]> {
  const { data, error } = await supabase.rpc("circle_list_encouragements_received")
  if (error) throw toCircleError(error)
  return (data ?? []) as ReceivedEncouragement[]
}

export async function listSentEncouragements(): Promise<SentEncouragement[]> {
  const { data, error } = await supabase.rpc("circle_list_encouragements_sent")
  if (error) throw toCircleError(error)
  return (data ?? []) as SentEncouragement[]
}

export async function markEncouragementRead(id: string): Promise<void> {
  const { error } = await supabase.rpc("circle_mark_encouragement_read", { p_id: id })
  if (error) throw toCircleError(error)
}

export async function getSharedLetters(): Promise<SharedLetter[]> {
  const { data, error } = await supabase.rpc("circle_get_shared_letters")
  if (error) throw toCircleError(error)
  return (data ?? []) as SharedLetter[]
}
