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

  // ─── Mood Streaks ───
  let bestMoodStreak = 0
  let currentMoodStreak = 0
  let tempMoodStreak = 0

  for (const m of sortedMoods) {
    if (m.mood === "great" || m.mood === "okay") {
      tempMoodStreak++
      bestMoodStreak = Math.max(bestMoodStreak, tempMoodStreak)
    } else {
      tempMoodStreak = 0
    }
  }

  // Current mood streak = depuis le dernier jour en arrière
  const today = new Date().toISOString().split("T")[0]
  const reversedMoods = [...sortedMoods].reverse()
  currentMoodStreak = 0
  for (const m of reversedMoods) {
    if (m.date > today) continue // future
    if (m.mood === "great" || m.mood === "okay") {
      currentMoodStreak++
    } else {
      break
    }
  }

  // ─── Anchor Streaks ───
  let bestAnchorStreak = 0
  let currentAnchorStreak = 0
  let tempAnchorStreak = 0

  for (const a of sortedAnchors) {
    if (a.future_completed && a.mindbody_completed && a.life_completed) {
      tempAnchorStreak++
      bestAnchorStreak = Math.max(bestAnchorStreak, tempAnchorStreak)
    } else {
      tempAnchorStreak = 0
    }
  }

  const reversedAnchors = [...sortedAnchors].reverse()
  currentAnchorStreak = 0
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