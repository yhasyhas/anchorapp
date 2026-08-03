import { sendPushToUser } from "../send-push.js"

// Same reasoning as api/send-push.ts / api/cron/weekly-letter.ts: sendPushToUser
// pulls in `web-push`, which needs Node's crypto/https — unavailable on Vercel's
// Edge Runtime. This route stays on the default Node.js serverless runtime.
export const config = {
  runtime: "nodejs",
}

type Language = "en" | "sw"

const INVITE_PUSH: Record<Language, (inviterName: string) => { title: string; body: string }> = {
  en: (inviterName) => ({
    title: "A circle invitation 💜",
    body: `${inviterName} invited you to her Circle of Trust. Open Settings to accept.`,
  }),
  sw: (inviterName) => ({
    title: "Mwaliko wa mzunguko 💜",
    body: `${inviterName} amekualika kwenye Mzunguko wake wa Kuaminiana. Fungua Mipangilio ili ukubali.`,
  }),
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

// Verifies the caller's Supabase JWT via the auth API — duplicated from
// api/insights.ts's getAuthenticatedUser rather than imported, same reasoning
// as elsewhere in this repo: that helper lives in an edge-runtime file bundled
// separately from this Node-runtime one.
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

async function fetchProfile(
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{ full_name: string; preferred_language: Language } | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=full_name,preferred_language`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows[0] ?? null
}

async function hasPendingInvite(
  inviterId: string,
  friendId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/circle_memberships?user_id=eq.${encodeURIComponent(inviterId)}&friend_id=eq.${encodeURIComponent(friendId)}&status=eq.pending&select=id`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  )
  if (!res.ok) return false
  const rows = await res.json()
  return rows.length > 0
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

  const caller = await getAuthenticatedUser(token, SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!caller) return jsonResponse({ error: "Unauthorized" }, 401)

  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400)
  }

  const { friend_id } = body || {}
  if (typeof friend_id !== "string") {
    return jsonResponse({ error: "friend_id is required" }, 400)
  }

  // Only notify if this really is a pending invite the caller just created —
  // stops this endpoint being usable to push-spam an arbitrary user_id.
  const pending = await hasPendingInvite(caller.id, friend_id, SUPABASE_URL, SERVICE_ROLE_KEY)
  if (!pending) {
    return jsonResponse({ error: "No pending invite found" }, 404)
  }

  const [inviter, invitee] = await Promise.all([
    fetchProfile(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY),
    fetchProfile(friend_id, SUPABASE_URL, SERVICE_ROLE_KEY),
  ])

  const language: Language = invitee?.preferred_language === "sw" ? "sw" : "en"
  const inviterName = inviter?.full_name || (language === "sw" ? "Rafiki yako" : "A friend")
  const { title, body: message } = INVITE_PUSH[language](inviterName)

  try {
    const result = await sendPushToUser({ userId: friend_id, title, body: message, url: "/settings" })
    return jsonResponse(result, 200)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Failed to send push" }, 502)
  }
}
