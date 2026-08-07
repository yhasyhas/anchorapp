import { supabase } from "@/lib/supabase"
import type { CheckIn, CustomIntention, DailyAnchor, JournalEntry, MoodLog, ProgressStory, WeeklyLetter } from "@/types"
import type { MonthlyJournalData } from "./types"

// "2026-08" -> ["2026-08-01", "2026-08-31"]
export function monthBounds(monthIso: string): { monthStart: string; monthEnd: string } {
  const [year, month] = monthIso.split("-").map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    monthStart: `${year}-${pad(month)}-01`,
    monthEnd: `${year}-${pad(month)}-${pad(lastDay)}`,
  }
}

// Picks the progress story that best represents this calendar month: prefer one whose
// period_end actually lands inside the month (the "as of this month" snapshot), otherwise
// fall back to whichever overlapping story is most recent.
function pickProgressStory(stories: ProgressStory[], monthStart: string, monthEnd: string): ProgressStory | null {
  if (stories.length === 0) return null
  const endsInMonth = stories.find((s) => s.period_end >= monthStart && s.period_end <= monthEnd)
  if (endsInMonth) return endsInMonth
  return [...stories].sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0]
}

export async function fetchMonthlyJournalData(
  userId: string,
  monthIso: string,
  firstName: string,
  lang: "en" | "sw"
): Promise<MonthlyJournalData> {
  const { monthStart, monthEnd } = monthBounds(monthIso)

  const [anchorsRes, moodsRes, checkInsRes, journalRes, lettersRes, storiesRes, customIntentionsRes] = await Promise.all([
    supabase.from("daily_anchors").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: true }),
    supabase.from("mood_logs").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: true }),
    supabase.from("check_ins").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: true }),
    supabase.from("journal_entries").select("*").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: true }),
    supabase
      .from("weekly_letters")
      .select("*")
      .eq("user_id", userId)
      .lte("week_start", monthEnd)
      .gte("week_end", monthStart)
      .order("week_start", { ascending: true }),
    supabase
      .from("progress_stories")
      .select("*")
      .eq("user_id", userId)
      .lte("period_start", monthEnd)
      .gte("period_end", monthStart)
      .order("period_end", { ascending: false }),
    // Include archived customs too (unlike listCustomIntentions) — a since-archived
    // intention can still be the dominant one for a past month's export.
    supabase.from("custom_intentions").select("*").eq("user_id", userId),
  ])

  const stories = (storiesRes.data as ProgressStory[]) || []

  return {
    monthStart,
    monthEnd,
    firstName,
    lang,
    anchors: (anchorsRes.data as DailyAnchor[]) || [],
    moods: (moodsRes.data as MoodLog[]) || [],
    checkIns: (checkInsRes.data as CheckIn[]) || [],
    journalEntries: (journalRes.data as JournalEntry[]) || [],
    weeklyLetters: (lettersRes.data as WeeklyLetter[]) || [],
    progressStory: pickProgressStory(stories, monthStart, monthEnd),
    customIntentions: (customIntentionsRes.data as CustomIntention[]) || [],
  }
}
