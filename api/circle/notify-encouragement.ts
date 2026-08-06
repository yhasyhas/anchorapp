import { sendPushToUser } from "../send-push.js"

// Same reasoning as api/circle/notify-invite.ts: sendPushToUser pulls in
// `web-push`, which needs Node's crypto/https — unavailable on Vercel's Edge
// Runtime.
export const config = {
  runtime: "nodejs",
}

type Language = "en" | "sw"

// Deliberately generic, no sender name — matches the product spec's own
// example copy verbatim. The sender's identity is shown inside the app
// (the encouragement card), not in the push itself.
const ENCOURAGEMENT_PUSH: Record<Language, { title: string; body: string }> = {
  en: { title: "💛 A little love from your circle", body: "Someone in your circle is thinking of you." },
  sw: { title: "💛 Upendo kidogo kutoka kwa mzunguko wako", body: "Mtu kwenye mzunguko wako anakufikiria." },
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

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 heure

// Rate limit via action_rate_log (service-role key, same as every other
// query in this file) — see the migration's comment for why this is a
// separate table from ai_request_log.
async function checkAndRecordRateLimit(
  subject: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  try {
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/action_rate_log?action=eq.notify-encouragement&subject=eq.${encodeURIComponent(subject)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, Prefer: "count=exact" },
      }
    )
    if (countRes.ok) {
      const contentRange = countRes.headers.get("content-range")
      const total = contentRange ? Number(contentRange.split("/")[1]) : NaN
      if (Number.isFinite(total) && total >= RATE_LIMIT_MAX) return false
    }
    await fetch(`${supabaseUrl}/rest/v1/action_rate_log`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ action: "notify-encouragement", subject }),
    })
    fetch(
      `${supabaseUrl}/rest/v1/action_rate_log?action=eq.notify-encouragement&subject=eq.${encodeURIComponent(subject)}&created_at=lt.${encodeURIComponent(since)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
    ).catch(() => {})
    return true
  } catch {
    return true
  }
}

async function fetchPreferredLanguage(
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<Language> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=preferred_language`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  )
  if (!res.ok) return "en"
  const rows = await res.json()
  return rows[0]?.preferred_language === "sw" ? "sw" : "en"
}

// Confirms a real encouragement row exists for this sender→recipient pair
// (created in the last minute) before pushing — stops this endpoint being
// usable to push-spam an arbitrary user_id.
async function hasRecentEncouragement(
  senderId: string,
  recipientId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const res = await fetch(
    `${supabaseUrl}/rest/v1/circle_encouragements?sender_id=eq.${encodeURIComponent(senderId)}&recipient_id=eq.${encodeURIComponent(recipientId)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
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

  const allowed = await checkAndRecordRateLimit(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY)
  if (!allowed) {
    return jsonResponse({ error: "Rate limit exceeded. Try again later." }, 429)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400)
  }

  const { recipient_id } = body || {}
  if (typeof recipient_id !== "string") {
    return jsonResponse({ error: "recipient_id is required" }, 400)
  }

  const recent = await hasRecentEncouragement(caller.id, recipient_id, SUPABASE_URL, SERVICE_ROLE_KEY)
  if (!recent) {
    return jsonResponse({ error: "No recent encouragement found" }, 404)
  }

  const language = await fetchPreferredLanguage(recipient_id, SUPABASE_URL, SERVICE_ROLE_KEY)
  const { title, body: message } = ENCOURAGEMENT_PUSH[language]

  try {
    const result = await sendPushToUser({ userId: recipient_id, title, body: message, url: "/circle" })
    return jsonResponse(result, 200)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Failed to send push" }, 502)
  }
}
