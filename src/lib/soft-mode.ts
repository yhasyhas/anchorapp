// Soft Mode entry/exit trigger detection — pure, no network, same style as
// isSecondConsecutiveLowMoodDay in src/lib/gratitude.ts and resolveMoveReason
// in src/lib/move-selection.ts.

import { localDateStr } from "@/lib/utils"
import type { MoodLog, MoodType } from "@/types"

const LOW_MOODS = new Set(["low", "stressed"])
const GOOD_MOODS = new Set(["great", "okay"])

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

// Today's just-selected mood + the 2 previous calendar days were ALL
// low/stressed — the "3 consecutive low days" automatic trigger.
export function isThirdConsecutiveLowMoodDay(todayMood: MoodType, recentMoods: MoodLog[]): boolean {
  if (!LOW_MOODS.has(todayMood)) return false
  const moodByDate = new Map(recentMoods.map((m) => [m.date, m.mood]))
  const lastTwo = [1, 2].map(daysAgoStr)
  return lastTwo.every((d) => LOW_MOODS.has(moodByDate.get(d) ?? ""))
}

// No mood logged on any of the 4 days immediately before today, and she just
// logged one now — the "absence of 4+ days followed by a return" trigger.
export function isAbsenceReturn(recentMoods: MoodLog[], todayMood: MoodType | null): boolean {
  if (!todayMood) return false
  const moodByDate = new Map(recentMoods.map((m) => [m.date, m.mood]))
  const lastFour = [1, 2, 3, 4].map(daysAgoStr)
  return lastFour.every((d) => !moodByDate.has(d))
}

// Yesterday and the day before both great/okay — evaluated each morning,
// before today's mood is necessarily logged, to drive the exit proposal.
export function hasTwoConsecutiveGoodDaysEndingYesterday(recentMoods: MoodLog[]): boolean {
  const moodByDate = new Map(recentMoods.map((m) => [m.date, m.mood]))
  const lastTwo = [1, 2].map(daysAgoStr)
  return lastTwo.every((d) => GOOD_MOODS.has(moodByDate.get(d) ?? ""))
}
