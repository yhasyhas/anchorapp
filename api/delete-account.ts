// Node runtime (not edge): needs the Supabase Admin API to actually remove
// the auth.users row, same reasoning as api/circle/notify-sos.ts for why
// this can't be an edge function.
export const config = {
  runtime: "nodejs",
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")
  if (!header?.startsWith("Bearer ")) return null
  const token = header.slice(7).trim()
  return token || null
}

// Duplicated from api/insights.ts's getAuthenticatedUser rather than shared
// — this Node-runtime file is bundled separately, same reasoning as
// elsewhere in /api.
async function getAuthenticatedUser(
  token: string,
  supabaseUrl: string,
  anonKey: string
): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    })
    if (!res.ok) return null
    const user = await res.json()
    return typeof user?.id === "string" ? { id: user.id } : null
  } catch {
    return null
  }
}

// Removes every object under this user's own folder in the private
// voice-notes bucket (see supabase/migrations/20260802190000_voice_transcript_and_private_bucket.sql
// — uploads go to `${user.id}/${date}.webm`, one folder per user). Postgres
// rows cascade-delete automatically once the auth user is gone below (every
// user_id column across profiles/daily_anchors/mood_logs/check_ins/
// gratitudes/journal_entries/weekly_letters/monthly_recaps/move_suggestions/
// insight_log/ai_request_log/push_subscriptions/notification_preferences/
// notification_log/circle_memberships/circle_invites/circle_encouragements/
// circle_sos is `REFERENCES auth.users(id) ON DELETE CASCADE`), but Storage
// objects aren't part of that FK graph and would otherwise be orphaned
// forever. Best-effort: a stray recording must never block account deletion.
async function deleteVoiceNotes(userId: string, supabaseUrl: string, serviceRoleKey: string): Promise<void> {
  try {
    const listRes = await fetch(`${supabaseUrl}/storage/v1/object/list/voice-notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }),
    })
    if (!listRes.ok) return

    const entries = (await listRes.json()) as { name: string }[]
    if (!Array.isArray(entries) || entries.length === 0) return

    await fetch(`${supabaseUrl}/storage/v1/object/voice-notes`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: entries.map((e) => `${userId}/${e.name}`) }),
    })
  } catch {
    // best-effort — see comment above
  }
}

export async function POST(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }

  const token = extractBearerToken(request)
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401)

  // Verifies the caller's own JWT — she can only ever delete her own
  // account, there is no userId param anywhere in this request.
  const caller = await getAuthenticatedUser(token, SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!caller) return jsonResponse({ error: "Unauthorized" }, 401)

  await deleteVoiceNotes(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY)

  const deleteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
  })

  if (!deleteRes.ok) {
    const err = await deleteRes.text()
    return jsonResponse({ error: `Failed to delete account: ${deleteRes.status}`, details: err }, 502)
  }

  return jsonResponse({ deleted: true }, 200)
}
