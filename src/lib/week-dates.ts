// Pure Monday-Sunday week-boundary math, split out of weekly-review.ts so it
// can be imported without pulling in that module's supabase/compass
// dependency chain. Needed by scripts/check-duplicated-logic.ts, which runs
// under plain tsx (no Vite `import.meta.env` replacement) — importing
// weekly-review.ts directly there would crash at module-evaluation time on
// its `@/lib/compass` -> `@/lib/supabase` import (that module's top-level
// `createClient(import.meta.env.VITE_SUPABASE_URL, ...)` call). This file
// depends only on `@/lib/utils` (pure) — keep it that way.
import { localDateStr } from "@/lib/utils"

// Monday-Sunday week, matching the ISO-week convention already used
// elsewhere (getISOWeek in daily-suggestion-context.tsx / ai-service.ts).
function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

export function weekStartStr(date: Date = new Date()): string {
  return localDateStr(mondayOf(date))
}

// Eligibility window: exactly Sunday, the last day of a Monday-Sunday week.
// The spec's parenthetical ("or any day left in the week, as long as next
// Monday hasn't started") collapses to this single day once the week is
// defined as Monday-Sunday — there IS no day left in the week after Sunday
// but before the next Monday, so rather than invent slack the spec didn't
// actually ask for, this stays exactly one day. todayStr()/localDateStr()
// already resolve to the viewer's own local calendar day (see utils.ts), so
// no separate timezone handling is needed here either.
export function isWeeklyReviewEligibleDay(date: Date = new Date()): boolean {
  return date.getDay() === 0
}
