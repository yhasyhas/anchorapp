import { moodToValue } from "@/lib/constants"
import { calculateBestAnchorStreakWithGrace, calculateBestStreakFromDates } from "@/lib/streaks"
import type { JournalEntry } from "@/types"
import type { MonthlyJournalData, MonthStats, MoodChartPoint } from "./types"

export function computeMonthStats(data: MonthlyJournalData): MonthStats {
  const presentDates = new Set<string>()
  for (const a of data.anchors) presentDates.add(a.date)
  for (const m of data.moods) presentDates.add(m.date)
  for (const c of data.checkIns) presentDates.add(c.date)
  for (const j of data.journalEntries) presentDates.add(j.date)

  const fullyCompleted = data.anchors.filter((a) => a.future_completed && a.mindbody_completed && a.life_completed)

  const moodCounts: Record<string, number> = {}
  for (const m of data.moods) moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1

  const intentionFreq: Record<string, number> = {}
  for (const a of data.anchors) {
    if (!a.daily_intention) continue
    intentionFreq[a.daily_intention] = (intentionFreq[a.daily_intention] || 0) + 1
  }
  const dominantIntention = Object.entries(intentionFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return {
    daysPresent: presentDates.size,
    anchorsCompletedDays: fullyCompleted.length,
    bestMoodStreak: calculateBestStreakFromDates(data.moods.map((m) => m.date)),
    bestAnchorStreak: calculateBestAnchorStreakWithGrace(fullyCompleted.map((a) => a.date)),
    dominantIntention,
    moodCounts,
    isQuietMonth: presentDates.size === 0,
  }
}

// "Moments that mattered": the fuller sentences tend to be the ones worth re-reading later,
// capped so the page stays a curated handful rather than a full reprint of the journal —
// re-sorted back to chronological order once picked, so the page still reads like a month.
export function pickJournalHighlights(entries: JournalEntry[], max = 6): JournalEntry[] {
  if (entries.length <= max) return entries
  return [...entries]
    .sort((a, b) => b.sentence.length - a.sentence.length)
    .slice(0, max)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

export function buildMoodChartPoints(data: MonthlyJournalData): MoodChartPoint[] {
  const byDate = new Map(data.moods.map((m) => [m.date, m.mood]))
  const points: MoodChartPoint[] = []
  const [y, mo] = data.monthStart.split("-").map(Number)
  const lastDay = new Date(y, mo, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  for (let d = 1; d <= lastDay; d++) {
    const date = `${y}-${pad(mo)}-${pad(d)}`
    const mood = byDate.get(date) ?? null
    points.push({ date, mood, value: mood ? moodToValue[mood] ?? null : null })
  }
  return points
}
