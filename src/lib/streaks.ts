import type { MoodLog, DailyAnchor } from "@/types"

export interface StreakData {
  currentMoodStreak: number
  currentAnchorStreak: number
  bestMoodStreak: number
  bestAnchorStreak: number
}

export function calculateStreaks(moods: MoodLog[], anchors: DailyAnchor[]): StreakData {
  // Trier du plus ancien au plus récent
  const sortedMoods = [...moods].sort((a, b) => a.date.localeCompare(b.date))
  const sortedAnchors = [...anchors].sort((a, b) => a.date.localeCompare(b.date))

  // ─── Mood Streaks (Option A : n'importe quelle humeur compte) ───
  let bestMoodStreak = 0
  let tempMoodStreak = 0

  for (const m of sortedMoods) {
    // ✅ Toute humeur logguée compte : great, okay, meh, low, stressed
    if (m.mood) {
      tempMoodStreak++
      bestMoodStreak = Math.max(bestMoodStreak, tempMoodStreak)
    } else {
      tempMoodStreak = 0
    }
  }

  // Current mood streak = depuis aujourd'hui en arrière
  const today = new Date().toISOString().split("T")[0]
  const reversedMoods = [...sortedMoods].reverse()
  let currentMoodStreak = 0
  for (const m of reversedMoods) {
    if (m.date > today) continue // ignore le futur
    if (m.mood) {
      // ✅ N'importe quelle humeur
      currentMoodStreak++
    } else {
      break
    }
  }

  // ─── Anchor Streaks (3/3 cochées) ───
  let bestAnchorStreak = 0
  let tempAnchorStreak = 0

  for (const a of sortedAnchors) {
    // ✅ Les 3 ancres doivent être complétées
    if (a.future_completed && a.mindbody_completed && a.life_completed) {
      tempAnchorStreak++
      bestAnchorStreak = Math.max(bestAnchorStreak, tempAnchorStreak)
    } else {
      tempAnchorStreak = 0
    }
  }

  const reversedAnchors = [...sortedAnchors].reverse()
  let currentAnchorStreak = 0
  for (const a of reversedAnchors) {
    if (a.date > today) continue
    if (a.future_completed && a.mindbody_completed && a.life_completed) {
      currentAnchorStreak++
    } else {
      break
    }
  }

  return {
    currentMoodStreak,
    currentAnchorStreak,
    bestMoodStreak,
    bestAnchorStreak,
  }
}