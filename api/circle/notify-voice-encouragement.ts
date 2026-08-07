import { sendPushToUser } from "../send-push.js"

// Same reasoning as api/circle/notify-encouragement.ts: sendPushToUser
// pulls in `web-push`, which needs Node's crypto/https — unavailable on
// Vercel's Edge Runtime.
export const config = {
  runtime: "nodejs",
}

type Language = "en" | "sw"

// Sender's first name IS included here (unlike the text-encouragement
// push) — matches the product spec's own example copy verbatim ("A voice
// for you, from {firstName}"). Never the message content itself, which
// stays audio-only and un-transcribed by design.
const VOICE_ENCOURAGEMENT_PUSH: Record<Language, (firstName: string) => { title: string; body: string }> = {
  en: (firstName) => ({ title: "💛 A voice for you", body: `From ${firstName || "your circle"}` }),
  sw: (firstName) => ({ title: "💛 Sauti kwa ajili yako", body: `Kutoka kwa ${firstName || "mzunguko wako"}` }),
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

async function checkAndRecordRateLimit(
  subject: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  try {
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/action_rate_log?action=eq.notify-voice-encouragement&subject=eq.${encodeURIComponent(subject)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
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
      body: JSON.stringify({ action: "notify-voice-encouragement", subject }),
    })
    fetch(
      `${supabaseUrl}/rest/v1/action_rate_log?action=eq.notify-voice-encouragement&subject=eq.${encodeURIComponent(subject)}&created_at=lt.${encodeURIComponent(since)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
    ).catch(() => {})
    return true
  } catch {
    return true
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

// Confirms a real voice-encouragement row exists for this sender→recipient
// pair (created in the last minute) before pushing — stops this endpoint
// being usable to push-spam an arbitrary user_id, same pattern as
// notify-encouragement.ts's hasRecentEncouragement.
async function hasRecentVoiceEncouragement(
  senderId: string,
  recipientId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const res = await fetch(
    `${supabaseUrl}/rest/v1/circle_voice_encouragements?sender_id=eq.${encodeURIComponent(senderId)}&recipient_id=eq.${encodeURIComponent(recipientId)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
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

  const recent = await hasRecentVoiceEncouragement(caller.id, recipient_id, SUPABASE_URL, SERVICE_ROLE_KEY)
  if (!recent) {
    return jsonResponse({ error: "No recent voice encouragement found" }, 404)
  }

  const [sender, recipient] = await Promise.all([
    fetchProfile(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY),
    fetchProfile(recipient_id, SUPABASE_URL, SERVICE_ROLE_KEY),
  ])

  const language: Language = recipient?.preferred_language === "sw" ? "sw" : "en"
  const firstName = (sender?.full_name || "").trim().split(/\s+/)[0] || ""
  const { title, body: message } = VOICE_ENCOURAGEMENT_PUSH[language](firstName)

  try {
    const result = await sendPushToUser({ userId: recipient_id, title, body: message, url: "/circle" })
    return jsonResponse(result, 200)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Failed to send push" }, 502)
  }
}
