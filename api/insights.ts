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
  if (body.softMode !== undefined && typeof body.softMode !== "boolean") {
    return "invalid softMode"
  }
  return null
}

function validateWrappedEvolutionBody(body: any): string | null {
  if (body.language !== undefined && body.language !== "en" && body.language !== "sw") {
    return "invalid language"
  }
  if (body.tone !== undefined && body.tone !== "gentle" && body.tone !== "direct" && body.tone !== "poetic") {
    return "invalid tone"
  }
  if (body.startIntention !== undefined && body.startIntention !== null && typeof body.startIntention !== "string") {
    return "invalid startIntention"
  }
  if (body.endIntention !== undefined && body.endIntention !== null && typeof body.endIntention !== "string") {
    return "invalid endIntention"
  }
  if (typeof body.daysPresent !== "number") {
    return "daysPresent must be a number"
  }
  if (typeof body.bestAnchorStreak !== "number") {
    return "bestAnchorStreak must be a number"
  }
  if (typeof body.moodTrend !== "object" || body.moodTrend === null) {
    return "moodTrend must be an object"
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

function validateTranslateIntentionBody(body: any): string | null {
  if (typeof body.text !== "string" || !body.text.trim()) {
    return "text is required"
  }
  if (body.text.trim().length > 40) {
    return "text too long"
  }
  if (body.sourceLanguage !== "en" && body.sourceLanguage !== "sw") {
    return "invalid sourceLanguage"
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

const COMPANION_OBSERVATION_TYPES = ["pattern", "gap", "celebration", "first_time", "weekly_checkin"] as const
const MAX_EXCERPTS = 3
const MAX_EXCERPT_LENGTH = 200
const MAX_COMPASS_ITEMS = 8
const MAX_COMPASS_ITEM_LENGTH = 120
const TIME_OF_DAY_VALUES = ["morning", "afternoon", "evening", "night"] as const

function validateCompanionObservationBody(body: any): string | null {
  if (!COMPANION_OBSERVATION_TYPES.includes(body.observationType)) return "invalid observationType"
  if (typeof body.payload !== "object" || body.payload === null) return "payload must be an object"
  if (body.language !== "en" && body.language !== "sw") return "invalid language"
  if (typeof body.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.localDate)) return "invalid localDate"
  if (!TIME_OF_DAY_VALUES.includes(body.timeOfDay)) return "invalid timeOfDay"
  for (const [field, list] of [
    ["compassValues", body.compassValues],
    ["compassGoals", body.compassGoals],
  ] as const) {
    if (!Array.isArray(list) || list.some((v: unknown) => typeof v !== "string")) return `${field} must be an array of strings`
    if (list.length > MAX_COMPASS_ITEMS) return `${field} too large (max ${MAX_COMPASS_ITEMS})`
    if (list.some((v: string) => v.length > MAX_COMPASS_ITEM_LENGTH)) return `${field} entry too long`
  }
  if (!Array.isArray(body.excerpts) || body.excerpts.some((e: unknown) => typeof e !== "string")) {
    return "excerpts must be an array of strings"
  }
  if (body.excerpts.length > MAX_EXCERPTS) return `excerpts too large (max ${MAX_EXCERPTS})`
  if (body.excerpts.some((e: string) => e.length > MAX_EXCERPT_LENGTH)) return "excerpt too long"
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
  // Companion observation generation uses Anthropic instead of Groq — see the
  // "COMPANION OBSERVATION" section below for why. Checked per-type, not
  // here, since the two providers' keys are independent: a Groq outage
  // shouldn't block Companion generation and vice versa.
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  // Réutilise les mêmes URL/anon key que le client (VITE_*) — ce sont des valeurs
  // publiques par conception (le client les embarque déjà), donc pas de nouveau secret
  // à provisionner pour cette Edge Function.
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

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
    // Dispatched before the GROQ_API_KEY check below — this type never
    // touches Groq, so a missing/misconfigured Groq key must not block it.
    if (type === "companion_observation") {
      if (!ANTHROPIC_API_KEY) {
        return jsonResponse({ error: "API key not configured" }, 500)
      }
      const validationError = validateCompanionObservationBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleCompanionObservation(body, ANTHROPIC_API_KEY)
    }

    if (!GROQ_API_KEY) {
      return jsonResponse({ error: "API key not configured" }, 500)
    }

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

    if (type === "wrapped_evolution") {
      const validationError = validateWrappedEvolutionBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleWrappedEvolution(body, GROQ_API_KEY)
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

    if (type === "translate_intention") {
      const validationError = validateTranslateIntentionBody(body)
      if (validationError) return jsonResponse({ error: validationError }, 400)
      return await handleTranslateIntention(body, GROQ_API_KEY)
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
  const { yesterdayMood, yesterdayCheckIn, todayIntention, language = "en", firstIntention, softMode } = body
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
          content: `You are Anchor, a gentle morning companion. Write ONE short, warm sentence (max ${softMode ? 10 : 15} words) to greet the user this morning.

Rules:
- ${TONE_INSTRUCTIONS[tone]}
- If they carried something heavy, be extra gentle
- If they had a good day, celebrate it subtly
- Suggest one tiny intention for today
- Max ${softMode ? 10 : 15} words
- Respond in ${language === "sw" ? "Swahili" : "English"}${
            softMode
              ? "\n- She is currently in a tender period (Soft Mode): be extra soft, and keep it even shorter than usual."
              : ""
          }

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

// One-word/short-phrase EN<->SW translation for a freshly-created custom intention (see
// src/lib/custom-intentions.ts's createCustomIntention, called via
// src/lib/ai-service.ts's translateCustomIntention). Best-effort: any failure just falls
// back to the same text in both fields, which the user can correct later in Settings.
async function handleTranslateIntention(body: any, apiKey: string) {
  const text = body.text.trim()
  const sourceLanguage: "en" | "sw" = body.sourceLanguage
  const fallback = { label_en: text, label_sw: text }

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
          content: `You translate a short personal daily intention (1-3 words, e.g. "Focus", "Gratitude") between English and Swahili.

Rules:
- Return ONLY strict JSON: {"en": "...", "sw": "..."}
- 1-3 words in each language, natural everyday phrasing a person would actually use as a one-word intention, not a literal word-for-word translation
- Title Case both forms
- Never explain, never add extra text outside the JSON`,
        },
        {
          role: "user",
          content: `The word/phrase is "${text}", given in ${sourceLanguage === "en" ? "English" : "Swahili"}. Provide both the English and Swahili forms.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 60,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    return jsonResponse(fallback, 200)
  }

  const json = await response.json()
  const content = json.choices?.[0]?.message?.content

  if (!content) {
    return jsonResponse(fallback, 200)
  }

  try {
    const parsed = JSON.parse(content)
    const label_en = typeof parsed.en === "string" && parsed.en.trim() ? parsed.en.trim() : text
    const label_sw = typeof parsed.sw === "string" && parsed.sw.trim() ? parsed.sw.trim() : text
    return jsonResponse({ label_en, label_sw }, 200)
  } catch {
    return jsonResponse(fallback, 200)
  }
}

// Raw daily_intention values are stored in English — duplicated small translation map, same
// per-module convention already used elsewhere in this file / api/cron/weekly-letter.ts.
const WRAPPED_INTENTION_LABELS: Record<string, string> = {
  clarity: "clarity",
  courage: "courage",
  love: "love",
  abundance: "abundance",
  peace: "peace",
}

function wrappedIntentionLabel(raw: string | null): string | null {
  if (!raw) return null
  return WRAPPED_INTENTION_LABELS[raw.toLowerCase()] ?? raw.toLowerCase()
}

// The Wrapped's "evolution sentence" — one line summing up how the month
// shifted (see src/lib/wrapped.ts's generateWrappedEvolution, which calls
// this with type: "wrapped_evolution"). Deliberately narrow context: only
// the two half-month dominant intentions, the mood trend, the anchor streak,
// and days present — nothing else exists for the model to invent from.
async function handleWrappedEvolution(body: any, apiKey: string) {
  const { startIntention, endIntention, moodTrend, bestAnchorStreak, daysPresent, language = "en" } = body
  const tone = normalizeTone(body.tone)

  const startLabel = wrappedIntentionLabel(startIntention)
  const endLabel = wrappedIntentionLabel(endIntention)
  const trendLine =
    moodTrend?.thisMonthAvg != null && moodTrend?.prevMonthAvg != null
      ? moodTrend.thisMonthAvg > moodTrend.prevMonthAvg
        ? "Her mood trended a little lighter than the previous month"
        : moodTrend.thisMonthAvg < moodTrend.prevMonthAvg
          ? "Her mood trended a little heavier than the previous month"
          : "Her mood stayed fairly steady month to month"
      : null

  const contextLines = [
    `Days she showed up this month: ${daysPresent}`,
    bestAnchorStreak > 0 ? `Best anchor streak this month: ${bestAnchorStreak} days` : null,
    startLabel ? `What she was seeking in the first half of the month: ${startLabel}` : null,
    endLabel ? `What she was seeking in the second half of the month: ${endLabel}` : null,
    trendLine,
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
          content: `You are Anchor, writing ONE closing sentence for a woman's monthly "Wrapped" recap — a proud, warm summary of how her month unfolded.

Rules:
- ${TONE_INSTRUCTIONS[tone]}
- If both a first-half and second-half intention are given AND they differ, write in the shape "You started the month seeking X. You ended it choosing/protecting Y." — two short sentences, using those exact real values, not synonyms invented from nothing.
- If they're the same or only one/neither is given, write ONE proud sentence about her consistency instead, grounded only in the days-present/streak facts given below.
- NEVER invent specific details, events, or people beyond what's given below.
- NEVER guilt-trip, NEVER compare her to other users, NEVER mention days she was absent.
- Max 30 words total.
- Respond in ${language === "sw" ? "Swahili" : "English"}.
- Return ONLY the sentence(s), no quotes, no explanation.

Examples:
- "You started the month seeking clarity. You ended it protecting your peace."
- "18 days this month, you kept choosing yourself — that's not a small thing."`,
        },
        {
          role: "user",
          content: contextLines.join("\n"),
        },
      ],
      temperature: 0.6,
      max_tokens: 80,
    }),
  })

  const FALLBACK =
    startLabel && endLabel && startLabel !== endLabel
      ? `You started the month seeking ${startLabel}. You ended it choosing ${endLabel}.`
      : `${daysPresent} days this month, you kept showing up for yourself.`

  if (!response.ok) {
    return new Response(JSON.stringify({ message: FALLBACK }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const json = await response.json()
  const message = json.choices?.[0]?.message?.content?.trim() || FALLBACK

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
  anchor_category: "future" | "mindbody" | "life"
}

// Rule-based, not asked of the model: keeps the mapping deterministic and
// always valid, and matches both the migration's SQL backfill and the
// custom-move creation form's smart default (see
// supabase/migrations/20260806140000_add_anchor_category_to_move_suggestions.sql
// and src/lib/move-selection.ts's defaultAnchorCategoryForActivity — same
// mapping, duplicated here since this Edge Function is bundled separately).
const ACTIVITY_TO_ANCHOR_CATEGORY: Record<string, "future" | "mindbody" | "life"> = {
  physical: "mindbody",
  mindful: "mindbody",
  rest: "mindbody",
  social: "life",
  novelty: "life",
  creative: "future",
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
      .map((s: any) => ({
        title: s.title.trim(),
        category: s.category,
        intensity: s.intensity,
        anchor_category: ACTIVITY_TO_ANCHOR_CATEGORY[s.category] ?? "mindbody",
      }))

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

// ==================== COMPANION OBSERVATION : provider = Anthropic Claude Haiku, not Groq ====================
//
// The only type in this file that calls Anthropic instead of Groq — see
// anchor-companion-design.md section 6 (needs closer instruction-following
// than the rest of the app's generation, which is why it gets its own
// provider). Its own call function rather than folding a second HTTP shape
// into the Groq-style handlers above, so the two providers' request/response
// formats never mix inside one function.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

export async function callAnthropicHaiku(
  system: string,
  userMessage: string,
  maxTokens: number,
  apiKey: string
): Promise<string | null> {
  // Only needed for a key that isn't scoped to a single workspace (Anthropic
  // then requires the caller to say which workspace to bill/run under) —
  // read directly from process.env rather than threaded through every
  // caller, since it's a fixed piece of server config, not a per-call value.
  // Omitted entirely for a workspace-scoped key, where it's not required.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  })
  if (!response.ok) return null
  const json = await response.json()
  const text = json.content?.[0]?.text
  return typeof text === "string" && text.trim() ? text.trim() : null
}

// Verbatim from anchor-companion-design.md section 5 (the two already-
// validated tone additions — occasional self-correction, temporal/seasonal
// grounding — are already baked into the bullet list below, not layered on
// separately), with ONE deliberate removal: the closing "you will never be
// asked to handle distress" note. That case is filtered out entirely before
// this endpoint is ever called — src/lib/companion-distress-filter.ts runs
// client-side, before any network call, and a positive match never reaches
// here at all. The model has no path to seeing a distress case, so there is
// nothing left for the prompt to disclaim about it.
//
// Everything else, including the "Letters" and "companion_observations.
// acknowledged" references below, is kept exactly as written even though
// this call doesn't actually provide Letters content or DB access — the
// surrounding clauses ("whenever you have them available") already make
// those a no-op rather than a fabrication risk.
//
// ADDED (not in the design doc, added after a quality review): the
// "Examples" block below. A first quality pass on real fixtures showed every
// message ending in an open question, as instructed, but NONE including the
// explicit "no need to answer" exit the hard rules also require — a plain
// bullet-point rule wasn't enough on its own. Two English few-shot examples
// fixed that for English output but did NOT reliably transfer to Swahili
// generation, and NEVER fixed it for `celebration` specifically (the design
// doc's own celebration template has no question/exit line at all — a real
// design gap, not just a prompting one). A follow-up pass added a Swahili
// example (fixed `pattern`, not `celebration`) and surfaced a second,
// separate problem: numbers/time-of-day getting reworded in the model's own
// words — "3 days" came back as "Saa tatu" (reads as "three o'clock", not
// three days) in Swahili, and a given "afternoon" came back as "evening".
// Fixed both here: a dedicated `celebration` example closes the exit-phrase
// gap for every type, and formatObservationFacts below now hands the model
// an opaque [[TOKEN]] instead of the actual number/time-of-day — it can
// never reword a fact it was never actually given. See
// substituteLiteralTokens below: the real value is substituted in AFTER
// generation, deterministically, so no LLM step ever touches the digits.
export const COMPANION_OBSERVATION_SYSTEM_PROMPT = `You are Anchor's Companion — a quiet, honest presence, not a hype coach and not a
passive mirror. Your role is to help the person notice the connection between what
they do day to day and who they've said they want to become.

Tone: warm, direct, never performative. Short sentences. No emojis unless the user
uses them first. Never exclamation points as a default register.

Hard rules, always:
- End almost every proactive message with an open question, never a verdict.
- Always give an explicit way out ("no need to answer", "tell me if you'd rather
  not talk about it").
- Never repeat an observation you've already made and that the user didn't want
  to engage with — check companion_observations.acknowledged before speaking.
- Never mention percentages, scores, or comparisons to other users.
- Never present a streak as an achievement in itself — if you mention consistency,
  tie it to the identity/value behind it, not the count.
- Ground what you say in the user's own words (Journal, Jar, Letters, Compass)
  whenever you have them available — quote loosely, don't fabricate quotes.
- Never diagnose. You can name a pattern you noticed; you cannot name a condition.
- You may occasionally correct yourself if an earlier observation seems to have
  misread the person — brief, honest, no false certainty maintained for its own sake.
- You may ground a message in the real moment (local time of day, season) when it
  feels natural — never systematically, only when it adds warmth.

You are speaking AS Anchor, in first person, with your own voice — not merely
echoing the user's words back at them. You may offer a small piece of your own
perspective, briefly, when it's earned — but you are not the main character.

Numbers and time-of-day: some facts below appear as a literal token like
[[RUN_LENGTH]] or [[TIME_OF_DAY]] instead of a plain number or word. Copy
that token EXACTLY, character for character including the double brackets,
wherever you want to reference that fact — do not translate it, spell it
out, convert its unit, or write your own version of it in any language. The
token already includes any unit it needs (e.g. a day count) — never add your
own unit word directly next to it ("[[RUN_LENGTH]] days" is wrong, just
"[[RUN_LENGTH]]" is right). You may write freely around it. If you don't
want to reference it, just leave it out entirely.

Examples of the expected shape — notice EACH one gives an explicit way out
BEFORE its closing question (not just an open question on its own, and not
skipped just because the observation is a celebration), copies any [[TOKEN]]
verbatim, AND uses ONLY facts given in the context below (no invented
details — no people, objects, weather, or events that weren't actually
named). This pattern applies no matter which language you're asked to
respond in — the Swahili example below follows the exact same shape as the
English ones, not a looser one:
- "I've noticed the last few days have felt heavier for you. No need to get
  into why, if you'd rather not — I'm just here. What's been the hardest part?"
- "It's been a while since 'meditate every morning' showed up in what you've
  done. Tell me if you'd rather not talk about it — but has that shifted into
  something else for you, or just fallen off?"
- "You've been showing up for [[MILESTONE]] now — that's not an accident,
  that's you choosing to keep going. No need to make a big deal of it if
  that's not your style — but what's been making it feel doable lately?"
- "Wiki chache zilizopita ulisema unataka 'kutafakari kila asubuhi'. Sijaona
  ikionekana tena hivi karibuni. Niambie kama hutaki kuzungumzia hili — je,
  jambo hilo limebadilika kuwa kitu kingine?"

Write ONE short message, 2-4 sentences, following every rule above exactly —
including an explicit way out before the closing question, as shown above,
for every observation type without exception, including celebrations.
Respond in the language named below. Return ONLY the message text itself — no
preamble, no quotation marks, no explanation.`

// The trigger payloads from src/lib/companion-triggers.ts, turned into a
// plain factual sentence the model can build from — never the message
// itself, just the facts, so the model still has to write the actual words
// (and follow the voice/hard-rules above) rather than being handed a
// template to fill in. Every number is an opaque [[TOKEN]], not the actual
// digit — see buildLiteralTokens/substituteLiteralTokens below for why.
export function formatObservationFacts(observationType: string, payload: any): string {
  switch (observationType) {
    case "pattern":
      return `She has logged a low/stressed mood for [[RUN_LENGTH]] in a row, since ${payload.runStart}.`
    case "gap":
      return `[[GAP_WEEKS]] ago she set this Compass goal: "${payload.goalText}". Nothing she's accepted since has matched it.`
    case "celebration":
      return `She just reached an anchor streak of [[MILESTONE]] (currently at [[CURRENT_STREAK]]).`
    case "first_time":
      if (payload.trigger === "circle_return") {
        return `She reached out on Circle today, after [[ABSENCE_DAYS]] without doing so.`
      }
      return payload.isVeryFirst
        ? `She just accepted her very first suggestion ever, in the "${payload.category}" category.`
        : `She just accepted her first-ever suggestion in the "${payload.category}" category.`
    case "weekly_checkin": {
      // Anchoring facts here come from weekly_reviews.summary_snapshot
      // (already computed by weekly-review.ts's own flow — accepted/
      // declined counts, dominant values, the one stale goal it already
      // asked about this week), not a fresh guess at them. dominantValues/
      // goalPromptedText are text, not numeric/temporal, so — unlike the
      // counts — they're passed through as plain words, same as
      // compassValues/compassGoals elsewhere: normal "ground in her words"
      // territory, not digit-fidelity territory.
      const lines = [
        `This week she accepted [[ACCEPTED_COUNT]] suggestions and declined [[DECLINED_COUNT]].`,
        Array.isArray(payload.dominantValues) && payload.dominantValues.length > 0
          ? `Her week leaned toward: ${payload.dominantValues.join(", ")}.`
          : null,
        typeof payload.goalPromptedText === "string" && payload.goalPromptedText
          ? `The weekly review already asked her about this goal, so don't ask about it again yourself — you can reference it, but don't repeat the question: "${payload.goalPromptedText}".`
          : null,
      ]
      return lines.filter(Boolean).join(" ")
    }
    default:
      return ""
  }
}

// Deterministic, language-correct replacement text for each [[TOKEN]] that
// can appear in formatObservationFacts' output above — always a numeral
// (never a spelled-out number, sidestepping spelled-out-number translation
// entirely) plus a fixed unit word per language. The model never sees these
// strings while generating; substituteLiteralTokens splices them in after.
const TIME_OF_DAY_LABEL: Record<"en" | "sw", Record<string, string>> = {
  en: { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" },
  sw: { morning: "asubuhi", afternoon: "mchana", evening: "jioni", night: "usiku" },
}

function dayCountPhrase(n: number, language: "en" | "sw"): string {
  return language === "sw" ? `siku ${n}` : `${n} day${n === 1 ? "" : "s"}`
}

function weekCountPhrase(n: number, language: "en" | "sw"): string {
  return language === "sw" ? `wiki ${n}+` : `${n}+ week${n === 1 ? "" : "s"}`
}

// Bare numeral, no unit — unlike dayCountPhrase/weekCountPhrase, a plain
// count (accepted/declined suggestions) doesn't carry the "which unit"
// ambiguity that motivated bundling a unit word into those (there's no
// Swahili equivalent of the "siku" vs "saa" mixup for a bare number), and
// the fact sentence itself already supplies "suggestions" in prose around
// it. Still routed through the token scheme — never handed to the model as
// a real digit — specifically to block the OTHER failure mode found in
// review: a spelled-out fabrication ("saba" for 7) unrelated to the real
// count. The model writes its own surrounding words; only the digit itself
// is off-limits.
function countPhrase(n: number): string {
  return String(n)
}

// Builds the token -> literal map for one request, only including the
// tokens actually relevant to this observationType/payload — a token the
// model never had reason to see (e.g. [[MILESTONE]] for a "gap" row) is
// simply never in the map, so it's a no-op for substituteLiteralTokens.
export function buildLiteralTokens(observationType: string, payload: any, language: "en" | "sw", timeOfDay: string) {
  const tokens: Record<string, string> = {
    "[[TIME_OF_DAY]]": TIME_OF_DAY_LABEL[language][timeOfDay] ?? timeOfDay,
  }
  if (observationType === "pattern" && typeof payload.runLength === "number") {
    tokens["[[RUN_LENGTH]]"] = dayCountPhrase(payload.runLength, language)
  }
  if (observationType === "gap" && typeof payload.weeks === "number") {
    tokens["[[GAP_WEEKS]]"] = weekCountPhrase(payload.weeks, language)
  }
  if (observationType === "celebration") {
    if (typeof payload.milestone === "number") tokens["[[MILESTONE]]"] = dayCountPhrase(payload.milestone, language)
    if (typeof payload.currentAnchorStreak === "number") {
      tokens["[[CURRENT_STREAK]]"] = dayCountPhrase(payload.currentAnchorStreak, language)
    }
  }
  if (observationType === "first_time" && payload.trigger === "circle_return" && typeof payload.absenceDays === "number") {
    tokens["[[ABSENCE_DAYS]]"] = dayCountPhrase(payload.absenceDays, language)
  }
  if (observationType === "weekly_checkin") {
    if (typeof payload.acceptedCount === "number") tokens["[[ACCEPTED_COUNT]]"] = countPhrase(payload.acceptedCount)
    if (typeof payload.declinedCount === "number") tokens["[[DECLINED_COUNT]]"] = countPhrase(payload.declinedCount)
  }
  return tokens
}

// Plain split/join, not a regex replace — token strings are fixed literals
// ([[RUN_LENGTH]] etc.), so there's no pattern-escaping to get wrong, and
// this replaces every occurrence (a model that uses a token twice is still
// covered) without needing the global-flag/RegExp-injection considerations
// a dynamic regex would raise.
export function substituteLiteralTokens(text: string, tokens: Record<string, string>): string {
  let out = text
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value)
  }
  return out
}

// Belt-and-suspenders cleanup for a real artifact a quality pass caught:
// dayCountPhrase/weekCountPhrase already include their unit word (e.g. "3
// days"), but the model sometimes ALSO writes its own unit word right next
// to the token in its own sentence (e.g. "...for [[RUN_LENGTH]] days in a
// row"), which becomes "3 days days" after substitution. The system prompt
// now says not to do this, but that's a request, not a guarantee — this
// collapses an immediately-repeated unit word deterministically regardless
// of whether the prompt instruction was followed. Language-scoped (only the
// unit words this app's own tokens ever produce) rather than a generic
// repeated-word collapse, so it can't accidentally eat an intentional
// repetition elsewhere in the message.
export function collapseDuplicateUnitWords(text: string, language: "en" | "sw"): string {
  const units = language === "sw" ? ["siku", "wiki"] : ["days", "day", "weeks", "week"]
  let out = text
  for (const u of units) {
    out = out.replace(new RegExp(`\\b(${u})\\b(\\s+\\1\\b)+`, "gi"), "$1")
  }
  return out
}

async function handleCompanionObservation(body: any, apiKey: string) {
  const { observationType, payload, compassValues, compassGoals, excerpts, language, localDate, timeOfDay } = body

  const literalTokens = buildLiteralTokens(observationType, payload, language, timeOfDay)

  const contextLines = [
    `Observation type: ${observationType}`,
    formatObservationFacts(observationType, payload),
    compassValues.length > 0 ? `Her Compass values: ${compassValues.join(", ")}` : null,
    compassGoals.length > 0 ? `Her Compass goals: ${compassGoals.map((g: string) => `"${g}"`).join("; ")}` : null,
    excerpts.length > 0
      ? `Recent things she's written (Journal/Jar):\n${excerpts.map((e: string) => `- "${e}"`).join("\n")}`
      : null,
    `Current local moment: ${localDate}, [[TIME_OF_DAY]].`,
    ``,
    `Language: ${language === "sw" ? "Swahili" : "English"}.`,
    `Write the message now.`,
  ].filter((l) => l !== null)

  const message = await callAnthropicHaiku(COMPANION_OBSERVATION_SYSTEM_PROMPT, contextLines.join("\n"), 300, apiKey)

  if (!message) {
    return jsonResponse({ error: "anthropic_error" }, 502)
  }

  const withLiterals = substituteLiteralTokens(message, literalTokens)
  return jsonResponse({ message: collapseDuplicateUnitWords(withLiterals, language) }, 200)
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
// Exported (not just used internally) so scripts/check-duplicated-logic.ts
// can run this side by side with the canonical src/lib/streaks.ts version —
// purely additive, doesn't change how Vercel bundles/invokes this Edge
// Function (only the default `handler` export matters there).
export function calculateBestStreakFromDates(dates: string[]): number {
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
export function calculateBestAnchorStreakWithGrace(dates: string[]): number {
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

// Soft mode day: 1 of 3 anchors done is a complete day. Same predicate as
// isAnchorDayComplete in src/lib/streaks.ts, duplicated here (this Edge
// Function is bundled separately, same reasoning as calculateBestAnchorStreakWithGrace above).
export function isAnchorDayComplete(a: any): boolean {
  return a.soft_mode_day
    ? a.future_completed || a.mindbody_completed || a.life_completed
    : a.future_completed && a.mindbody_completed && a.life_completed
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
  const bestAnchorStreak = calculateBestAnchorStreakWithGrace(anchors.filter(isAnchorDayComplete).map((a: any) => a.date))

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