import { localDateStr } from "@/lib/utils"
import type { MoodLog, DailyAnchor } from "@/types"

export interface StreakData {
  currentMoodStreak: number
  currentAnchorStreak: number
  bestMoodStreak: number
  bestAnchorStreak: number
}

// Convertit "YYYY-MM-DD" en index de jour (jours depuis l'epoch) pour comparer deux
// dates calendaires sans se soucier du fuseau horaire ou des changements d'heure DST
function dayIndex(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

function addDaysLocal(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  return d
}

// Meilleur streak : reconstruit une timeline calendaire continue en comparant les dates
// consécutives triées — un jour sans ligne (trou dans le calendrier) casse le streak
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

// Streak courant : part d'aujourd'hui et remonte tant que les jours sont consécutifs.
// Si aujourd'hui n'est pas encore logué, on part d'hier à la place — la journée n'est
// pas terminée, donc on ne casse pas le streak d'hier pour autant.
function calculateCurrentStreakFromDates(dateSet: Set<string>): number {
  const now = new Date()
  let cursor = dateSet.has(localDateStr(now)) ? now : addDaysLocal(now, -1)
  let streak = 0
  while (dateSet.has(localDateStr(cursor))) {
    streak++
    cursor = addDaysLocal(cursor, -1)
  }
  return streak
}

export function calculateStreaks(moods: MoodLog[], anchors: DailyAnchor[]): StreakData {
  const today = localDateStr()

  // ✅ Toute humeur logguée compte : great, okay, meh, low, stressed
  const moodDates = new Set(moods.filter((m) => m.mood && m.date <= today).map((m) => m.date))
  // ✅ Les 3 ancres doivent être complétées
  const anchorDates = new Set(
    anchors
      .filter((a) => a.future_completed && a.mindbody_completed && a.life_completed && a.date <= today)
      .map((a) => a.date)
  )

  return {
    currentMoodStreak: calculateCurrentStreakFromDates(moodDates),
    currentAnchorStreak: calculateCurrentStreakFromDates(anchorDates),
    bestMoodStreak: calculateBestStreakFromDates([...moodDates]),
    bestAnchorStreak: calculateBestStreakFromDates([...anchorDates]),
  }
}