import { isOnline } from "@/lib/offline-sync"
import { calculateBestStreakFromDates, calculateBestAnchorStreakWithGrace } from "@/lib/streaks"
import { supabase } from "@/lib/supabase"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import i18n from "@/lib/i18n"
import { getISOWeek } from "date-fns"
import type { MoodLog, DailyAnchor, CheckIn, Tone } from "@/types"

type Language = "en" | "sw"

// Ce module n'est pas un composant React — pas de useTranslation() ici. On lit
// directement l'instance i18next partagée (même singleton que celui initialisé dans
// src/lib/i18n.ts et utilisé par les composants), pour que les insights locaux et le
// message du companion suivent la langue active de l'app.
function currentLanguage(): Language {
  return i18n.language === "sw" ? "sw" : "en"
}

const INTENTION_TRANSLATIONS: Record<string, { en: string; sw: string }> = {
  clarity: { en: "Clarity", sw: "Uwazi" },
  courage: { en: "Courage", sw: "Ujasiri" },
  love: { en: "Love", sw: "Upendo" },
  abundance: { en: "Abundance", sw: "Wingi" },
  peace: { en: "Peace", sw: "Amani" },
}

// La valeur technique stockée en base (daily_intention) reste en anglais — seul
// l'affichage est traduit, ici pour l'interpoler dans une phrase d'insight.
function translateIntention(intention: string, language: Language): string {
  return INTENTION_TRANSLATIONS[intention.toLowerCase()]?.[language] ?? intention
}

// Variantes EN/SW des insights locaux générés en dur (Tier 2) — même principe que
// getLocalCompanionFallback() plus bas dans ce fichier.
const LOCAL_INSIGHT_TEXT = {
  lifeAnchorMood: (language: Language) =>
    language === "sw"
      ? "Unahisi vizuri zaidi siku unapokamilisha nanga yako ya Maisha."
      : "You feel better on days you complete your Life anchor.",
  mindbodyEmotionalAnchor: (language: Language) =>
    language === "sw"
      ? "Nanga yako ya Akili/Mwili inaonekana kuwa nanga yako ya kihisia — inajitokeza siku zako nzuri zaidi."
      : "Your Mind/Body anchor seems to be your emotional anchor — it shows up in your best days.",
  mindbodySkipStreak: (language: Language, days: number) =>
    language === "sw"
      ? `Hisia zako huwa nyepesi baada ya kuruka Akili/Mwili kwa siku ${days}. Unyoosho mdogo unaweza kusaidia.`
      : `Your mood tends to soften after skipping Mind/Body for ${days} days. A small stretch might help.`,
  topIntention: (language: Language, intention: string) =>
    language === "sw"
      ? `Umekuwa ukialika ${translateIntention(intention, "sw")} mara nyingi. Roho yako inaita kwa ajili yake — sikiliza kwa makini zaidi.`
      : `You've been inviting ${intention} often. Your spirit is calling for it — listen closer.`,
  gentleMovement: (language: Language) =>
    language === "sw"
      ? "Mwili wako huenda unahitaji mwendo wa upole. Hata dakika 5 za kutembea zinaweza kubadilisha nishati yako."
      : "Your body might be asking for gentle movement. Even 5 minutes of walking can shift the energy.",
  heavierEnergy: (language: Language) =>
    language === "sw"
      ? "Umekuwa ukibeba nishati nzito hivi karibuni. Kuwa mpole zaidi na wewe mwenyewe — hii nayo itapita."
      : "You've been carrying a heavier energy lately. Be extra gentle with yourself — this too shall pass.",
  consistentShowUp: (language: Language) =>
    language === "sw"
      ? "Umekuwa ukijitokeza kwa ajili yako mwenyewe kwa uthabiti. Aina hiyo ya kujitoa hupanda mizizi mirefu."
      : "You're showing up for yourself consistently. That kind of devotion plants deep roots.",
}

interface AiInsightResult {
  text: string
  category: "mood_action_correlation" | "pattern" | "suggestion"
  source: "local" | "ai"
  generatedAt: string
}

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const GROQ_MODEL = "llama-3.1-8b-instant"

// L'Edge Function /api/insights exige un JWT Supabase valide (rate limiting par user_id)
async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

// ==================== TIER 2 : LOCAL AVANCÉ ====================

export function generateLocalInsights(moods: MoodLog[], anchors: DailyAnchor[]): AiInsightResult[] {
  const insights: AiInsightResult[] = []
  const language = currentLanguage()

  if (moods.length < 3) return insights

  // 1. Corrélation humeur + ancre Life
  const goodDays = moods.filter((m) => m.mood === "great" || m.mood === "okay")
  const goodDates = new Set(goodDays.map((m) => m.date))
  const anchorsOnGoodDays = anchors.filter((a) => goodDates.has(a.date))
  const lifeCompletedOnGoodDays = anchorsOnGoodDays.filter((a) => a.life_completed).length

  if (lifeCompletedOnGoodDays > goodDays.length * 0.5 && goodDays.length >= 2) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.lifeAnchorMood(language),
      category: "mood_action_correlation",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 2. Corrélation humeur + ancre Mind/Body
  const mindbodyCompletedOnGoodDays = anchorsOnGoodDays.filter((a) => a.mindbody_completed).length
  if (mindbodyCompletedOnGoodDays > goodDays.length * 0.6) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.mindbodyEmotionalAnchor(language),
      category: "mood_action_correlation",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 3. Streak Mind/Body manqué
  const sortedAnchors = [...anchors].sort((a, b) => b.date.localeCompare(a.date))
  let mindbodySkipStreak = 0
  for (const a of sortedAnchors) {
    if (!a.mindbody_completed) mindbodySkipStreak++
    else break
  }
  if (mindbodySkipStreak >= 2) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.mindbodySkipStreak(language, mindbodySkipStreak),
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 4. Pattern intention
  const intentions = anchors.map((a) => a.daily_intention).filter(Boolean)
  const intentionFreq: Record<string, number> = {}
  intentions.forEach((i) => {
    intentionFreq[i] = (intentionFreq[i] || 0) + 1
  })
  const topIntention = Object.entries(intentionFreq).sort((a, b) => b[1] - a[1])[0]
  if (topIntention && topIntention[1] >= 3) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.topIntention(language, topIntention[0]),
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 5. Suggestion mouvement
  const hasMovement = anchors.some(
    (a) =>
      a.mindbody_task.toLowerCase().includes("walk") ||
      a.mindbody_task.toLowerCase().includes("stretch") ||
      a.life_task.toLowerCase().includes("outside")
  )
  if (!hasMovement && moods.some((m) => m.mood === "low" || m.mood === "stressed")) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.gentleMovement(language),
      category: "suggestion",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 6. Pattern humeur dégradante
  const recentMoods = [...moods].sort((a, b) => a.date.localeCompare(b.date)).slice(-5)
  const moodValues = recentMoods.map((m) => ({ great: 5, okay: 4, meh: 3, low: 2, stressed: 1 }[m.mood] || 3))
  const declining = moodValues.every((v, i) => i === 0 || v <= moodValues[i - 1] + 0.5)
  if (declining && moodValues.length >= 3 && moodValues[moodValues.length - 1] <= 2) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.heavierEnergy(language),
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 7. Célébration cohérence
  const completionRate =
    anchors.length > 0
      ? anchors.reduce(
          (sum, a) => sum + (a.future_completed ? 1 : 0) + (a.mindbody_completed ? 1 : 0) + (a.life_completed ? 1 : 0),
          0
        ) / (anchors.length * 3)
      : 0
  if (completionRate > 0.7 && anchors.length >= 5) {
    insights.push({
      text: LOCAL_INSIGHT_TEXT.consistentShowUp(language),
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  return insights.slice(0, 3)
}

// ==================== TIER 3 : IA (Edge Function Vercel) ====================

export async function generateAiInsights(
  moods: MoodLog[],
  anchors: DailyAnchor[],
  checkIns?: CheckIn[]
): Promise<AiInsightResult[]> {
  if (!isOnline()) {
    throw new Error("offline")
  }

  // 🚀 PROD : appel Edge Function Vercel (clé cachée côté serveur)
  if (!import.meta.env.DEV) {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ moods, anchors, checkIns }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || `edge_function_error: ${response.status}`)
    }

    const json = await response.json()
    const insights = json.insights || []
    return insights.map((ins: any) => ({
      text: ins.text,
      category: ins.category || "pattern",
      source: "ai" as const,
      generatedAt: new Date().toISOString(),
    }))
  }

  // 💻 DEV FALLBACK : appel direct (si VITE_GROQ_API_KEY existe)
  if (!GROQ_API_KEY) {
    throw new Error("no_api_key")
  }

  const data = buildPatternDataDev(moods, anchors, checkIns)

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: buildSystemPromptDev() },
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
    throw new Error(`groq_error: ${response.status}`)
  }

  const json = await response.json()
  const content = json.choices?.[0]?.message?.content

  if (!content) {
    throw new Error("empty_response")
  }

  try {
    const parsed = JSON.parse(content)
    const insights = Array.isArray(parsed) ? parsed : parsed.insights || []
    return insights.slice(0, 3).map((ins: any) => ({
      text: ins.text,
      category: ins.category || "pattern",
      source: "ai" as const,
      generatedAt: new Date().toISOString(),
    }))
  } catch {
    throw new Error("parse_error")
  }
}

// ==================== DEV HELPERS (fallback direct) ====================

function buildSystemPromptDev(): string {
  return `You are Anchor, a compassionate life-alignment companion...
RULES:
- TONE: Warm, gentle, supportive.
- LENGTH: 1-2 sentences max.
- FORMAT: JSON array [{"text":"...","category":"pattern"|"suggestion"|"mood_action_correlation"}]
- NEVER diagnose. Suggest ONE tiny next step.`
}

function buildPatternDataDev(moods: MoodLog[], anchors: DailyAnchor[], checkIns?: CheckIn[]) {
  const moodDist: Record<string, number> = {}
  moods.forEach((m) => {
    moodDist[m.mood] = (moodDist[m.mood] || 0) + 1
  })

  const futureRate = anchors.length ? anchors.filter((a) => a.future_completed).length / anchors.length : 0
  const mindbodyRate = anchors.length ? anchors.filter((a) => a.mindbody_completed).length / anchors.length : 0
  const lifeRate = anchors.length ? anchors.filter((a) => a.life_completed).length / anchors.length : 0

  const intentions = anchors.map((a) => a.daily_intention).filter(Boolean)
  const intentionFreq: Record<string, number> = {}
  intentions.forEach((i) => {
    intentionFreq[i] = (intentionFreq[i] || 0) + 1
  })
  const topIntentions = Object.entries(intentionFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)

  // Streaks calendaires — même logique que src/lib/streaks.ts et buildPatternData dans
  // api/insights.ts, pour ne jamais annoncer un streak inexistant à l'IA. Mood strict (un
  // jour sans ligne casse) ; anchor avec le grace day produit (un seul jour manqué toléré
  // par streak, voir calculateBestAnchorStreakWithGrace) pour ne pas contredire le chiffre
  // affiché sur Home.
  const bestMoodStreak = calculateBestStreakFromDates(
    moods.filter((m) => m.mood === "great" || m.mood === "okay").map((m) => m.date)
  )
  const bestAnchorStreak = calculateBestAnchorStreakWithGrace(
    anchors.filter((a) => a.future_completed && a.mindbody_completed && a.life_completed).map((a) => a.date)
  )

  const snippets = checkIns
    ?.filter((c) => c.what_matters || c.what_felt_real || c.voice_transcript)
    .slice(-5)
    .map((c) => [c.what_matters, c.what_felt_real, c.voice_transcript].filter(Boolean).join(". "))
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

// ==================== COMPANION : Message du matin ====================

export async function generateCompanionMessage(
  aiEnabled: boolean,
  yesterdayCheckIn: Partial<CheckIn> | null,
  yesterdayMood: MoodLog | null,
  todayIntention: string,
  language: "en" | "sw" = "en",
  tone: Tone = "gentle",
  // Set only once, right after onboarding's optional "what brings you here" screen — see
  // src/components/onboarding/onboarding-modal.tsx and src/pages/home.tsx, which consumes
  // (reads + clears) the local cache so this only ever enriches the very first message.
  firstIntention?: string | null
): Promise<string> {
  if (!isOnline()) {
    return language === "sw"
      ? "Habari za asubuhi — weka nia moja ya upole kwa leo."
      : "Good morning — set one gentle intention for today."
  }

  // Respect du consentement : IA désactivée = message local uniquement, aucun appel réseau
  if (!aiEnabled) {
    return getLocalCompanionFallback(yesterdayMood?.mood, language, tone)
  }

  // 🚀 PROD : appel Edge Function
  if (!import.meta.env.DEV) {
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
        body: JSON.stringify({
          type: "companion",
          yesterdayMood: yesterdayMood?.mood || null,
          yesterdayCheckIn: {
            what_felt_real: yesterdayCheckIn?.what_felt_real || "",
            what_matters: yesterdayCheckIn?.what_matters || "",
          },
          todayIntention,
          language,
          tone,
          firstIntention: firstIntention || null,
        }),
      })

      if (!response.ok) throw new Error("companion_failed")
      const json = await response.json()
      return json.message
    } catch {
      // Fallback local si l'IA est down
      return getLocalCompanionFallback(yesterdayMood?.mood, language, tone)
    }
  }

  // 💻 DEV : fallback local
  return getLocalCompanionFallback(yesterdayMood?.mood, language, tone)
}

// Style only, same 3 tones as the AI path (see TONE_INSTRUCTIONS in api/insights.ts) — kept
// hand-written per language/mood-bucket rather than templated, same reasoning as the rest of
// this file's local fallbacks: a handful of warm, correct lines beats a generic mad-lib.
const LOCAL_COMPANION_FALLBACK: Record<Tone, Record<"en" | "sw", { heavy: string; good: string; neutral: string }>> = {
  gentle: {
    en: {
      heavy: "Yesterday was heavy — today, permission to move slowly.",
      good: "Yesterday you did well — today, keep that gentle pace.",
      neutral: "Good morning — set one gentle intention for today.",
    },
    sw: {
      heavy: "Jana lilikuwa zito — leo, ruhusa ya kusonga polepole.",
      good: "Jana ulifanya vizuri — leo, endelea na mwendo huo wa upole.",
      neutral: "Habari za asubuhi — weka nia moja ya upole kwa leo.",
    },
  },
  direct: {
    en: {
      heavy: "Yesterday was heavy. Today: one small anchor, nothing more.",
      good: "Yesterday you showed up. Today, let's keep that going.",
      neutral: "New day, one anchor. Let's go gently but surely.",
    },
    sw: {
      heavy: "Jana ilikuwa nzito. Leo: nanga moja ndogo, hakuna zaidi.",
      good: "Jana ulijitokeza. Leo, tuendeleze mwendo huo.",
      neutral: "Siku mpya, nanga moja. Twende kwa upole lakini kwa uhakika.",
    },
  },
  poetic: {
    en: {
      heavy: "The night was heavy — let today be a slow unfolding.",
      good: "Yesterday's light is still on you. Let it lead today.",
      neutral: "Dawn again — carry only what still serves you.",
    },
    sw: {
      heavy: "Usiku ulikuwa mzito — leo iwe ufunguzi wa polepole.",
      good: "Mwanga wa jana bado uko juu yako. Uuache uongoze leo.",
      neutral: "Alfajiri tena — beba tu kile kinachokufaa bado.",
    },
  },
}

function getLocalCompanionFallback(mood: string | undefined, language: "en" | "sw", tone: Tone): string {
  const lines = LOCAL_COMPANION_FALLBACK[tone][language]
  if (mood === "low" || mood === "stressed") return lines.heavy
  if (mood === "great" || mood === "okay") return lines.good
  return lines.neutral
}

// ==================== REASSURANCE : SOS doux sans cercle ====================

// Shown immediately when someone taps the gentle SOS button but has no
// active circle to notify — "personne ne doit taper un SOS dans le vide".
// Same dev/prod/offline/consent split as generateCompanionMessage, just
// without yesterday's mood/check-in context (there's nothing to react to
// here — this is a standalone reassurance, not a morning greeting).
export async function generateReassuranceMessage(
  aiEnabled: boolean,
  language: "en" | "sw" = "en",
  tone: Tone = "gentle"
): Promise<string> {
  if (!isOnline()) {
    return getLocalReassuranceFallback(language, tone)
  }

  if (!aiEnabled) {
    return getLocalReassuranceFallback(language, tone)
  }

  if (!import.meta.env.DEV) {
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
        body: JSON.stringify({ type: "reassurance", language, tone }),
      })

      if (!response.ok) throw new Error("reassurance_failed")
      const json = await response.json()
      return json.message
    } catch {
      return getLocalReassuranceFallback(language, tone)
    }
  }

  return getLocalReassuranceFallback(language, tone)
}

const LOCAL_REASSURANCE_FALLBACK: Record<Tone, Record<"en" | "sw", string>> = {
  gentle: {
    en: "You don't have to carry this alone — even in this quiet moment, you are not too much, and this will pass.",
    sw: "Huhitaji kubeba hili peke yako — hata katika wakati huu wa utulivu, wewe si mzigo, na hii itapita.",
  },
  direct: {
    en: "This moment is hard, and that's real. You've gotten through hard moments before — you will get through this one too.",
    sw: "Wakati huu ni mgumu, na hilo ni kweli. Umeshapitia nyakati ngumu hapo awali — utapita na hii pia.",
  },
  poetic: {
    en: "Even the quietest nights end in light. Rest here a moment — you are still held.",
    sw: "Hata usiku wa kimya zaidi huisha kwa mwanga. Pumzika hapa kidogo — bado unashikiliwa.",
  },
}

function getLocalReassuranceFallback(language: "en" | "sw", tone: Tone): string {
  return LOCAL_REASSURANCE_FALLBACK[tone][language]
}

// ==================== FOLLOW-UP QUESTION : check-in personnalisé ====================

export interface FollowUpEntry {
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

// Replaces one of the two static pool questions in the evening check-in with
// something that shows the app remembers the last 7 days — "the app that
// sees you". No local fallback text exists for this (unlike the companion
// message): a null return just means the caller keeps the pool question it
// already has, which IS the fallback. Consent is checked here, before
// `entries` is ever touched, mirroring the exact
// `checkInsForAi = aiCheckInsEnabled ? checkIns : undefined` gate in
// fetchInsightsWithFallback below — nothing is sent unless both toggles are on.
export async function generateFollowUpQuestion(
  aiEnabled: boolean,
  aiCheckInsEnabled: boolean,
  entries: FollowUpEntry[],
  language: "en" | "sw" = "en",
  tone: Tone = "gentle"
): Promise<string | null> {
  if (!aiEnabled || !aiCheckInsEnabled || entries.length === 0) {
    return null
  }

  if (!isOnline()) {
    return null
  }

  // Unlike generateAiInsights, there's no direct-Groq dev path here — a
  // single edge-function prompt is easier to keep correct than duplicating
  // it, and there's no local fallback text to fall back to anyway; dev mode
  // simply behaves like "AI declined to answer" (same as generateCompanionMessage's
  // simpler dev behavior, not generateAiInsights's).
  if (import.meta.env.DEV) {
    return null
  }

  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ type: "followup_question", language, tone, entries }),
    })

    if (!response.ok) return null
    const json = await response.json()
    const message = typeof json.message === "string" ? json.message.trim() : null
    return message && message.toUpperCase() !== "NONE" ? message : null
  } catch {
    return null
  }
}

// ==================== CACHE & PERSISTENCE ====================

const AI_INSIGHTS_CACHE_BASE = "anchor_ai_insights_cache"

interface InsightsCache {
  insights: AiInsightResult[]
  generatedAt: string
  weekKey: string
}

function getWeekKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-W${getISOWeek(now)}`
}

export function getCachedAiInsights(userId: string): AiInsightResult[] | null {
  const raw = getUserLocalData<InsightsCache>(AI_INSIGHTS_CACHE_BASE, userId)
  if (!raw) return null
  if (raw.weekKey !== getWeekKey()) return null
  return raw.insights
}

export function cacheAiInsights(userId: string, insights: AiInsightResult[]) {
  const cache: InsightsCache = {
    insights,
    generatedAt: new Date().toISOString(),
    weekKey: getWeekKey(),
  }
  setUserLocalData(AI_INSIGHTS_CACHE_BASE, userId, cache)
}

export async function fetchInsightsWithFallback(
  userId: string,
  aiEnabled: boolean,
  aiCheckInsEnabled: boolean,
  moods: MoodLog[],
  anchors: DailyAnchor[],
  checkIns?: CheckIn[],
  forceRefresh = false
): Promise<{ insights: AiInsightResult[]; source: "local" | "ai" | "cached_ai" }> {
  // 1. Toujours générer les locaux
  const localInsights = generateLocalInsights(moods, anchors)

  // 2. Respect du consentement : IA désactivée = insights locaux uniquement, aucun appel
  // réseau et aucune lecture/écriture du cache IA
  if (!aiEnabled) {
    return { insights: localInsights, source: "local" }
  }

  // 3. Si pas online, retourner locaux
  if (!isOnline()) {
    return { insights: localInsights, source: "local" }
  }

  // 4. Vérifier cache hebdo (si pas force refresh)
  if (!forceRefresh) {
    const cached = getCachedAiInsights(userId)
    if (cached) {
      return { insights: [...localInsights, ...cached].slice(0, 4), source: "cached_ai" }
    }
  }

  // 5. Essayer IA (Edge Function en prod, direct en dev). Le toggle "ai_checkins" contrôle
  // si les extraits de check-ins quittent l'appareil — undefined = jamais inclus dans le payload
  const checkInsForAi = aiCheckInsEnabled ? checkIns : undefined
  try {
    const aiInsights = await generateAiInsights(moods, anchors, checkInsForAi)
    cacheAiInsights(userId, aiInsights)
    return { insights: [...localInsights, ...aiInsights].slice(0, 4), source: "ai" }
  } catch (err) {
    console.warn("AI insights failed, falling back to local:", err)
    return { insights: localInsights, source: "local" }
  }
}

