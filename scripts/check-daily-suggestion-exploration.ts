// Fixture-based check for the deliberate exploration ratio in
// src/lib/daily-suggestion.ts (EXPLORATION_RATIO / isExplorationDay /
// pickByExploration, reached through the public pickDailySuggestion). Same
// spirit as the learned-bias simulation this feature is a response to:
// fixed, skewed history + many simulated days for the same user, checking
// the resulting distribution rather than any single call. Pure module, no
// supabase — run with `npm run check-daily-suggestion-exploration`.
import assert from "node:assert/strict"
import {
  EXPLORATION_RATIO,
  LEARNED_BIAS_MIN_TOTAL_RESPONSES,
  pickDailySuggestion,
  type SuggestionHistoryEntry,
} from "../src/lib/daily-suggestion.ts"
import type { AcceptedWithCategory } from "../src/lib/companion-triggers.ts"
import type { MoveSuggestion } from "../src/types/index.ts"

let failures = 0
function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`ok   ${name}`)
  } else {
    failures++
    console.error(`FAIL ${name}\n     ${detail}`)
  }
}

let idCounter = 0
function makeSuggestion(title: string, category: MoveSuggestion["category"]): MoveSuggestion {
  idCounter++
  return {
    id: `move-${idCounter}`,
    user_id: "u1",
    title,
    category,
    anchor_category: "life",
    is_custom: false,
    generated_by: "user",
    week_key: null,
    is_favorite: false,
    intensity: "standard",
    created_at: "2026-01-01T00:00:00.000Z",
  }
}

// Spans all 6 categories so both exploration branches (never-tried vs.
// least-represented) have room to matter.
const POOL: MoveSuggestion[] = [
  makeSuggestion("Take a 15 min walk", "physical"),
  makeSuggestion("Do a 10 min stretch", "physical"),
  makeSuggestion("Dance to one song", "physical"),
  makeSuggestion("Text someone you trust", "social"),
  makeSuggestion("Call a friend", "social"),
  makeSuggestion("Sit somewhere new", "novelty"),
  makeSuggestion("Write a few lines", "creative"),
  makeSuggestion("Breathe for 2 minutes", "mindful"),
  makeSuggestion("Take a slow nap", "rest"),
]

// A strongly "oriented" history: 20 physical picks (mostly accepted, a few
// declined so it's not a degenerate 100% either), 3 social — everything
// else (novelty/creative/mindful/rest) never touched at all. This is
// exactly the shape the product feedback described: the learned model would
// only ever reinforce "physical".
const ACCEPTED_WITH_CATEGORY: AcceptedWithCategory[] = [
  ...Array.from({ length: 16 }, (_, i) => ({ date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`, category: "physical" as const })),
  ...Array.from({ length: 3 }, (_, i) => ({ date: `2026-07-0${i + 1}`, category: "social" as const })),
]

const HISTORY: SuggestionHistoryEntry[] = [
  ...Array.from({ length: 16 }, () => ({ title: "Take a 15 min walk", status: "accepted" as const })),
  ...Array.from({ length: 4 }, () => ({ title: "Do a 10 min stretch", status: "declined" as const })),
  ...Array.from({ length: 3 }, () => ({ title: "Text someone you trust", status: "accepted" as const })),
]
assert.ok(HISTORY.length >= LEARNED_BIAS_MIN_TOTAL_RESPONSES, "fixture must clear the learned-bias sample-size gate")

const NEVER_TRIED = new Set(["novelty", "creative", "mindful", "rest"])
const OVER_REPRESENTED = new Set(["physical"])

function simulateDay(dateStr: string, history: SuggestionHistoryEntry[], acceptedWithCategory: AcceptedWithCategory[]) {
  return pickDailySuggestion({
    pool: POOL,
    values: [],
    seed: `user-1:${dateStr}`,
    history,
    acceptedWithCategory,
  })
}

// ── 1. Ratio converges toward ~25%, not 0% nor 100% ──
const SIM_DAYS = 600
let explorationCount = 0
const explorationCategories = new Set<string>()
for (let d = 1; d <= SIM_DAYS; d++) {
  const dateStr = `2027-01-${String(d).padStart(3, "0")}` // not a real calendar, just a distinct daily seed string
  const pick = simulateDay(dateStr, HISTORY, ACCEPTED_WITH_CATEGORY)
  assert.ok(pick, "pool is never empty in this fixture")
  if (pick!.selectionReason === "exploration") {
    explorationCount++
    const category = POOL.find((s) => s.title === pick!.text)!.category
    explorationCategories.add(category)
  }
}
const ratio = explorationCount / SIM_DAYS
check(
  `exploration ratio converges near EXPLORATION_RATIO (${EXPLORATION_RATIO}) over ${SIM_DAYS} simulated days`,
  ratio > 0.15 && ratio < 0.35,
  `got ratio=${ratio.toFixed(3)} (${explorationCount}/${SIM_DAYS}) — expected roughly 0.15-0.35`
)
check("exploration never fires 0% of the time", explorationCount > 0, "expected at least some exploration days")
check("exploration never fires 100% of the time", explorationCount < SIM_DAYS, "expected most days to stay familiar")

// ── 2. Exploration picks land on under-tried categories, never the
//      over-represented one ──
check(
  "every exploration pick's category is one of the never-tried/least-represented ones",
  [...explorationCategories].every((c) => !OVER_REPRESENTED.has(c)),
  `explorationCategories=${JSON.stringify([...explorationCategories])} unexpectedly includes an over-represented category`
)
check(
  "at least one never-tried category was actually explored over the simulation",
  [...explorationCategories].some((c) => NEVER_TRIED.has(c)),
  `explorationCategories=${JSON.stringify([...explorationCategories])} — expected at least one of ${JSON.stringify([...NEVER_TRIED])}`
)

// ── 3. Stability: same user+date reload never flips the verdict ──
const a = simulateDay("2027-03-15", HISTORY, ACCEPTED_WITH_CATEGORY)
const b = simulateDay("2027-03-15", HISTORY, ACCEPTED_WITH_CATEGORY)
check(
  "same (user, date) seed is stable across repeated calls (reload-safe)",
  JSON.stringify(a) === JSON.stringify(b),
  `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`
)

// ── 4. Below LEARNED_BIAS_MIN_TOTAL_RESPONSES, exploration never activates
//      — same threshold guardrail item 6 requires ──
const SHORT_HISTORY: SuggestionHistoryEntry[] = HISTORY.slice(0, LEARNED_BIAS_MIN_TOTAL_RESPONSES - 1)
let belowThresholdExploration = 0
for (let d = 1; d <= 120; d++) {
  const pick = simulateDay(`2027-05-${String(d).padStart(3, "0")}`, SHORT_HISTORY, ACCEPTED_WITH_CATEGORY)
  if (pick?.selectionReason === "exploration") belowThresholdExploration++
}
check(
  "below LEARNED_BIAS_MIN_TOTAL_RESPONSES, exploration never fires regardless of the day roll",
  belowThresholdExploration === 0,
  `expected 0 exploration days below the threshold, got ${belowThresholdExploration}`
)

// ── 5. A pool spanning only one category never "explores" (nothing to
//      deliberately favor) — falls through to the normal weighted path ──
const SINGLE_CATEGORY_POOL: MoveSuggestion[] = [
  makeSuggestion("Take a 15 min walk", "physical"),
  makeSuggestion("Do a 10 min stretch", "physical"),
  makeSuggestion("Dance to one song", "physical"),
]
let singleCategoryExploration = 0
for (let d = 1; d <= 120; d++) {
  const pick = pickDailySuggestion({
    pool: SINGLE_CATEGORY_POOL,
    values: [],
    seed: `user-1:2027-06-${String(d).padStart(3, "0")}`,
    history: HISTORY,
    acceptedWithCategory: ACCEPTED_WITH_CATEGORY,
  })
  if (pick?.selectionReason === "exploration") singleCategoryExploration++
}
check(
  "a single-category pool never produces an 'exploration' reason",
  singleCategoryExploration === 0,
  `expected 0, got ${singleCategoryExploration}`
)

if (failures > 0) {
  console.error(`\n${failures} exploration-ratio check(s) failed.`)
  process.exit(1)
} else {
  console.log(`\n✓ All exploration-ratio checks passed (ratio=${ratio.toFixed(3)}).`)
}
