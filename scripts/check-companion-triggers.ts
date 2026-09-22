// Fixture-based check for src/lib/companion-triggers.ts — every detector
// gets controlled positive and negative cases, plus an idempotency pass
// (detect -> store -> detect again must yield nothing) that mirrors what the
// companion_observations unique indexes enforce in the database. The
// detectors are pure and take "today"/"now" as parameters, so nothing here
// depends on the real clock. Run with `npm run check-companion-triggers`.
import assert from "node:assert/strict"
import {
  CIRCLE_RETURN_ABSENCE_DAYS,
  FIRST_TIME_LOOKBACK_DAYS,
  GOAL_GAP_WEEKS,
  HARD_MOMENT_MIN_DAYS,
  detectCelebration,
  detectFirstTime,
  detectGoalGap,
  detectHardMoment,
  resolveAcceptedCategories,
  type CompanionObservationDraft,
  type ExistingObservation,
} from "../src/lib/companion-triggers.ts"
import { GOAL_COOLDOWN_WEEKS, GOAL_STALE_WEEKS, pickGoalToPrompt } from "../src/lib/goal-matching.ts"
import { ANCHOR_STREAK_MILESTONES } from "../src/lib/streaks.ts"
import type { CompassGoal, MoodType } from "../src/types/index.ts"

let failures = 0
let passed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
  } catch (err) {
    failures++
    console.error(`✗ ${name}\n  ${(err as Error).message.split("\n").join("\n  ")}`)
  }
}

// Monday. The Sunday of the same Monday-Sunday week is 2026-09-27.
const TODAY = "2026-09-21"

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

const ago = (n: number) => addDays(TODAY, -n)
const mood = (daysAgo: number, m: MoodType) => ({ date: ago(daysAgo), mood: m })
const obs = (
  type: ExistingObservation["type"],
  payload: Record<string, unknown>,
  acknowledged = false
): ExistingObservation => ({ type, payload, acknowledged })
const key = (d: CompanionObservationDraft | null) => d?.payload.dedupeKey ?? null

function goal(id: string, text: string, createdDaysAgo: number): CompassGoal {
  return { id, text, created_at: `${ago(createdDaysAgo)}T12:00:00.000Z` }
}

// ==================== HARD MOMENT ====================

test("hard moment: 3 consecutive low/stressed days ending today -> pattern", () => {
  const d = detectHardMoment({
    moods: [mood(2, "low"), mood(1, "stressed"), mood(0, "low")],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.type, "pattern")
  assert.equal(d?.payload.runStart, ago(2))
  assert.equal(d?.payload.runEnd, TODAY)
  assert.equal(d?.payload.runLength, 3)
  assert.deepEqual(d?.payload.moods, ["low", "stressed", "low"])
})

test("hard moment: run ending yesterday counts when today isn't logged yet", () => {
  const d = detectHardMoment({
    moods: [mood(3, "low"), mood(2, "low"), mood(1, "stressed")],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.runEnd, ago(1))
  assert.equal(key(d), `hard_moment:${ago(3)}`)
})

test("hard moment: a longer run reports its full length and first day", () => {
  const d = detectHardMoment({
    moods: [mood(4, "low"), mood(3, "low"), mood(2, "low"), mood(1, "stressed")],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.runLength, 4)
  assert.equal(d?.payload.runStart, ago(4))
})

test("hard moment: threshold is HARD_MOMENT_MIN_DAYS (2 days is not enough)", () => {
  assert.equal(HARD_MOMENT_MIN_DAYS, 3)
  assert.equal(detectHardMoment({ moods: [mood(1, "low"), mood(0, "low")], today: TODAY, existing: [] }), null)
})

test("hard moment: a calendar gap breaks the run", () => {
  const moods = [mood(4, "low"), mood(3, "low"), /* day 2 missing */ mood(1, "low"), mood(0, "low")]
  assert.equal(detectHardMoment({ moods, today: TODAY, existing: [] }), null)
})

test("hard moment: a neutral/good mood in the run breaks it", () => {
  const moods = [mood(3, "low"), mood(2, "meh"), mood(1, "low"), mood(0, "low")]
  assert.equal(detectHardMoment({ moods, today: TODAY, existing: [] }), null)
})

test("hard moment: a good mood logged today ends the run", () => {
  const moods = [mood(3, "low"), mood(2, "low"), mood(1, "low"), mood(0, "great")]
  assert.equal(detectHardMoment({ moods, today: TODAY, existing: [] }), null)
})

test("hard moment: an un-acknowledged pending pattern blocks a new one", () => {
  const moods = [mood(2, "low"), mood(1, "low"), mood(0, "low")]
  const existing = [obs("pattern", { dedupeKey: "hard_moment:2026-01-01" }, false)]
  assert.equal(detectHardMoment({ moods, today: TODAY, existing }), null)
})

test("hard moment: an acknowledged earlier pattern does not block a NEW run", () => {
  const moods = [mood(2, "low"), mood(1, "low"), mood(0, "low")]
  const existing = [obs("pattern", { dedupeKey: "hard_moment:2026-01-01" }, true)]
  assert.equal(key(detectHardMoment({ moods, today: TODAY, existing })), `hard_moment:${ago(2)}`)
})

test("hard moment: a pending non-pattern observation does not block it", () => {
  const moods = [mood(2, "low"), mood(1, "low"), mood(0, "low")]
  const existing = [obs("gap", { dedupeKey: "gap:x" }, false)]
  assert.notEqual(detectHardMoment({ moods, today: TODAY, existing }), null)
})

test("hard moment: an already-recorded low run isn't re-recorded once acknowledged", () => {
  const existing = [obs("pattern", { dedupeKey: `hard_moment:${ago(2)}` }, true)]
  // Same run (still starting ago(2)) seen again -> nothing.
  const sameRun = [mood(2, "low"), mood(1, "low"), mood(0, "low")]
  assert.equal(detectHardMoment({ moods: sameRun, today: TODAY, existing }), null)
  // A run that started earlier is a different run, keyed by its own first day.
  const earlierRun = [mood(3, "low"), mood(2, "low"), mood(1, "low"), mood(0, "low")]
  assert.equal(key(detectHardMoment({ moods: earlierRun, today: TODAY, existing })), `hard_moment:${ago(3)}`)
})

// ==================== GOAL GAP ====================
// Selection itself is now fully delegated to pickGoalToPrompt (goal-
// matching.ts) — the same function weekly-review.ts's own goal question
// calls — so these tests mostly confirm detectGoalGap defers to it
// correctly and layers its OWN extra conditions (age threshold, matchable
// keywords, its own once-ever dedupeKey) on top, rather than re-verifying
// pickGoalToPrompt's own selection logic (covered separately below).
const noCooldown = new Set<string>()

test("shared goal-matching constants weekly-review.ts and Companion both build on", () => {
  assert.equal(GOAL_STALE_WEEKS, 4)
  assert.equal(GOAL_COOLDOWN_WEEKS, 8)
})

test("goal gap: old goal, no matching accepted suggestion -> gap", () => {
  const g = goal("g1", "Meditate every morning", 50)
  const d = detectGoalGap({
    goals: [g],
    acceptedTitlesSinceStale: [{ title: "Take a walk outside" }],
    recentlyPromptedGoalIds: noCooldown,
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.type, "gap")
  assert.equal(d?.payload.goalId, "g1")
  assert.equal(key(d), "gap:g1")
})

test("goal gap: selection reuses pickGoalToPrompt (same result as the shared selector)", () => {
  const goals = [goal("g1", "Meditate every morning", 60), goal("g2", "Practice guitar weekly", 60)]
  const acceptedTitlesSinceStale = [{ title: "Meditate for five minutes" }]
  const shared = pickGoalToPrompt(goals, acceptedTitlesSinceStale, noCooldown)
  assert.equal(shared?.id, "g2")
  assert.equal(
    detectGoalGap({ goals, acceptedTitlesSinceStale, recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] })
      ?.payload.goalId,
    "g2"
  )
})

test("goal gap: a matching accepted title clears the shared pick entirely (null, not just skipped)", () => {
  const g = goal("g1", "Meditate every morning", 90)
  const d = detectGoalGap({
    goals: [g],
    acceptedTitlesSinceStale: [{ title: "Meditate for a few minutes" }],
    recentlyPromptedGoalIds: noCooldown,
    today: TODAY,
    existing: [],
  })
  assert.equal(d, null)
})

test("goal gap: a goal younger than GOAL_GAP_WEEKS is picked by the shared selector but Companion stays silent", () => {
  const g = goal("g1", "Meditate every morning", GOAL_GAP_WEEKS * 7 - 7)
  // Confirm the shared selector itself has no opinion on age (that's
  // Companion's own extra threshold, applied on top, not a second
  // selection pass).
  assert.equal(pickGoalToPrompt([g], [], noCooldown)?.id, "g1")
  assert.equal(
    detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] }),
    null
  )
})

test("goal gap: a goal exactly GOAL_GAP_WEEKS old qualifies", () => {
  const g = goal("g1", "Meditate every morning", GOAL_GAP_WEEKS * 7)
  assert.notEqual(
    detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] }),
    null
  )
})

test("goal gap: once per goal, ever, for Companion's OWN observation — an existing gap blocks it, acknowledged or not", () => {
  const g = goal("g1", "Meditate every morning", 90)
  for (const acknowledged of [false, true]) {
    const existing = [obs("gap", { dedupeKey: "gap:g1" }, acknowledged)]
    assert.equal(
      detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing }),
      null
    )
  }
})

test("goal gap: a gap for another goal doesn't block this one", () => {
  const g = goal("g2", "Meditate every morning", 90)
  const existing = [obs("gap", { dedupeKey: "gap:g1" }, true)]
  assert.equal(
    key(
      detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing })
    ),
    "gap:g2"
  )
})

test("goal gap: a goal with no matchable keywords is never claimed as a gap", () => {
  const g = goal("g1", "Be me", 90)
  assert.equal(
    detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] }),
    null
  )
})

test("goal gap: several qualify -> the oldest goal, same as the shared selector picks", () => {
  const goals = [goal("new", "Learn watercolour painting", 70), goal("old", "Meditate every morning", 200)]
  assert.equal(
    key(
      detectGoalGap({ goals, acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] })
    ),
    "gap:old"
  )
})

test("goal gap: no goals -> null", () => {
  assert.equal(
    detectGoalGap({ goals: [], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] }),
    null
  )
})

// ---- The actual bug this consolidation fixes: shared cooldown state ----

test("goal gap: a goal in recentlyPromptedGoalIds (weekly review already asked about it this cycle) is NEVER picked", () => {
  const g = goal("g1", "Meditate every morning", 90)
  const cooldown = new Set(["g1"])
  assert.equal(
    detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: cooldown, today: TODAY, existing: [] }),
    null
  )
  // Confirm it's specifically the shared cooldown doing this, not some
  // other condition — the exact same goal, same inputs, minus the
  // cooldown, DOES qualify.
  assert.notEqual(
    detectGoalGap({ goals: [g], acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: noCooldown, today: TODAY, existing: [] }),
    null
  )
})

test("goal gap: cooldown on one goal doesn't block a different, older, also-qualifying goal", () => {
  const goals = [goal("asked", "Meditate every morning", 200), goal("not_asked", "Practice guitar weekly", 150)]
  const cooldown = new Set(["asked"])
  assert.equal(
    key(
      detectGoalGap({ goals, acceptedTitlesSinceStale: [], recentlyPromptedGoalIds: cooldown, today: TODAY, existing: [] })
    ),
    "gap:not_asked"
  )
})

// ==================== FIRST TIME ====================

test("first time: first accepted suggestion in a never-touched category -> first_time", () => {
  const d = detectFirstTime({
    accepted: [
      { date: ago(60), category: "physical" },
      { date: ago(2), category: "mindful" },
    ],
    circleActionDates: [],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.type, "first_time")
  assert.equal(d?.payload.trigger, "first_category")
  assert.equal(d?.payload.category, "mindful")
  assert.equal(d?.payload.isVeryFirst, false)
})

test("first time: her very first acceptance overall is flagged isVeryFirst", () => {
  const d = detectFirstTime({
    accepted: [{ date: ago(1), category: "social" }],
    circleActionDates: [],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.category, "social")
  assert.equal(d?.payload.isVeryFirst, true)
})

test("first time: a category already touched earlier is not a first", () => {
  const d = detectFirstTime({
    accepted: [
      { date: ago(40), category: "mindful" },
      { date: ago(1), category: "mindful" },
    ],
    circleActionDates: [],
    today: TODAY,
    existing: [],
  })
  assert.equal(d, null)
})

test("first time: a first older than the lookback isn't announced retroactively", () => {
  const d = detectFirstTime({
    accepted: [{ date: ago(FIRST_TIME_LOOKBACK_DAYS + 1), category: "creative" }],
    circleActionDates: [],
    today: TODAY,
    existing: [],
  })
  assert.equal(d, null)
})

test("first time: the same category isn't recorded twice", () => {
  const d = detectFirstTime({
    accepted: [{ date: ago(1), category: "novelty" }],
    circleActionDates: [],
    today: TODAY,
    existing: [obs("first_time", { dedupeKey: "category:novelty" }, true)],
  })
  assert.equal(d, null)
})

test("first time: the most recent of several new categories wins", () => {
  const d = detectFirstTime({
    accepted: [
      { date: ago(5), category: "rest" },
      { date: ago(1), category: "creative" },
    ],
    circleActionDates: [],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.category, "creative")
})

test("first time: Circle return after >= 60 days away -> first_time", () => {
  const d = detectFirstTime({
    accepted: [],
    circleActionDates: [ago(2), ago(2 + 110)],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.trigger, "circle_return")
  assert.equal(d?.payload.returnDate, ago(2))
  assert.equal(d?.payload.absenceDays, 110)
  assert.equal(key(d), `circle_return:${ago(2)}`)
})

test("first time: Circle absence threshold is exactly CIRCLE_RETURN_ABSENCE_DAYS", () => {
  const at = (gap: number) =>
    detectFirstTime({ accepted: [], circleActionDates: [ago(1), ago(1 + gap)], today: TODAY, existing: [] })
  assert.equal(CIRCLE_RETURN_ABSENCE_DAYS, 60)
  assert.notEqual(at(60), null)
  assert.equal(at(59), null)
})

test("first time: no previous Circle action means first use, not a return", () => {
  assert.equal(detectFirstTime({ accepted: [], circleActionDates: [ago(1)], today: TODAY, existing: [] }), null)
  assert.equal(detectFirstTime({ accepted: [], circleActionDates: [], today: TODAY, existing: [] }), null)
})

test("first time: a return older than the lookback is ignored", () => {
  const d = detectFirstTime({
    accepted: [],
    circleActionDates: [ago(FIRST_TIME_LOOKBACK_DAYS + 3), ago(FIRST_TIME_LOOKBACK_DAYS + 3 + 90)],
    today: TODAY,
    existing: [],
  })
  assert.equal(d, null)
})

test("first time: a return followed by another action the next day is still found", () => {
  const d = detectFirstTime({
    accepted: [],
    circleActionDates: [ago(1), ago(2), ago(2 + 100)],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.returnDate, ago(2))
})

test("first time: several actions on the return day count as one", () => {
  const d = detectFirstTime({
    accepted: [],
    circleActionDates: [ago(2), ago(2), ago(2), ago(2 + 100)],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.absenceDays, 100)
})

test("first time: the same Circle return isn't recorded twice", () => {
  const d = detectFirstTime({
    accepted: [],
    circleActionDates: [ago(2), ago(2 + 100)],
    today: TODAY,
    existing: [obs("first_time", { dedupeKey: `circle_return:${ago(2)}` }, false)],
  })
  assert.equal(d, null)
})

test("first time: a same-day category first wins over a Circle return", () => {
  const d = detectFirstTime({
    accepted: [{ date: ago(2), category: "rest" }],
    circleActionDates: [ago(2), ago(2 + 100)],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.trigger, "first_category")
})

test("first time: an older category first yields to a newer Circle return", () => {
  const d = detectFirstTime({
    accepted: [{ date: ago(5), category: "rest" }],
    circleActionDates: [ago(1), ago(1 + 100)],
    today: TODAY,
    existing: [],
  })
  assert.equal(d?.payload.trigger, "circle_return")
})

test("resolveAcceptedCategories: by id, by own title, by static title (both languages), drops unknowns", () => {
  const out = resolveAcceptedCategories(
    [
      { date: "2026-09-01", text: "anything", sourceMoveItemId: "m1" },
      { date: "2026-09-02", text: "  Call A Friend ", sourceMoveItemId: null },
      { date: "2026-09-03", text: "Tembea kidogo", sourceMoveItemId: null },
      { date: "2026-09-04", text: "Not in any pool", sourceMoveItemId: null },
      { date: "2026-09-05", text: "Take a walk", sourceMoveItemId: "deleted-row" },
    ],
    [
      { id: "m1", title: "Something", category: "creative" },
      { id: "m2", title: "call a friend", category: "social" },
    ],
    [
      { title: "Take a walk", category: "physical" },
      { title: "Tembea kidogo", category: "physical" },
    ]
  )
  assert.deepEqual(out, [
    { date: "2026-09-01", category: "creative" },
    { date: "2026-09-02", category: "social" },
    { date: "2026-09-03", category: "physical" },
    // id no longer exists -> falls back to the title match.
    { date: "2026-09-05", category: "physical" },
  ])
})

test("resolveAcceptedCategories: her own row overrides a static entry with the same title", () => {
  const out = resolveAcceptedCategories(
    [{ date: "2026-09-01", text: "Take a walk", sourceMoveItemId: null }],
    [{ id: "m1", title: "Take a walk", category: "mindful" }],
    [{ title: "Take a walk", category: "physical" }]
  )
  assert.deepEqual(out, [{ date: "2026-09-01", category: "mindful" }])
})

// ==================== CELEBRATION ====================

test("celebration: thresholds are the app's existing anchor-streak milestones", () => {
  assert.deepEqual([...ANCHOR_STREAK_MILESTONES], [7, 14, 21, 30])
  for (const m of ANCHOR_STREAK_MILESTONES) {
    const d = detectCelebration({ currentAnchorStreak: m, existing: [] })
    assert.equal(d?.type, "celebration")
    assert.equal(d?.payload.milestone, m)
  }
})

test("celebration: below the first milestone -> null", () => {
  for (const s of [0, 1, 6]) assert.equal(detectCelebration({ currentAnchorStreak: s, existing: [] }), null)
})

test("celebration: between milestones -> the highest one reached (not missed)", () => {
  assert.equal(detectCelebration({ currentAnchorStreak: 9, existing: [] })?.payload.milestone, 7)
  assert.equal(detectCelebration({ currentAnchorStreak: 25, existing: [] })?.payload.milestone, 21)
  assert.equal(detectCelebration({ currentAnchorStreak: 45, existing: [] })?.payload.milestone, 30)
})

test("celebration: once per milestone ever", () => {
  const existing = [obs("celebration", { dedupeKey: "anchor_streak:7" }, true)]
  assert.equal(detectCelebration({ currentAnchorStreak: 7, existing }), null)
  assert.equal(detectCelebration({ currentAnchorStreak: 9, existing }), null)
})

test("celebration: reaching the next milestone still fires", () => {
  const existing = [obs("celebration", { dedupeKey: "anchor_streak:7" }, true)]
  assert.equal(detectCelebration({ currentAnchorStreak: 14, existing })?.payload.milestone, 14)
})

// ==================== IDEMPOTENCY (detect -> store -> detect) ====================

test("no duplicates: a second pass over everything already detected yields nothing", () => {
  const moods = [mood(2, "low"), mood(1, "stressed"), mood(0, "low")]
  const goals = [goal("g1", "Meditate every morning", 80)]
  const accepted = [
    { date: ago(50), category: "physical" as const },
    { date: ago(2), category: "mindful" as const },
  ]
  const acceptedTitles = [{ date: ago(50), title: "Take a walk" }]
  const circleActionDates = [ago(1), ago(1 + 100)]

  const store: ExistingObservation[] = []
  const pass = () => {
    const drafts = [
      detectHardMoment({ moods, today: TODAY, existing: store }),
      detectGoalGap({
        goals,
        acceptedTitlesSinceStale: acceptedTitles,
        recentlyPromptedGoalIds: noCooldown,
        today: TODAY,
        existing: store,
      }),
      detectFirstTime({ accepted, circleActionDates, today: TODAY, existing: store }),
      detectCelebration({ currentAnchorStreak: 15, existing: store }),
    ].filter((d): d is CompanionObservationDraft => d !== null)
    // Same rule the DB enforces: dedupeKey unique per user.
    const inserted = drafts.filter((d) => !store.some((o) => o.payload.dedupeKey === d.payload.dedupeKey))
    for (const d of inserted) store.push({ type: d.type, payload: d.payload, acknowledged: false })
    return inserted.map((d) => d.payload.dedupeKey)
  }

  const first = pass()
  assert.equal(first.length, 4, `expected 4 first-pass observations, got ${JSON.stringify(first)}`)
  // detectFirstTime returns one event per call by design: the newer Circle
  // return went first, the older "mindful" category first surfaces on the
  // next pass — and only once.
  assert.deepEqual(first.filter((k) => String(k).startsWith("circle_return:")).length, 1)
  assert.deepEqual(pass(), ["category:mindful"])
  assert.deepEqual(pass(), [])
  assert.deepEqual(pass(), [])
})

test("no duplicates: after the pattern is acknowledged, the same low run still isn't re-recorded", () => {
  const moods = [mood(2, "low"), mood(1, "low"), mood(0, "low")]
  const store: ExistingObservation[] = []
  const d = detectHardMoment({ moods, today: TODAY, existing: store })
  assert.notEqual(d, null)
  store.push({ type: d!.type, payload: d!.payload, acknowledged: false })
  assert.equal(detectHardMoment({ moods, today: TODAY, existing: store }), null) // pending
  store[0].acknowledged = true
  assert.equal(detectHardMoment({ moods, today: TODAY, existing: store }), null) // resolved, same run
})

console.log(`${passed} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
console.log("✓ All companion trigger fixtures behave as specified.")
