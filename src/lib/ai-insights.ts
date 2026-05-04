import type { MoodLog, DailyAnchor } from "@/types"

interface InsightResult {
  text: string
  category: "mood_action_correlation" | "pattern" | "suggestion"
}

export function generateInsights(moods: MoodLog[], anchors: DailyAnchor[]): InsightResult[] {
  const insights: InsightResult[] = []

  if (moods.length < 3) return insights

  const goodDays = moods.filter(m => m.mood === "great" || m.mood === "okay")
  const goodDates = new Set(goodDays.map(m => m.date))

  const anchorsOnGoodDays = anchors.filter(a => goodDates.has(a.date))
  const lifeCompletedOnGoodDays = anchorsOnGoodDays.filter(a => a.life_completed).length

  if (lifeCompletedOnGoodDays > goodDays.length * 0.5 && goodDays.length >= 2) {
    insights.push({
      text: "You feel better on days you complete your Life anchor.",
      category: "mood_action_correlation",
    })
  }

  const mindbodySkipStreak = findSkipStreak(anchors, "mindbody")
  if (mindbodySkipStreak >= 2) {
    insights.push({
      text: "Your mood tends to drop after skipping Mind/Body for 2+ days.",
      category: "pattern",
    })
  }

  const hasMovementInAnchors = anchors.some(
    a => a.mindbody_task.toLowerCase().includes("walk") ||
      a.mindbody_task.toLowerCase().includes("stretch") ||
      a.mindbody_task.toLowerCase().includes("exercise")
  )
  if (hasMovementInAnchors) {
    insights.push({
      text: "Try a 5-minute stretch tomorrow \u2014 your better days often include movement.",
      category: "suggestion",
    })
  }

  if (insights.length === 0) {
    const avgMood = moods.reduce((sum, m) => {
      const val = { great: 5, okay: 4, meh: 3, low: 2, stressed: 1 }[m.mood] ?? 3
      return sum + val
    }, 0) / moods.length

    if (avgMood >= 3.5) {
      insights.push({
        text: "Your week has been steady. Keep nurturing what works for you.",
        category: "pattern",
      })
    } else {
      insights.push({
        text: "This week has been heavy. Small anchors can help you find ground.",
        category: "suggestion",
      })
    }
  }

  return insights.slice(0, 3)
}

function findSkipStreak(anchors: DailyAnchor[], type: "mindbody" | "future" | "life"): number {
  const sorted = [...anchors].sort((a, b) => b.date.localeCompare(a.date))
  let streak = 0
  for (const anchor of sorted) {
    const completed = type === "mindbody" ? anchor.mindbody_completed
      : type === "future" ? anchor.future_completed
      : anchor.life_completed
    if (!completed) {
      streak++
    } else {
      break
    }
  }
  return streak
}
