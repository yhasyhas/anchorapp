export const config = {
  runtime: "edge",
}

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 heure
const MAX_BODY_BYTES = 100_000 // garde-fou anti-abus, largement au-dessus d'un payload légitime
const MAX_ARRAY_LEN = 90 // ~3 mois de données quotidiennes, marge au-delà des 30 jours utilisés côté client

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

// Vérifie le JWT Supabase via l'API auth (endpoint /auth/v1/user) — pas besoin d'une
// clé service-role, l'anon key + le token de l'utilisateur suffisent à le valider.
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

// Rate limit 30 req/h par utilisateur, via une table Supabase (ai_request_log) plutôt
// qu'un service externe — pas de nouvelle dépendance, et RLS protège déjà chaque ligne
// par user_id comme le reste du schéma. On appelle PostgREST avec le JWT de l'utilisateur
// (déjà vérifié ci-dessus), donc aucune clé service-role n'est nécessaire ici non plus.
// Si la vérification elle-même échoue (table absente, réseau...), on "fail open" : on ne
// bloque pas un utilisateur légitime pour une panne d'infra — le vrai filet de sécurité
// contre l'abus reste l'auth JWT + la validation du body.
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
      const contentRange = countRes.headers.get("content-range") // format "0-9/42"
      const total = contentRange ? Number(contentRange.split("/")[1]) : NaN
      if (Number.isFinite(total) && total >= RATE_LIMIT_MAX) {
        return false
      }
    }

    // Enregistre cette requête (best-effort — un échec d'écriture ne doit pas bloquer l'appel)
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

    // Auto-nettoyage : supprime les entrées de cet utilisateur devenues inutiles pour le
    // calcul du quota (plus vieilles que la fenêtre d'1h). Fait à chaque appel plutôt que
    // via un cron — la table reste bornée sans job planifié ni clé service-role, chaque
    // utilisateur ne nettoyant que ses propres lignes (RLS).
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

function validateInsightsBody(body: any): string | null {
  if (!Array.isArray(body.moods)) return "moods must be an array"
  if (!Array.isArray(body.anchors)) return "anchors must be an array"
  if (body.moods.length > MAX_ARRAY_LEN) return `moods array too large (max ${MAX_ARRAY_LEN})`
  if (body.anchors.length > MAX_ARRAY_LEN) return `anchors array too large (max ${MAX_ARRAY_LEN})`
  if (body.checkIns !== undefined) {
    if (!Array.isArray(body.checkIns)) return "checkIns must be an array"
    if (body.checkIns.length > MAX_ARRAY_LEN) return `checkIns array too large (max ${MAX_ARRAY_LEN})`
  }
  for (const m of body.moods) {
    if (typeof m !== "object" || m === null || typeof m.date !== "string" || typeof m.mood !== "string") {
      return "invalid mood entry"
    }
  }
  for (const a of body.anchors) {
    if (typeof a !== "object" || a === null || typeof a.date !== "string") {
      return "invalid anchor entry"
    }
  }
  return null
}

function validateCompanionBody(body: any): string | null {
  if (body.todayIntention !== undefined && typeof body.todayIntention !== "string") {
    return "todayIntention must be a string"
  }
  if (body.language !== undefined && body.language !== "en" && body.language !== "sw") {
    return "invalid language"
  }
  if (body.yesterdayMood !== undefined && body.yesterdayMood !== null && typeof body.yesterdayMood !== "string") {
    return "invalid yesterdayMood"
  }
  if (
    body.yesterdayCheckIn !== undefined &&
    body.yesterdayCheckIn !== null &&
    typeof body.yesterdayCheckIn !== "object"
  ) {
    return "invalid yesterdayCheckIn"
  }
  return null
}

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY
  // Réutilise les mêmes URL/anon key que le client (VITE_*) — ce sont des valeurs
  // publiques par conception (le client les embarque déjà), donc pas de nouveau secret
  // à provisionner pour cette Edge Function.
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

  const rawBody = await request.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 400)
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400)
  }

  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "Invalid body" }, 400)
  }

  const { type = "insights" } = body

  try {
    if (type === "companion") {
      const validationError = validateCompanionBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleCompanion(body, GROQ_API_KEY)
    }

    const validationError = validateInsightsBody(body)
    if (validationError) return jsonResponse({ error: validationError }, 400)
    return await handleInsights(body, GROQ_API_KEY)
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Unknown error" }, 500)
  }
}

async function handleInsights(body: any, apiKey: string) {
  const { moods, anchors, checkIns } = body
  const data = buildPatternData(moods, anchors, checkIns)

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: `Analyze these patterns and generate 3 personalized insights:\n\n${JSON.stringify(data, null, 2)}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return new Response(
      JSON.stringify({ error: `Groq error: ${response.status}`, details: err }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    )
  }

  const json = await response.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) {
    return new Response(JSON.stringify({ error: "Empty response from AI" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })
  }

  const parsed = JSON.parse(content)
  const insights = Array.isArray(parsed) ? parsed : parsed.insights || []

  return new Response(JSON.stringify({ insights: insights.slice(0, 3) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

async function handleCompanion(body: any, apiKey: string) {
  const { yesterdayMood, yesterdayCheckIn, todayIntention, language = "en" } = body

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are Anchor, a gentle morning companion. Write ONE short, warm sentence (max 15 words) to greet the user this morning.

Rules:
- Warm, spiritual but not religious, like a wise friend
- If they carried something heavy, be extra gentle
- If they had a good day, celebrate it subtly
- Suggest one tiny intention for today
- Max 15 words
- Respond in ${language === "sw" ? "Swahili" : "English"}

Examples:
- "Yesterday you chose Peace — let it carry you gently through today."
- "You felt heavy last night. Today, permission to move slowly."
- "Clarity called you three times. Today, listen closer."`,
        },
        {
          role: "user",
          content: `Yesterday's context:
- Mood: ${yesterdayMood || "unknown"}
- What felt real: ${yesterdayCheckIn?.what_felt_real || "none"}
- What matters: ${yesterdayCheckIn?.what_matters || "none"}
- Today's intention: ${todayIntention || "none"}

Generate one warm morning sentence.`,
        },
      ],
      temperature: 0.5,
      max_tokens: 100,
    }),
  })

  if (!response.ok) {
    return new Response(JSON.stringify({ message: "Good morning — set a gentle intention for today." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const json = await response.json()
  const message = json.choices?.[0]?.message?.content?.trim() || "Good morning — set a gentle intention for today."

  return new Response(JSON.stringify({ message }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function buildSystemPrompt(): string {
  return `You are Anchor, a compassionate life-alignment companion. You help a young woman understand herself better through gentle, spiritual, and emotionally intelligent insights.

RULES:
- TONE: Warm, gentle, supportive. Like a wise friend, not a therapist. Use spiritual but not religious language. Speak to her soul.
- LENGTH: Each insight must be 1-2 sentences max.
- FORMAT: Return ONLY a JSON array like: [{"text": "...", "category": "mood_action_correlation"|"pattern"|"suggestion"}]
- NEVER diagnose (no "you have anxiety", instead "you seem to carry a heavy weight")
- Always pair observation with compassion
- If data is sparse, be encouraging, not critical
- Connect dots she might not see
- Suggest ONE tiny next step, never a big change
- If she has been consistent, celebrate her. If not, remind her that rest is also alignment
- Respond in the same language as the check-in snippets provided (English or Swahili)

EXAMPLES OF GOOD INSIGHTS:
- "You feel lighter on days you set an intention before noon — even a small one plants a seed."
- "Your body asks for rest 2 days after intense social connection. Listening earlier might soften the crash."
- "Three times this week you chose 'Clarity'. Your spirit is seeking direction. Trust that the path is unfolding."

EXAMPLES OF BAD INSIGHTS (NEVER DO):
- "You have low productivity."
- "You should exercise more."
- "Your mood data indicates depression."`
}

// Convertit "YYYY-MM-DD" en index de jour (jours depuis l'epoch) pour comparer deux
// dates calendaires sans se soucier du fuseau horaire ou des changements d'heure DST
function dayIndex(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

// Meilleur streak : reconstruit une timeline calendaire continue en comparant les dates
// consécutives triées — un jour sans ligne (trou dans le calendrier) casse le streak
function calculateBestStreakFromDates(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()
  let best = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    current = dayIndex(sorted[i]) - dayIndex(sorted[i - 1]) === 1 ? current + 1 : 1
    best = Math.max(best, current)
  }
  return best
}

function buildPatternData(moods: any[], anchors: any[], checkIns?: any[]) {
  const moodDist: Record<string, number> = {}
  moods.forEach((m: any) => {
    moodDist[m.mood] = (moodDist[m.mood] || 0) + 1
  })

  const futureRate = anchors.length ? anchors.filter((a: any) => a.future_completed).length / anchors.length : 0
  const mindbodyRate = anchors.length ? anchors.filter((a: any) => a.mindbody_completed).length / anchors.length : 0
  const lifeRate = anchors.length ? anchors.filter((a: any) => a.life_completed).length / anchors.length : 0

  const intentions = anchors.map((a: any) => a.daily_intention).filter(Boolean)
  const intentionFreq: Record<string, number> = {}
  intentions.forEach((i: string) => {
    intentionFreq[i] = (intentionFreq[i] || 0) + 1
  })
  const topIntentions = Object.entries(intentionFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)

  // Streaks calendaires (un jour sans ligne = cassure) — même logique que src/lib/streaks.ts
  // et buildPatternDataDev dans src/lib/ai-service.ts, pour ne jamais annoncer un streak inexistant à l'IA.
  // Dupliqué ici (plutôt qu'importé) car cette Edge Function est bundlée séparément du reste de l'app.
  const bestMoodStreak = calculateBestStreakFromDates(
    moods.filter((m: any) => m.mood === "great" || m.mood === "okay").map((m: any) => m.date)
  )
  const bestAnchorStreak = calculateBestStreakFromDates(
    anchors.filter((a: any) => a.future_completed && a.mindbody_completed && a.life_completed).map((a: any) => a.date)
  )

  const snippets = checkIns
    ?.filter((c: any) => c.what_matters || c.what_felt_real)
    .slice(-5)
    .map((c: any) => [c.what_matters, c.what_felt_real].filter(Boolean).join(". "))
    .filter(Boolean)

  return {
    period: `${moods.length} days`,
    totalDays: moods.length,
    moodDistribution: moodDist,
    anchorCompletionRate: {
      future: Math.round(futureRate * 100),
      mindbody: Math.round(mindbodyRate * 100),
      life: Math.round(lifeRate * 100),
      overall: Math.round(((futureRate + mindbodyRate + lifeRate) / 3) * 100),
    },
    topIntentions,
    frequentMoveCategories: [],
    checkInSnippets: snippets && snippets.length > 0 ? snippets : undefined,
    streaks: { bestMoodStreak, bestAnchorStreak },
  }
}