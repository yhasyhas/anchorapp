import webpush from "web-push"
import { timingSafeEqual } from "node:crypto"

// Deliberately NOT `runtime: "edge"` (unlike api/insights.ts): `web-push` signs
// VAPID JWTs and encrypts payloads using Node's `crypto`/`https` modules, which
// aren't available in Vercel's Edge Runtime. This one function stays on the
// default Node.js serverless runtime instead — everything else about it (Web
// Request/Response signature, env var access) matches the rest of /api.
export const config = {
  runtime: "nodejs",
}

interface PushSubscriptionRow {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface SendPushParams {
  userId: string
  title: string
  body: string
  url?: string
}

export interface SendPushResult {
  sent: number
  expired: number
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // timingSafeEqual throws on mismatched lengths rather than returning false,
  // and a length check alone leaks no more than the secret's own length would.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

// Core send logic, shared by the HTTP handler below (external callers,
// authenticated via x-push-secret) and api/cron/reminders.ts, which imports
// this function directly and calls it in-process — same code, no duplicated
// webpush/Supabase logic, no extra HTTP hop for a same-deployment caller.
export async function sendPushToUser({ userId, title, body: message, url }: SendPushParams): Promise<SendPushResult> {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("Server misconfigured: missing Supabase/VAPID env vars")
  }

  webpush.setVapidDetails("mailto:support@anchorapp.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  // Service-role key: this call has no end-user session to scope a request
  // with (it's triggered by a scheduler on behalf of a given user_id), so RLS
  // can't apply here the way it does for the rest of the app's REST calls.
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=endpoint,keys`,
    {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
    }
  )

  if (!subsRes.ok) {
    throw new Error("Could not load subscriptions")
  }

  const subscriptions = (await subsRes.json()) as PushSubscriptionRow[]
  if (subscriptions.length === 0) {
    return { sent: 0, expired: 0 }
  }

  const payload = JSON.stringify({ title, body: message, url: url || "/" })

  let sent = 0
  const expiredEndpoints: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
        sent++
      } catch (err: any) {
        // 404/410: the push service has permanently invalidated this
        // subscription (uninstalled, expired, browser data cleared) — prune
        // it so future sends don't keep paying for a dead endpoint. Any other
        // error (e.g. transient 429/5xx) is left alone; it may still work
        // next time and isn't evidence the subscription itself is bad.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expiredEndpoints.push(sub.endpoint)
        }
      }
    })
  )

  if (expiredEndpoints.length > 0) {
    await Promise.all(
      expiredEndpoints.map((endpoint) =>
        fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            apikey: SERVICE_ROLE_KEY,
          },
        }).catch(() => {})
      )
    )
  }

  return { sent, expired: expiredEndpoints.length }
}

// Vercel's Node.js runtime (unlike Edge) doesn't hand a real Fetch API
// Request/Response to a plain `export default` — it falls back to the
// legacy (req, res) signature, silently drops any Response we return
// (hang), and `req.headers` isn't a Headers instance (no .get()). A named
// export matching the HTTP method is what actually gets treated as a
// Fetch-style handler on this runtime. Learned the hard way: verified via
// Vercel's own function logs after the first deploy hung indefinitely.
export async function POST(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const PUSH_SEND_SECRET = process.env.PUSH_SEND_SECRET
  if (!PUSH_SEND_SECRET) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }

  // Trusted server-to-server call only — this must NEVER accept a regular user
  // JWT, since anyone holding one could otherwise push a notification to any
  // other user. Only a caller who knows this shared secret may invoke it (a
  // cron job / internal scheduler), which is why it's a dedicated header and
  // not the usual Authorization: Bearer <user token> pattern used elsewhere.
  const providedSecret = request.headers.get("x-push-secret") || ""
  if (!safeEqual(providedSecret, PUSH_SEND_SECRET)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400)
  }

  const { user_id, title, body: message, url } = body || {}
  if (typeof user_id !== "string" || typeof title !== "string" || typeof message !== "string") {
    return jsonResponse({ error: "user_id, title and body are required strings" }, 400)
  }
  if (url !== undefined && typeof url !== "string") {
    return jsonResponse({ error: "url must be a string" }, 400)
  }

  try {
    const result = await sendPushToUser({ userId: user_id, title, body: message, url })
    return jsonResponse(result, 200)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Failed to send push" }, 502)
  }
}
