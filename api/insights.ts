export const config = {
  runtime: "edge",
}

type Tone = "gentle" | "direct" | "poetic"

// Style only — never the safety rules (no diagnosis, no guilt-tripping) baked into each
// prompt's "Rules" list, which stay identical across all three tones. "gentle" is worded to
// match the app's original, un-tone-able style verbatim, so existing users (default tone)
// see zero behavior change.
const TONE_INSTRUCTIONS: Record<Tone, string> = {
  gentle: "Warm, spiritual but not religious, like a wise friend",
  direct: "Direct and motivating — short, energizing sentences and active verbs, like a coach who believes in her. Still warm, never harsh or pushy",
  poetic: "Poetic and lyrical — natural imagery (light, seasons, water), unhurried rhythm, more metaphor. Still clear enough to be understood in one read",
}

function normalizeTone(tone: unknown): Tone {
  return tone === "direct" || tone === "poetic" ? tone : "gentle"
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
  if (body.tone !== undefined && body.tone !== "gentle" && body.tone !== "direct" && body.tone !== "poetic") {
    return "invalid tone"
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
  if (body.firstIntention !== undefined && body.firstIntention !== null && typeof body.firstIntention !== "string") {
    return "invalid firstIntention"
  }
  return null
}

function validateReassuranceBody(body: any): string | null {
  if (body.language !== undefined && body.language !== "en" && body.language !== "sw") {
    return "invalid language"
  }
  if (body.tone !== undefined && body.tone !== "gentle" && body.tone !== "direct" && body.tone !== "poetic") {
    return "invalid tone"
  }
  return null
}

const MOVE_CATEGORIES = ["physical", "social", "mindful", "novelty", "creative", "rest"] as const
const MOVE_INTENSITIES = ["gentle", "standard", "ambitious"] as const

function validateMoveSuggestionsBody(body: any): string | null {
  if (body.language !== undefined && body.language !== "en" && body.language !== "sw") {
    return "invalid language"
  }
  if (body.tone !== undefined && body.tone !== "gentle" && body.tone !== "direct" && body.tone !== "poetic") {
    return "invalid tone"
  }
  if (!Array.isArray(body.moodTrend)) return "moodTrend must be an array"
  if (body.moodTrend.length > 14) return "moodTrend array too large (max 14)"
  for (const m of body.moodTrend) {
    if (typeof m !== "object" || m === null || typeof m.date !== "string" || typeof m.mood !== "string") {
      return "invalid moodTrend entry"
    }
  }
  if (typeof body.anchorCompletion !== "object" || body.anchorCompletion === null) {
    return "anchorCompletion must be an object"
  }
  for (const key of ["future", "mindbody", "life"]) {
    if (typeof body.anchorCompletion[key] !== "number") return `anchorCompletion.${key} must be a number`
  }
  if (!Array.isArray(body.topIntentions) || body.topIntentions.some((i: unknown) => typeof i !== "string")) {
    return "topIntentions must be an array of strings"
  }
  if (!Array.isArray(body.triedCategories) || body.triedCategories.some((c: unknown) => typeof c !== "string")) {
    return "triedCategories must be an array of strings"
  }
  if (!Array.isArray(body.untriedCategories) || body.untriedCategories.some((c: unknown) => typeof c !== "string")) {
    return "untriedCategories must be an array of strings"
  }
  return null
}

const MAX_FOLLOWUP_ENTRIES = 7
const FOLLOWUP_ENTRY_STRING_FIELDS = [
  "whatMatters",
  "whatAvoiding",
  "whatFeltReal",
  "eveningMood",
  "eveningMoodNote",
  "voiceTranscript",
  "journalSentence",
  "anchorText",
  "intention",
] as const

function validateFollowUpBody(body: any): string | null {
  if (body.language !== undefined && body.language !== "en" && body.language !== "sw") {
    return "invalid language"
  }
  if (body.tone !== undefined && body.tone !== "gentle" && body.tone !== "direct" && body.tone !== "poetic") {
    return "invalid tone"
  }
  if (!Array.isArray(body.entries)) return "entries must be an array"
  if (body.entries.length > MAX_FOLLOWUP_ENTRIES) return `entries array too large (max ${MAX_FOLLOWUP_ENTRIES})`
  for (const entry of body.entries) {
    if (typeof entry !== "object" || entry === null || typeof entry.date !== "string") {
      return "invalid entry"
    }
    for (const field of FOLLOWUP_ENTRY_STRING_FIELDS) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        return `invalid entry.${field}`
      }
    }
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

    if (type === "reassurance") {
      const validationError = validateReassuranceBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleReassurance(body, GROQ_API_KEY)
    }

    if (type === "followup_question") {
      const validationError = validateFollowUpBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleFollowUp(body, GROQ_API_KEY)
    }

    if (type === "move_suggestions") {
      const validationError = validateMoveSuggestionsBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleMoveSuggestions(body, GROQ_API_KEY)
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
  const { yesterdayMood, yesterdayCheckIn, todayIntention, language = "en", firstIntention } = body
  const tone = normalizeTone(body.tone)

  const userLines = [
    `Yesterday's context:`,
    `- Mood: ${yesterdayMood || "unknown"}`,
    `- What felt real: ${yesterdayCheckIn?.what_felt_real || "none"}`,
    `- What matters: ${yesterdayCheckIn?.what_matters || "none"}`,
    `- Today's intention: ${todayIntention || "none"}`,
    // Only ever present on the very first message after onboarding (see
    // src/components/onboarding/onboarding-modal.tsx's optional "what brings you here"
    // screen) — the client consumes its local cache after one use, so this line won't
    // recur on later mornings.
    firstIntention ? `- What brought her to Anchor in the first place: ${firstIntention}` : null,
    ``,
    `Generate one warm morning sentence.`,
  ].filter((line) => line !== null)

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
- ${TONE_INSTRUCTIONS[tone]}
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
          content: userLines.join("\n"),
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

// SOS doux, no-circle branch: she tapped the gentle SOS button but has no one
// to notify yet — this is a standalone reassurance, not a reaction to any
// mood/check-in data, so the prompt carries no personal context at all.
async function handleReassurance(body: any, apiKey: string) {
  const { language = "en" } = body
  const tone = normalizeTone(body.tone)

  const STATIC_FALLBACK = "You are not alone, even in this quiet moment."

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
          content: `You are Anchor, a gentle companion. Someone just reached for support but has no one in her circle to notify yet. Write ONE short, warm reassurance sentence (max 20 words).

Rules:
- ${TONE_INSTRUCTIONS[tone]}
- Never diagnose, never suggest a crisis hotline or clinical language — this is warm companionship, not a medical response
- Acknowledge the hard moment without asking her to explain it
- Max 20 words
- Respond in ${language === "sw" ? "Swahili" : "English"}

Examples:
- "You don't have to carry this alone — even in this quiet moment, you are not too much."
- "This moment is hard, and that's real. You've gotten through hard moments before."`,
        },
        {
          role: "user",
          content: "Write the reassurance sentence now.",
        },
      ],
      temperature: 0.5,
      max_tokens: 100,
    }),
  })

  if (!response.ok) {
    return new Response(JSON.stringify({ message: STATIC_FALLBACK }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const json = await response.json()
  const message = json.choices?.[0]?.message?.content?.trim() || STATIC_FALLBACK

  return new Response(JSON.stringify({ message }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

interface FollowUpEntry {
  date: string
  whatMatters?: string
  whatAvoiding?: string
  whatFeltReal?: string
  eveningMood?: string
  eveningMoodNote?: string
  voiceTranscript?: string
  journalSentence?: string
  anchorText?: string
  intention?: string
}

function formatFollowUpEntry(entry: FollowUpEntry): string {
  const parts = [
    entry.whatMatters ? `what mattered to her: "${entry.whatMatters}"` : null,
    entry.whatAvoiding ? `what she was avoiding: "${entry.whatAvoiding}"` : null,
    entry.whatFeltReal ? `what felt real: "${entry.whatFeltReal}"` : null,
    entry.eveningMood ? `evening mood: ${entry.eveningMood}` : null,
    entry.eveningMoodNote ? `note on that mood: "${entry.eveningMoodNote}"` : null,
    entry.voiceTranscript ? `voice reflection: "${entry.voiceTranscript}"` : null,
    entry.journalSentence ? `journal: "${entry.journalSentence}"` : null,
    entry.anchorText ? `tasks she set: "${entry.anchorText}"` : null,
    entry.intention ? `intention: ${entry.intention}` : null,
  ].filter(Boolean)
  return `${entry.date} — ${parts.join("; ")}`
}

// SOS-adjacent in spirit but for the evening check-in: turns one of the two
// pool questions into a follow-up that shows the app actually remembers what
// she said this week. Only ever called with entries the client already
// restricted to the last 7 days (see generateFollowUpQuestion in
// src/lib/ai-service.ts) — this function has no way to know or enforce that
// window itself, the client-side restriction is what "never reference
// anything older than 7 days" relies on.
async function handleFollowUp(body: any, apiKey: string) {
  const { language = "en", entries } = body
  const tone = normalizeTone(body.tone)

  if (!Array.isArray(entries) || entries.length === 0) {
    return new Response(JSON.stringify({ message: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const entryLines = (entries as FollowUpEntry[]).map(formatFollowUpEntry)

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
          content: `You are Anchor, a caring friend who remembers what she told you this week. Below are her real entries from the last 7 days.

Generate ONE short follow-up question (max 20 words, one sentence, ending in "?") that gently references a SPECIFIC concrete detail from the entries below — a task, worry, feeling, or theme she actually mentioned.

Rules:
- ${TONE_INSTRUCTIONS[tone]}
- Only reference something explicitly present in the entries below — never invent people, events, or details
- Warm and curious, like a friend who remembers, never clinical or like a check-up
- If nothing specific enough exists to reference, respond with exactly: NONE
- Max 20 words
- Respond in ${language === "sw" ? "Swahili" : "English"}

Examples:
- "You mentioned avoiding a tough conversation — how did it go?"
- "How has work been sitting with you these days?"`,
        },
        {
          role: "user",
          content: entryLines.join("\n"),
        },
      ],
      temperature: 0.5,
      max_tokens: 60,
    }),
  })

  if (!response.ok) {
    return new Response(JSON.stringify({ message: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const json = await response.json()
  const text = json.choices?.[0]?.message?.content?.trim() || ""
  const message = !text || text.toUpperCase() === "NONE" ? null : text

  return new Response(JSON.stringify({ message }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

interface MoveSuggestionOut {
  title: string
  category: string
  intensity: string
}

// Weekly personalized batch for the Move page (src/pages/move.tsx). Payload
// is deliberately structured-data-only (mood enum trend, completion rates,
// intention/category labels) — never raw journal/check-in/task text — so
// this feature only needs profile.ai_enabled, not the stricter
// ai_checkins_enabled gate the follow-up question above requires.
async function handleMoveSuggestions(body: any, apiKey: string) {
  const { language = "en", moodTrend, anchorCompletion, topIntentions, triedCategories, untriedCategories } = body
  const tone = normalizeTone(body.tone)

  const moodSummary = (moodTrend as { date: string; mood: string }[]).map((m: any) => m.mood).join(", ") || "no recent moods logged"
  const contextLines = [
    `Mood trend, oldest to newest (last 14 days): ${moodSummary}`,
    `Anchor completion rate (last 14 days): future ${anchorCompletion.future}%, mindbody ${anchorCompletion.mindbody}%, life ${anchorCompletion.life}%`,
    topIntentions.length > 0 ? `Intentions she's returned to often: ${topIntentions.join(", ")}` : null,
    triedCategories.length > 0 ? `Categories she's already gotten suggestions in: ${triedCategories.join(", ")}` : null,
    untriedCategories.length > 0 ? `Categories she's never gotten a suggestion in yet: ${untriedCategories.join(", ")}` : null,
  ].filter(Boolean)

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
          content: `You are Anchor, suggesting small real actions to a woman based on her recent patterns.

Generate EXACTLY 5 suggestions as JSON: {"suggestions":[{"title":"...","category":"...","intensity":"..."}, ...]}

Rules:
- ${TONE_INSTRUCTIONS[tone]}
- Each title is ONE small, real, concrete action doable in 5-30 minutes, phrased as a gentle invitation, NEVER as an instruction or obligation — e.g. "Take a gentle walk", NEVER "You should exercise" or "You need to move more"
- "category" must be exactly one of: ${MOVE_CATEGORIES.join(", ")}
- "intensity" must be exactly one of: ${MOVE_INTENSITIES.join(", ")} — mix these across the 5, don't make them all the same
- Vary the categories across the 5 suggestions; if she has untried categories, include at least one of them
- NEVER diagnose, NEVER reference specific tasks or events beyond what's given below
- Respond in ${language === "sw" ? "Swahili" : "English"}
- Return ONLY the JSON object, nothing else`,
        },
        {
          role: "user",
          content: contextLines.join("\n"),
        },
      ],
      temperature: 0.7,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    return new Response(JSON.stringify({ suggestions: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    const json = await response.json()
    const content = json.choices?.[0]?.message?.content
    const parsed = JSON.parse(content)
    const raw = Array.isArray(parsed) ? parsed : parsed.suggestions || []
    const suggestions: MoveSuggestionOut[] = raw
      .filter(
        (s: any) =>
          s &&
          typeof s.title === "string" &&
          s.title.trim() &&
          MOVE_CATEGORIES.includes(s.category) &&
          MOVE_INTENSITIES.includes(s.intensity)
      )
      .slice(0, 5)
      .map((s: any) => ({ title: s.title.trim(), category: s.category, intensity: s.intensity }))

    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ suggestions: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
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

// Grace day (ancres uniquement, règle produit) : un seul jour manqué toléré par streak.
// Consommer la grâce au premier trou rencontré n'est pas toujours optimal (un trou plus
// tardif peut ouvrir une chaîne plus longue) — on garde donc deux états par jour : la
// meilleure série sans grâce utilisée (noGrace) et la meilleure série avec grâce déjà
// consommée (withGrace), et on prend le meilleur des deux. Même logique que
// calculateBestAnchorStreakWithGrace dans src/lib/streaks.ts, dupliquée ici (comme
// calculateBestStreakFromDates ci-dessus) car cette Edge Function est bundlée séparément
// du reste de l'app — pour ne pas annoncer à l'IA un anchor streak plus court que celui
// affiché sur Home.
function calculateBestAnchorStreakWithGrace(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()
  let noGrace = 1
  let withGrace = 1
  let best = 1
  for (let i = 1; i < sorted.length; i++) {
    const gap = dayIndex(sorted[i]) - dayIndex(sorted[i - 1])
    let nextNoGrace: number
    let nextWithGrace: number
    if (gap === 1) {
      nextNoGrace = noGrace + 1
      nextWithGrace = withGrace + 1
    } else if (gap === 2) {
      nextNoGrace = 1
      nextWithGrace = noGrace + 1
    } else {
      nextNoGrace = 1
      nextWithGrace = 1
    }
    noGrace = nextNoGrace
    withGrace = nextWithGrace
    best = Math.max(best, noGrace, withGrace)
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
  const bestAnchorStreak = calculateBestAnchorStreakWithGrace(
    anchors.filter((a: any) => a.future_completed && a.mindbody_completed && a.life_completed).map((a: any) => a.date)
  )

  const snippets = checkIns
    ?.filter((c: any) => c.what_matters || c.what_felt_real || c.voice_transcript)
    .slice(-5)
    .map((c: any) => [c.what_matters, c.what_felt_real, c.voice_transcript].filter(Boolean).join(". "))
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