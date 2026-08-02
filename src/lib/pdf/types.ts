import type { CheckIn, DailyAnchor, JournalEntry, MoodLog, ProgressStory, WeeklyLetter } from "@/types"

export interface MonthlyJournalData {
  monthStart: string // YYYY-MM-DD, first day of the exported month
  monthEnd: string // YYYY-MM-DD, last day of the exported month
  firstName: string
  lang: "en" | "sw"
  anchors: DailyAnchor[]
  moods: MoodLog[]
  checkIns: CheckIn[]
  journalEntries: JournalEntry[]
  weeklyLetters: WeeklyLetter[]
  progressStory: ProgressStory | null
}

export interface MonthStats {
  daysPresent: number
  anchorsCompletedDays: number
  bestMoodStreak: number
  bestAnchorStreak: number
  dominantIntention: string | null
  moodCounts: Record<string, number>
  isQuietMonth: boolean
}

export interface MoodChartPoint {
  date: string
  value: number | null
  mood: string | null
}
