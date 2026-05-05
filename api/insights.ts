export const config = {
  runtime: "edge",
}

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    const body = await request.json()
    const { type = "insights" } = body

    if (type === "companion") {
      return await handleCompanion(body, GROQ_API_KEY)
    }

    return await handleInsights(body, GROQ_API_KEY)
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
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

  let bestMoodStreak = 0
  let currentMoodStreak = 0
  const sortedMoods = [...moods].sort((a: any, b: any) => a.date.localeCompare(b.date))
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
  const sortedAnchors = [...anchors].sort((a: any, b: any) => a.date.localeCompare(b.date))
  for (const a of sortedAnchors) {
    if (a.future_completed && a.mindbody_completed && a.life_completed) {
      currentAnchorStreak++
      bestAnchorStreak = Math.max(bestAnchorStreak, currentAnchorStreak)
    } else {
      currentAnchorStreak = 0
    }
  }

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