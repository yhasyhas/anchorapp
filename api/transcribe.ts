// Voice-note transcription (Groq Whisper). Same shape as api/insights.ts:
// JWT auth via Supabase's own /auth/v1/user endpoint (no service-role key
// needed), rate-limited through the existing ai_request_log table shared
// with the insights/companion Edge Function — one quota, not a second one
// to reason about. Runs on the Edge runtime, same as api/insights.ts (no
// Node-only APIs needed here, unlike the web-push functions).
export const config = {
  runtime: "edge",
}

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 heure
// 60s max recording client-side (see checkin.tsx) at typical webm/opus voice
// bitrates lands well under 1MB — 8MB leaves generous headroom without
// letting someone stream an arbitrarily large body through this endpoint.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024

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

// Same as api/insights.ts's own copy — duplicated rather than imported,
// each Vercel function is bundled separately.
async function getAuthenticatedUser(
  token: string,
  supabaseUrl: string,
  anonKey: string
): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    })
    if (!res.ok) return null
    const user = await res.json()
    return typeof user?.id === "string" ? { id: user.id } : null
  } catch {
    return null
  }
}

// Same rate-limit table and logic as api/insights.ts (see that file's own
// comment for the full reasoning) — duplicated for the same bundling reason.
async function checkAndRecordRateLimit(
  userId: string,
  token: string,
  supabaseUrl: string,
  anonKey: string
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

  try {
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/ai_request_log?user_id=eq.${userId}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          Prefer: "count=exact",
        },
      }
    )

    if (countRes.ok) {
      const contentRange = countRes.headers.get("content-range")
      const total = contentRange ? Number(contentRange.split("/")[1]) : NaN
      if (Number.isFinite(total) && total >= RATE_LIMIT_MAX) {
        return false
      }
    }

    await fetch(`${supabaseUrl}/rest/v1/ai_request_log`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ user_id: userId }),
    })

    fetch(
      `${supabaseUrl}/rest/v1/ai_request_log?user_id=eq.${userId}&created_at=lt.${encodeURIComponent(since)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      }
    ).catch(() => {})

    return true
  } catch {
    return true
  }
}

// whisper-large-v3-turbo: Groq's fast/cheap Whisper variant — a quick voice
// note is a "transcription in a few seconds" UX, not a batch job, and the
// accuracy tradeoff vs full whisper-large-v3 is minor for short personal
// reflections. Whisper is natively multilingual, so no `language` param is
// sent — EN/SW are both auto-detected from the audio itself.
async function transcribeWithGroq(audio: ArrayBuffer, contentType: string, apiKey: string): Promise<string> {
  const form = new FormData()
  const blob = new Blob([audio], { type: contentType || "audio/webm" })
  form.append("file", blob, "voice-note.webm")
  form.append("model", "whisper-large-v3-turbo")
  form.append("response_format", "json")

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const details = await response.text().catch(() => "")
    throw new Error(`Groq transcription error: ${response.status} ${details}`)
  }

  const json = (await response.json()) as any
  return typeof json.text === "string" ? json.text.trim() : ""
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

  if (!GROQ_API_KEY) {
    return jsonResponse({ error: "API key not configured" }, 500)
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }

  const token = extractBearerToken(request)
  if (!token) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const user = await getAuthenticatedUser(token, SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const allowed = await checkAndRecordRateLimit(user.id, token, SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!allowed) {
    return jsonResponse({ error: "Rate limit exceeded. Try again later." }, 429)
  }

  const contentType = request.headers.get("content-type") || ""
  if (!contentType.startsWith("audio/")) {
    return jsonResponse({ error: "Content-Type must be an audio/* type" }, 400)
  }

  const audio = await request.arrayBuffer()
  if (audio.byteLength === 0) {
    return jsonResponse({ error: "Empty audio" }, 400)
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: "Audio too large" }, 400)
  }

  try {
    const text = await transcribeWithGroq(audio, contentType, GROQ_API_KEY)
    return jsonResponse({ text }, 200)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Transcription failed" }, 502)
  }
}
