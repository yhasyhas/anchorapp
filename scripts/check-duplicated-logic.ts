// Runtime-equivalence check for this app's few *legitimately* duplicated
// pure functions — each api/*.ts Vercel function is bundled separately, so
// small helpers get hand-copied rather than imported (see each duplicate's
// own "bundled separately" comment). A source-text diff would false-positive
// on trivial differences (e.g. `any` vs typed params) while missing real
// behavioral drift, so this instead runs both copies against shared
// fixtures and asserts identical output. Run with `npm run check:duplicates`.
//
// This is exactly the kind of drift that already happened once:
// isAnchorDayComplete landed in api/insights.ts during the Soft Mode work
// but was initially missing from src/lib/pdf/stats.ts (a different,
// intentionally-not-checked-here file — see its own comment on why).
import assert from "node:assert/strict"
import {
  calculateBestStreakFromDates as canonicalBestStreak,
  calculateBestAnchorStreakWithGrace as canonicalBestAnchorStreak,
  isAnchorDayComplete as canonicalIsAnchorDayComplete,
} from "../src/lib/streaks.ts"
import {
  calculateBestStreakFromDates as insightsBestStreak,
  calculateBestAnchorStreakWithGrace as insightsBestAnchorStreak,
  isAnchorDayComplete as insightsIsAnchorDayComplete,
} from "../api/insights.ts"
import { capWords as remindersCapWords } from "../api/cron/reminders.ts"
import { capWords as letterCapWords } from "../api/cron/weekly-letter.ts"

let failures = 0

function check(name: string, context: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepStrictEqual(actual, expected)
  } catch {
    failures++
    console.error(
      `✗ ${name} diverged for ${context}\n  canonical: ${JSON.stringify(expected)}\n  duplicate: ${JSON.stringify(actual)}`
    )
  }
}

const DATE_FIXTURES: string[][] = [
  [],
  ["2026-08-01"],
  ["2026-08-01", "2026-08-02", "2026-08-03"],
  ["2026-08-01", "2026-08-03"], // 1-day gap — grace territory for the anchor variant
  ["2026-08-01", "2026-08-04"], // 2-day gap — breaks even the grace variant
  ["2026-08-01", "2026-08-02", "2026-08-04", "2026-08-05", "2026-08-06"],
  ["2026-07-30", "2026-07-31", "2026-08-01"], // month boundary
  ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"], // year boundary
]

for (const dates of DATE_FIXTURES) {
  const context = JSON.stringify(dates)
  check("calculateBestStreakFromDates", context, insightsBestStreak(dates), canonicalBestStreak(dates))
  check("calculateBestAnchorStreakWithGrace", context, insightsBestAnchorStreak(dates), canonicalBestAnchorStreak(dates))
}

const ANCHOR_ROW_FIXTURES = [
  { future_completed: true, mindbody_completed: true, life_completed: true, soft_mode_day: false },
  { future_completed: true, mindbody_completed: false, life_completed: true, soft_mode_day: false },
  { future_completed: true, mindbody_completed: false, life_completed: false, soft_mode_day: true },
  { future_completed: false, mindbody_completed: false, life_completed: false, soft_mode_day: true },
  { future_completed: false, mindbody_completed: false, life_completed: false, soft_mode_day: false },
]

for (const row of ANCHOR_ROW_FIXTURES) {
  const context = JSON.stringify(row)
  check("isAnchorDayComplete", context, insightsIsAnchorDayComplete(row), canonicalIsAnchorDayComplete(row as any))
}

const WORD_FIXTURES: [string, number][] = [
  ["short sentence", 16],
  ["a very long sentence that definitely goes past the sixteen word limit set for this particular fixture case here", 16],
  ["exact,", 1],
  ["", 5],
]

for (const [text, maxWords] of WORD_FIXTURES) {
  const context = `"${text}" @ ${maxWords} words`
  check("capWords", context, remindersCapWords(text, maxWords), letterCapWords(text, maxWords))
}

if (failures > 0) {
  console.error(`\n${failures} duplicated-logic check(s) failed — the copies have drifted apart.`)
  process.exit(1)
} else {
  console.log("✓ All duplicated logic pairs are behaviorally identical.")
}
