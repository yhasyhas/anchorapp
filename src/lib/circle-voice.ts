import { supabase } from "@/lib/supabase"
import { bestEffortPost, CircleError } from "@/lib/circle"
import type { ReceivedVoiceEncouragement, SentVoiceEncouragement } from "@/types"

export const MAX_VOICE_ENCOURAGEMENT_SECONDS = 20
const SIGNED_URL_TTL_SECONDS = 60 * 60

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

// Dedicated private bucket (circle-voice), path `${senderId}/${recipientId}/${uuid}.webm`
// — see the migration's storage policies for why both segments matter.
// Upload is direct client -> Storage, same pattern as check-in voice notes
// (src/hooks/use-checkin.ts's uploadVoiceNote); the DB row is only created
// AFTER a successful upload, via RPC (which re-validates the path prefix,
// membership, duration, and rate limit server-side).
export async function sendVoiceEncouragement(
  senderId: string,
  recipientId: string,
  blob: Blob,
  durationSeconds: number,
  replyToId?: string | null
): Promise<void> {
  const path = `${senderId}/${recipientId}/${crypto.randomUUID()}.webm`

  const { error: uploadError } = await supabase.storage
    .from("circle-voice")
    .upload(path, blob, { contentType: "audio/webm", upsert: false })
  if (uploadError) throw new CircleError("upload_failed")

  const { error } = await supabase.rpc("circle_send_voice_encouragement", {
    p_recipient_id: recipientId,
    p_storage_path: path,
    p_duration_seconds: Math.round(durationSeconds),
    p_reply_to_id: replyToId ?? null,
  })
  if (error) {
    // Best-effort cleanup — the row failed, no reason to leave the file behind.
    supabase.storage.from("circle-voice").remove([path]).catch(() => {})
    throw toCircleError(error)
  }

  bestEffortPost("/api/circle/notify-voice-encouragement", { recipient_id: recipientId })
}

export async function listReceivedVoiceEncouragements(): Promise<ReceivedVoiceEncouragement[]> {
  const { data, error } = await supabase.rpc("circle_list_voice_encouragements_received")
  if (error) throw toCircleError(error)
  return (data ?? []) as ReceivedVoiceEncouragement[]
}

export async function listSentVoiceEncouragements(): Promise<SentVoiceEncouragement[]> {
  const { data, error } = await supabase.rpc("circle_list_voice_encouragements_sent")
  if (error) throw toCircleError(error)
  return (data ?? []) as SentVoiceEncouragement[]
}

export async function markVoiceEncouragementRead(id: string): Promise<void> {
  const { error } = await supabase.rpc("circle_mark_voice_encouragement_read", { p_id: id })
  if (error) throw toCircleError(error)
}

// Bucket is private — playback always goes through a freshly-signed URL,
// same reasoning as check-in voice notes.
export async function getVoiceEncouragementUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("circle-voice").createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) {
    console.error("Failed to sign circle voice URL:", error)
    return null
  }
  return data?.signedUrl ?? null
}
