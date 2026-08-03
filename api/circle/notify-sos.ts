import { sendPushToUser } from "../send-push.js"

// Same reasoning as api/circle/notify-invite.ts: sendPushToUser pulls in
// `web-push`, which needs Node's crypto/https — unavailable on Vercel's Edge
// Runtime.
export const config = {
  runtime: "nodejs",
}

type Language = "en" | "sw"

// No mood, no reason, no content — only ever the sender's first name and the
// fact that she'd appreciate a word. Matches the product spec's push copy
// verbatim.
const SOS_PUSH: Record<Language, (firstName: string) => { title: string; body: string }> = {
  en: (firstName) => ({
    title: `${firstName} could use some love today 💛`,
    body: "A little warmth, no explanation needed.",
  }),
  sw: (firstName) => ({
    title: `${firstName} angependa upendo kidogo leo 💛`,
    body: "Neno dogo la joto, hakuna maelezo yanayohitajika.",
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

async function fetchActiveFriendIds(
  senderId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<string[]> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/circle_memberships?user_id=eq.${encodeURIComponent(senderId)}&status=eq.active&select=friend_id`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  )
  if (!res.ok) return []
  const rows = await res.json()
  return (rows as { friend_id: string }[]).map((r) => r.friend_id)
}

// Confirms a real SOS row exists for this sender (created in the last
// minute) before pushing — stops this endpoint being usable to push-spam an
// arbitrary circle. Same pattern as hasRecentEncouragement.
async function hasRecentSos(
  senderId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const res = await fetch(
    `${supabaseUrl}/rest/v1/circle_sos?sender_id=eq.${encodeURIComponent(senderId)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
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

  const recent = await hasRecentSos(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY)
  if (!recent) {
    return jsonResponse({ error: "No recent SOS found" }, 404)
  }

  const [sender, friendIds] = await Promise.all([
    fetchProfile(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY),
    fetchActiveFriendIds(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY),
  ])

  if (friendIds.length === 0) {
    return jsonResponse({ sent: 0, expired: 0 }, 200)
  }

  const firstName = sender?.full_name?.split(" ")[0] || (sender?.preferred_language === "sw" ? "Rafiki yako" : "A friend")

  const results = await Promise.all(
    friendIds.map(async (friendId) => {
      const friendProfile = await fetchProfile(friendId, SUPABASE_URL, SERVICE_ROLE_KEY)
      const language: Language = friendProfile?.preferred_language === "sw" ? "sw" : "en"
      const { title, body: message } = SOS_PUSH[language](firstName)
      try {
        return await sendPushToUser({ userId: friendId, title, body: message, url: "/circle" })
      } catch {
        return { sent: 0, expired: 0 }
      }
    })
  )

  const totals = results.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, expired: acc.expired + r.expired }),
    { sent: 0, expired: 0 }
  )

  return jsonResponse(totals, 200)
}
