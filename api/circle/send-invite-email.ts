export const config = {
  runtime: "edge",
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

// Duplicated from api/insights.ts's getAuthenticatedUser rather than shared —
// this function is bundled separately per Edge Function, same reasoning noted
// throughout the rest of /api.
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

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 heure

// Rate limit via action_rate_log (service-role key, same as every other
// query in this file) — bounds how many times an inviter can (re)trigger an
// email send for her own invites. See the migration's comment for why this
// is a separate table from ai_request_log.
async function checkAndRecordRateLimit(
  subject: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  try {
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/action_rate_log?action=eq.invite-email&subject=eq.${encodeURIComponent(subject)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
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
      body: JSON.stringify({ action: "invite-email", subject }),
    })
    fetch(
      `${supabaseUrl}/rest/v1/action_rate_log?action=eq.invite-email&subject=eq.${encodeURIComponent(subject)}&created_at=lt.${encodeURIComponent(since)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
    ).catch(() => {})
    return true
  } catch {
    // fail open — an infra hiccup here must never block a legitimate invite send
    return true
  }
}

interface InviteRow {
  id: string
  token: string
  inviter_id: string
  invitee_email: string
  status: string
  expires_at: string
}

async function fetchInvite(
  token: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<InviteRow | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/circle_invites?token=eq.${encodeURIComponent(token)}&select=*`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows[0] ?? null
}

async function fetchInviterName(
  inviterId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<string | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(inviterId)}&select=full_name`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows[0]?.full_name ?? null
}

// Bilingual (EN + SW stacked in one email) per the product spec — we don't
// know the invitee's language preference before she has an account, so
// rather than guessing we show both, same spirit as the hardcoded bilingual
// fallback strings in ai-service.ts's generateCompanionMessage.
function buildEmail(inviterName: string, inviteUrl: string): { subject: string; html: string; text: string } {
  const subject = `${inviterName} invited you to her Circle of Trust 💜`

  const text = [
    `${inviterName} invited you to join her Circle of Trust on Anchor — a small, private space for 1-2 close friends to encourage each other. No feed, no likes, no comparisons. Just quiet support.`,
    ``,
    `Join her circle: ${inviteUrl}`,
    ``,
    `This link expires in 7 days.`,
    ``,
    `---`,
    ``,
    `${inviterName} amekualika kwenye Mzunguko wake wa Kuaminiana kwenye Anchor — nafasi ndogo ya faragha kwa marafiki 1-2 wa karibu kutiana moyo. Hakuna mlisho wa habari, hakuna 'likes', hakuna kulinganisha. Ni msaada wa utulivu tu.`,
    ``,
    `Jiunge na mzunguko wake: ${inviteUrl}`,
    ``,
    `Kiungo hiki kinaisha baada ya siku 7.`,
  ].join("\n")

  const html = `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #2d2d2d;">
      <p style="font-size: 15px; line-height: 1.6;">
        <strong>${inviterName}</strong> invited you to join her <strong>Circle of Trust</strong> on Anchor —
        a small, private space for 1–2 close friends to encourage each other. No feed, no likes, no
        comparisons. Just quiet support.
      </p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="background: #7c9885; color: #ffffff; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-size: 14px;">
          Join her circle
        </a>
      </p>
      <p style="font-size: 12px; color: #888;">This link expires in 7 days.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;" />
      <p style="font-size: 15px; line-height: 1.6;">
        <strong>${inviterName}</strong> amekualika kwenye <strong>Mzunguko wake wa Kuaminiana</strong> kwenye Anchor —
        nafasi ndogo ya faragha kwa marafiki 1–2 wa karibu kutiana moyo. Hakuna mlisho wa habari, hakuna "likes",
        hakuna kulinganisha. Ni msaada wa utulivu tu.
      </p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="background: #7c9885; color: #ffffff; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-size: 14px;">
          Jiunge na mzunguko wake
        </a>
      </p>
      <p style="font-size: 12px; color: #888;">Kiungo hiki kinaisha baada ya siku 7.</p>
    </div>
  `

  return { subject, html, text }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const SMTP2GO_API_KEY = process.env.SMTP2GO_API_KEY
  const SMTP2GO_SENDER_EMAIL = process.env.SMTP2GO_SENDER_EMAIL

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }
  if (!SMTP2GO_API_KEY || !SMTP2GO_SENDER_EMAIL) {
    return jsonResponse({ error: "Email provider not configured" }, 500)
  }

  const bearerToken = extractBearerToken(request)
  if (!bearerToken) return jsonResponse({ error: "Unauthorized" }, 401)

  const caller = await getAuthenticatedUser(bearerToken, SUPABASE_URL, SUPABASE_ANON_KEY)
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

  const { token } = body || {}
  if (typeof token !== "string") {
    return jsonResponse({ error: "token is required" }, 400)
  }

  const invite = await fetchInvite(token, SUPABASE_URL, SERVICE_ROLE_KEY)
  if (!invite) return jsonResponse({ error: "Invite not found" }, 404)

  // Only the inviter herself may trigger the send for her own invite.
  if (invite.inviter_id !== caller.id) {
    return jsonResponse({ error: "Unauthorized" }, 403)
  }
  if (invite.status !== "pending" || new Date(invite.expires_at) < new Date()) {
    return jsonResponse({ error: "Invite is no longer active" }, 410)
  }

  const inviterName = (await fetchInviterName(caller.id, SUPABASE_URL, SERVICE_ROLE_KEY)) || "A friend"

  const appUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  const inviteUrl = `${appUrl}/circle/invite/${invite.token}`
  const { subject, html, text } = buildEmail(inviterName, inviteUrl)

  try {
    const res = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: SMTP2GO_API_KEY,
        to: [invite.invitee_email],
        sender: SMTP2GO_SENDER_EMAIL,
        subject,
        html_body: html,
        text_body: text,
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      return jsonResponse({ error: "Email send failed", detail }, 502)
    }
    return jsonResponse({ sent: true }, 200)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Failed to send email" }, 502)
  }
}
