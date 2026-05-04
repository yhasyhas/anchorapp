import { supabase } from "@/lib/supabase"
import { isOnline, getLocalData } from "@/lib/offline-sync"
import type { MoodLog, DailyAnchor, CheckIn } from "@/types"

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const GROQ_MODEL = "llama-3.1-8b-instant"

interface UserPatternData {
  period: string
  totalDays: number
  moodDistribution: Record<string, number>
  anchorCompletionRate: {
    future: number
    mindbody: number
    life: number
    overall: number
  }
  topIntentions: string[]
  frequentMoveCategories: string[]
  checkInSnippets?: string[]
  streaks: {
    bestMoodStreak: number
    bestAnchorStreak: number
  }
}

interface AiInsightResult {
  text: string
  category: "mood_action_correlation" | "pattern" | "suggestion"
  source: "local" | "ai"
  generatedAt: string
}

// ==================== TIER 2 : LOCAL AVANCÉ ====================

export function generateLocalInsights(moods: MoodLog[], anchors: DailyAnchor[]): AiInsightResult[] {
  const insights: AiInsightResult[] = []

  if (moods.length < 3) return insights

  // 1. Corrélation humeur + ancre Life
  const goodDays = moods.filter(m => m.mood === "great" || m.mood === "okay")
  const goodDates = new Set(goodDays.map(m => m.date))
  const anchorsOnGoodDays = anchors.filter(a => goodDates.has(a.date))
  const lifeCompletedOnGoodDays = anchorsOnGoodDays.filter(a => a.life_completed).length

  if (lifeCompletedOnGoodDays > goodDays.length * 0.5 && goodDays.length >= 2) {
    insights.push({
      text: "You feel better on days you complete your Life anchor.",
      category: "mood_action_correlation",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 2. Corrélation humeur + ancre Mind/Body
  const mindbodyCompletedOnGoodDays = anchorsOnGoodDays.filter(a => a.mindbody_completed).length
  if (mindbodyCompletedOnGoodDays > goodDays.length * 0.6) {
    insights.push({
      text: "Your Mind/Body anchor seems to be your emotional anchor — it shows up in your best days.",
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
      text: `Your mood tends to soften after skipping Mind/Body for ${mindbodySkipStreak} days. A small stretch might help.`,
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 4. Pattern intention
  const intentions = anchors.map(a => a.daily_intention).filter(Boolean)
  const intentionFreq: Record<string, number> = {}
  intentions.forEach(i => { intentionFreq[i] = (intentionFreq[i] || 0) + 1 })
  const topIntention = Object.entries(intentionFreq).sort((a, b) => b[1] - a[1])[0]
  if (topIntention && topIntention[1] >= 3) {
    insights.push({
      text: `You've been inviting ${topIntention[0]} often. Your spirit is calling for it — listen closer.`,
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 5. Suggestion mouvement
  const hasMovement = anchors.some(a =>
    a.mindbody_task.toLowerCase().includes("walk") ||
    a.mindbody_task.toLowerCase().includes("stretch") ||
    a.life_task.toLowerCase().includes("outside")
  )
  if (!hasMovement && moods.some(m => m.mood === "low" || m.mood === "stressed")) {
    insights.push({
      text: "Your body might be asking for gentle movement. Even 5 minutes of walking can shift the energy.",
      category: "suggestion",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 6. Pattern humeur dégradante
  const recentMoods = [...moods].sort((a, b) => a.date.localeCompare(b.date)).slice(-5)
  const moodValues = recentMoods.map(m => ({ great: 5, okay: 4, meh: 3, low: 2, stressed: 1 }[m.mood] || 3))
  const declining = moodValues.every((v, i) => i === 0 || v <= moodValues[i - 1] + 0.5)
  if (declining && moodValues.length >= 3 && moodValues[moodValues.length - 1] <= 2) {
    insights.push({
      text: "You've been carrying a heavier energy lately. Be extra gentle with yourself — this too shall pass.",
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  // 7. Célébration cohérence
  const completionRate = anchors.length > 0
    ? anchors.reduce((sum, a) => sum + (a.future_completed ? 1 : 0) + (a.mindbody_completed ? 1 : 0) + (a.life_completed ? 1 : 0), 0) / (anchors.length * 3)
    : 0
  if (completionRate > 0.7 && anchors.length >= 5) {
    insights.push({
      text: "You're showing up for yourself consistently. That kind of devotion plants deep roots.",
      category: "pattern",
      source: "local",
      generatedAt: new Date().toISOString(),
    })
  }

  return insights.slice(0, 3)
}

// ==================== TIER 3 : GROQ IA ====================

function buildPatternData(moods: MoodLog[], anchors: DailyAnchor[], checkIns?: CheckIn[]): UserPatternData {
  const moodDist: Record<string, number> = {}
  moods.forEach(m => { moodDist[m.mood] = (moodDist[m.mood] || 0) + 1 })

  const futureRate = anchors.length ? anchors.filter(a => a.future_completed).length / anchors.length : 0
  const mindbodyRate = anchors.length ? anchors.filter(a => a.mindbody_completed).length / anchors.length : 0
  const lifeRate = anchors.length ? anchors.filter(a => a.life_completed).length / anchors.length : 0

  const intentions = anchors.map(a => a.daily_intention).filter(Boolean)
  const intentionFreq: Record<string, number> = {}
  intentions.forEach(i => { intentionFreq[i] = (intentionFreq[i] || 0) + 1 })
  const topIntentions = Object.entries(intentionFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)

  // Streaks
  let bestMoodStreak = 0
  let currentMoodStreak = 0
  const sortedMoods = [...moods].sort((a, b) => a.date.localeCompare(b.date))
  for (const m of sortedMoods) {
    if (m.mood === "great" || m.mood === "okay") {
      currentMoodStreak++
      bestMoodStreak = Math.max(bestMoodStreak, currentMoodStreak)
    } else {
      currentMoodStreak = 0
    }
  }

  let bestAnchorStreak = 0
  let currentAnchorStreak = 0
  for (const a of sortedAnchors(anchors)) {
    if (a.future_completed && a.mindbody_completed && a.life_completed) {
      currentAnchorStreak++
      bestAnchorStreak = Math.max(bestAnchorStreak, currentAnchorStreak)
    } else {
      currentAnchorStreak = 0
    }
  }

  const snippets = checkIns
    ?.filter(c => c.what_matters || c.what_felt_real)
    .slice(-5)
    .map(c => [c.what_matters, c.what_felt_real].filter(Boolean).join(". "))
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
    frequentMoveCategories: [], // Rempli si besoin
    checkInSnippets: snippets && snippets.length > 0 ? snippets : undefined,
    streaks: { bestMoodStreak, bestAnchorStreak },
  }
}

function sortedAnchors(anchors: DailyAnchor[]) {
  return [...anchors].sort((a, b) => a.date.localeCompare(b.date))
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

export async function generateAiInsights(
  moods: MoodLog[],
  anchors: DailyAnchor[],
  checkIns?: CheckIn[]
): Promise<AiInsightResult[]> {
  if (!isOnline()) {
    throw new Error("offline")
  }

  if (!GROQ_API_KEY) {
    throw new Error("no_api_key")
  }

  const data = buildPatternData(moods, anchors, checkIns)

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: `Analyze these patterns and generate 3 personalized insights:\n\n${JSON.stringify(data, null, 2)}` }
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

// ==================== CACHE & PERSISTENCE ====================

const AI_INSIGHTS_CACHE_KEY = "anchor_ai_insights_cache"

interface InsightsCache {
  insights: AiInsightResult[]
  generatedAt: string
  weekKey: string
}

function getWeekKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-W${Math.ceil((now.getDate() + now.getDay()) / 7)}`
}

export function getCachedAiInsights(): AiInsightResult[] | null {
  const raw = getLocalData<InsightsCache>(AI_INSIGHTS_CACHE_KEY)
  if (!raw) return null
  if (raw.weekKey !== getWeekKey()) return null
  return raw.insights
}

export function cacheAiInsights(insights: AiInsightResult[]) {
  const cache: InsightsCache = {
    insights,
    generatedAt: new Date().toISOString(),
    weekKey: getWeekKey(),
  }
  localStorage.setItem(AI_INSIGHTS_CACHE_KEY, JSON.stringify(cache))
}

export async function fetchInsightsWithFallback(
  moods: MoodLog[],
  anchors: DailyAnchor[],
  checkIns?: CheckIn[],
  forceRefresh = false
): Promise<{ insights: AiInsightResult[]; source: "local" | "ai" | "cached_ai" }> {
  // 1. Toujours générer les locaux
  const localInsights = generateLocalInsights(moods, anchors)

  // 2. Si pas online, retourner locaux
  if (!isOnline()) {
    return { insights: localInsights, source: "local" }
  }

  // 3. Vérifier cache hebdo (si pas force refresh)
  if (!forceRefresh) {
    const cached = getCachedAiInsights()
    if (cached) {
      return { insights: [...localInsights, ...cached].slice(0, 4), source: "cached_ai" }
    }
  }

  // 4. Essayer Groq
  try {
    const aiInsights = await generateAiInsights(moods, anchors, checkIns)
    cacheAiInsights(aiInsights)
    return { insights: [...localInsights, ...aiInsights].slice(0, 4), source: "ai" }
  } catch (err) {
    console.warn("AI insights failed, falling back to local:", err)
    return { insights: localInsights, source: "local" }
  }
}