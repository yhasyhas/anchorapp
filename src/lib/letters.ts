import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"

const LAST_SEEN_KEY = "anchor_letters_last_seen"

export function getLastSeenLetterWeek(userId: string): string | null {
  return getUserLocalData<string>(LAST_SEEN_KEY, userId)
}

// Called when the letters list has loaded — visiting the list is treated as
// "seen" for the unread badge, no per-letter read tracking needed.
export function markLettersSeen(userId: string, latestWeekStart: string | null | undefined): void {
  if (!latestWeekStart) return
  const current = getLastSeenLetterWeek(userId)
  if (!current || latestWeekStart > current) {
    setUserLocalData(LAST_SEEN_KEY, userId, latestWeekStart)
  }
}

export function formatWeekRange(weekStart: string, weekEnd: string, lang: string): string {
  const locale = lang === "sw" ? "sw-TZ" : "en-US"
  const start = new Date(`${weekStart}T00:00:00`)
  const end = new Date(`${weekEnd}T00:00:00`)
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, opts)}`
}
