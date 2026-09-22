// End-to-end check of src/lib/companion-generation.ts (the fetch ->
// safety-filter -> generate -> store pass) against an in-memory fake of
// supabase/compass/i18n/offline-sync and a mocked global fetch. The module
// can't be imported under plain tsx (src/lib/supabase.ts reads
// import.meta.env at load), so this bundles it with esbuild — same approach
// as check-companion-detection.mjs. The one thing this file exists to prove
// beyond doubt: a distress-signal fixture NEVER reaches the network — not
// "produces the safe fallback text" (checked too), but literally zero calls
// to fetch. Also covers the weekly_reviews.companion_text consolidation
// (formerly companion_weekly_checkins): tenure gate, current-week-only
// pickup, and the anchoring facts (summary_snapshot) sent instead of raw
// Compass data. Run with `npm run check-companion-generation`.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// ---- fake modules (source text, loaded by the esbuild plugin below) ----
const FAKE_SOURCE = `
const db = (globalThis.__companionGenFakeDb ??= { tables: {}, calls: [], compassByUser: {} })

function builder(name) {
  let op = "select", payload = null
  const filters = []
  let orderCol = null, orderAsc = true, limitN = null, single = false
  const api = {
    select() { return api },
    insert(row) { op = "insert"; payload = row; return api },
    update(row) { op = "update"; payload = row; return api },
    eq(c, v) { filters.push((r) => r[c] === v); return api },
    gte(c, v) { filters.push((r) => r[c] >= v); return api },
    is(c, v) { filters.push((r) => (r[c] ?? null) === v); return api },
    order(c, opts) { orderCol = c; orderAsc = !(opts && opts.ascending === false); return api },
    limit(n) { limitN = n; return api },
    maybeSingle() { single = true; return api },
    then(resolve) {
      db.calls.push(op + ":" + name)
      const table = (db.tables[name] ??= [])
      if (op === "insert") {
        table.push({ ...payload })
        return resolve({ data: null, error: null })
      }
      if (op === "update") {
        for (const row of table) {
          if (filters.every((f) => f(row))) Object.assign(row, payload)
        }
        return resolve({ data: null, error: null })
      }
      let rows = table.filter((r) => filters.every((f) => f(r)))
      if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] < b[orderCol] ? -1 : a[orderCol] > b[orderCol] ? 1 : 0) * (orderAsc ? 1 : -1))
      if (limitN != null) rows = rows.slice(0, limitN)
      if (single) return resolve({ data: rows[0] ?? null, error: null })
      return resolve({ data: rows, error: null })
    },
  }
  return api
}
export const supabase = {
  from: (n) => { db.calls.push("from:" + n); return builder(n) },
  auth: { getSession: async () => ({ data: { session: null } }) },
}
export default { language: "en", getFixedT: () => (k) => k }
export const isOnline = () => true
export const getCompass = async (userId) => { db.calls.push("getCompass"); return db.compassByUser[userId] ?? null }
`
const FAKED = new Set(["supabase", "i18n", "compass", "offline-sync"])

const workDir = mkdtempSync(path.join(tmpdir(), "companion-generation-check-"))
const outfile = path.join(workDir, "bundle.mjs")
try {
  await build({
    entryPoints: [path.join(repoRoot, "src/lib/companion-generation.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    define: { "import.meta.env": "{}" },
    logLevel: "error",
    plugins: [
      {
        name: "repo-alias-and-fakes",
        setup(b) {
          b.onResolve({ filter: /^@\// }, (args) => {
            const rel = args.path.slice(2)
            const fake = rel.match(/^lib\/(.+)$/)
            if (fake && FAKED.has(fake[1])) return { path: "fakes", namespace: "fake" }
            for (const ext of [".ts", ".tsx", "/index.ts"]) {
              const candidate = path.join(repoRoot, "src", rel + ext)
              if (existsSync(candidate)) return { path: candidate }
            }
          })
          b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: FAKE_SOURCE, loader: "js" }))
        },
      },
    ],
  })

  // ---- browser/global stand-ins ----
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  let fetchCalls = []
  let fetchImpl = async () => ({ ok: true, json: async () => ({ message: "MOCK GENERATED TEXT" }) })
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts })
    return fetchImpl(url, opts)
  }

  const { runCompanionObservationGeneration, runCompanionObservationGenerationOncePerDay } = await import(
    pathToFileURL(outfile).href
  )
  const db = globalThis.__companionGenFakeDb

  const rowsIn = (name) => db.tables[name] ?? []
  const dayFlag = (uid) => store.get(`anchor_companion_generation_ran_${uid}`)

  // ---- date/week helpers (small, deliberate duplication of week-dates.ts's
  // weekStartStr — this file runs under plain node, not tsx, so it can't
  // import the real .ts module; same reasoning as mondayOfSunday in
  // check-companion-detection.mjs) ----
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  function weekStartStr(date) {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    const day = d.getDay()
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
    return fmt(d)
  }
  const FIXED_NOW = new Date("2026-09-22T09:00:00")
  const CURRENT_WEEK_START = weekStartStr(FIXED_NOW)
  const daysBefore = (n) => new Date(FIXED_NOW.getTime() - n * 86400000).toISOString()
  const TENURE_OK = daysBefore(30) // >= WEEKLY_CHECKIN_MIN_TENURE_DAYS (21)
  const TENURE_TOO_YOUNG = daysBefore(5)

  function seed(uid, { observations = [], weeklyReview = null, journal = [], gratitude = [], compass = null } = {}) {
    db.tables.companion_observations = observations.map((o) => ({ user_id: uid, generated_text: null, ...o }))
    db.tables.weekly_reviews = weeklyReview
      ? [
          {
            user_id: uid,
            week_start: CURRENT_WEEK_START,
            companion_text: null,
            summary_snapshot: { weekStart: CURRENT_WEEK_START, weekEnd: "2026-09-27", acceptedCount: 0, declinedCount: 0, dominantValues: null, goalPromptedText: null },
            ...weeklyReview,
          },
        ]
      : []
    db.tables.journal_entries = journal.map((j) => ({ user_id: uid, ...j }))
    db.tables.gratitudes = gratitude.map((g) => ({ user_id: uid, ...g }))
    db.compassByUser[uid] = compass
    db.calls = []
    fetchCalls = []
  }

  const subject = (userId, aiEnabled, language, profileCreatedAt = TENURE_OK) => ({
    userId,
    aiEnabled,
    language,
    profileCreatedAt,
  })

  let count = 0
  const ok = (name) => console.log(`ok   ${++count}. ${name}`)

  const PATTERN_OBS = (uid, id = "o1") => ({
    id,
    type: "pattern",
    payload: { trigger: "hard_moment", dedupeKey: `hard_moment:x:${id}`, runStart: "2026-09-18", runEnd: "2026-09-20", runLength: 3 },
  })
  const GAP_OBS = (uid, id = "o2") => ({
    id,
    type: "gap",
    payload: { trigger: "goal_gap", dedupeKey: `gap:g1:${id}`, goalId: "g1", goalText: "Meditate every morning", weeks: 6 },
  })

  // ================= AI toggle guard =================

  seed("off1", { observations: [PATTERN_OBS("off1")] })
  const off = await runCompanionObservationGeneration(subject("off1", false, "en"), FIXED_NOW)
  assert.deepEqual(off, { generated: 0, safetyFallbackUsed: false })
  assert.equal(db.calls.length, 0)
  assert.equal(fetchCalls.length, 0)
  ok("toggle OFF: zero DB calls, zero fetch calls")

  // ================= Nothing pending (no observations, no weekly_reviews row) =================

  seed("empty1")
  const empty = await runCompanionObservationGeneration(subject("empty1", true, "en"), FIXED_NOW)
  assert.deepEqual(empty, { generated: 0, safetyFallbackUsed: false })
  assert.equal(fetchCalls.length, 0)
  ok("nothing pending: zero fetch calls, no error")

  // ================= DISTRESS SIGNAL: must NEVER call the network =================

  seed("distress1", {
    observations: [PATTERN_OBS("distress1"), GAP_OBS("distress1")],
    weeklyReview: { id: "w1" },
    journal: [
      { date: "2026-09-19", sentence: "had a fine day" },
      { date: "2026-09-20", sentence: "I want to kill myself" },
    ],
    gratitude: [{ text: "my dog", created_at: "2026-09-20T10:00:00Z" }],
  })
  const distressResult = await runCompanionObservationGeneration(subject("distress1", true, "en"), FIXED_NOW)
  assert.equal(fetchCalls.length, 0, `expected 0 fetch calls, got ${fetchCalls.length}: ${JSON.stringify(fetchCalls)}`)
  assert.equal(distressResult.safetyFallbackUsed, true)
  assert.equal(distressResult.generated, 3) // 2 observations + 1 weekly_reviews row
  const distressObs = rowsIn("companion_observations")
  assert.ok(distressObs.every((o) => o.generated_text && o.generated_text.includes("https://findahelpline.com")))
  assert.ok(!distressObs.some((o) => o.generated_text === "MOCK GENERATED TEXT"))
  assert.ok(rowsIn("weekly_reviews")[0].companion_text.includes("https://findahelpline.com"))
  ok("distress signal in Journal: ZERO network calls, every pending row (observations AND weekly_reviews) gets the fixed safety text")

  // Same, but the signal is in the Jar/gratitude entries instead of Journal.
  seed("distress2", {
    observations: [PATTERN_OBS("distress2")],
    gratitude: [{ text: "grateful for my sister", created_at: "2026-09-20T10:00:00Z" }, { text: "I wish I didn't exist", created_at: "2026-09-21T10:00:00Z" }],
  })
  const distressResult2 = await runCompanionObservationGeneration(subject("distress2", true, "sw"), FIXED_NOW)
  assert.equal(fetchCalls.length, 0)
  assert.equal(rowsIn("companion_observations")[0].generated_text, "Hii inaonekana nzito kuliko ninavyoweza kuishughulikia vizuri kupitia ujumbe. Tafadhali wasiliana na mtu halisi sasa hivi — https://findahelpline.com ina msaada wa bure na wa siri, mchana na usiku, katika nchi nyingi. Huhitaji kubeba hili peke yako.")
  ok("distress signal in Jar entries: also zero network calls, correct-language fixed text stored")

  // ================= NORMAL PATH: no distress -> model IS called, weekly_reviews gets summary_snapshot facts =================

  seed("normal1", {
    observations: [PATTERN_OBS("normal1"), GAP_OBS("normal1")],
    weeklyReview: {
      id: "w2",
      summary_snapshot: {
        weekStart: CURRENT_WEEK_START,
        weekEnd: "2026-09-27",
        acceptedCount: 4,
        declinedCount: 1,
        dominantValues: ["Growth"],
        goalPromptedText: "Meditate every morning",
      },
    },
    journal: [{ date: "2026-09-20", sentence: "a calm, ordinary day" }],
    gratitude: [{ text: "morning coffee", created_at: "2026-09-20T10:00:00Z" }],
    compass: { value_tags: ["Growth", "Peace"], goals: [{ id: "g1", text: "Meditate every morning", created_at: "2026-01-01" }] },
  })
  const normalResult = await runCompanionObservationGeneration(subject("normal1", true, "en"), FIXED_NOW)
  assert.equal(fetchCalls.length, 3) // 2 observations + 1 weekly_reviews row
  assert.equal(normalResult.generated, 3)
  assert.equal(normalResult.safetyFallbackUsed, false)
  assert.ok(rowsIn("companion_observations").every((o) => o.generated_text === "MOCK GENERATED TEXT"))
  assert.equal(rowsIn("weekly_reviews")[0].companion_text, "MOCK GENERATED TEXT")

  const bodies = fetchCalls.map((c) => JSON.parse(c.opts.body))
  const obsCallBody = bodies.find((b) => b.observationType === "pattern")
  assert.equal(obsCallBody.type, "companion_observation")
  assert.deepEqual(obsCallBody.compassValues, ["Growth", "Peace"]) // observations still get the raw Compass list
  const weeklyCallBody = bodies.find((b) => b.observationType === "weekly_checkin")
  assert.ok(weeklyCallBody, `expected a weekly_checkin call, got types: ${bodies.map((b) => b.observationType)}`)
  // The consolidation's core point: summary_snapshot facts, not raw Compass data.
  assert.equal(weeklyCallBody.payload.acceptedCount, 4)
  assert.equal(weeklyCallBody.payload.declinedCount, 1)
  assert.deepEqual(weeklyCallBody.payload.dominantValues, ["Growth"])
  assert.equal(weeklyCallBody.payload.goalPromptedText, "Meditate every morning")
  assert.deepEqual(weeklyCallBody.compassValues, [])
  assert.deepEqual(weeklyCallBody.compassGoals, [])
  ok("no distress signal: model called per pending row; weekly_checkin call carries summary_snapshot facts, not raw value_tags")

  // ================= TENURE GATE: too young for the weekly enrichment (observations unaffected) =================

  seed("young1", {
    observations: [PATTERN_OBS("young1")],
    weeklyReview: { id: "w4" },
  })
  const youngResult = await runCompanionObservationGeneration(subject("young1", true, "en", TENURE_TOO_YOUNG), FIXED_NOW)
  assert.equal(youngResult.generated, 1) // the observation only
  assert.equal(rowsIn("weekly_reviews")[0].companion_text, null)
  const youngBodies = fetchCalls.map((c) => JSON.parse(c.opts.body))
  assert.ok(!youngBodies.some((b) => b.observationType === "weekly_checkin"), "no weekly_checkin call should fire under the tenure bar")
  ok("account younger than WEEKLY_CHECKIN_MIN_TENURE_DAYS: weekly_reviews query skipped entirely, observations still generate normally")

  // ================= A weekly_reviews row for a DIFFERENT week is never picked up =================

  seed("otherweek1", { weeklyReview: { id: "w5", week_start: "2020-01-06" } })
  const otherWeekResult = await runCompanionObservationGeneration(subject("otherweek1", true, "en"), FIXED_NOW)
  assert.deepEqual(otherWeekResult, { generated: 0, safetyFallbackUsed: false })
  assert.equal(fetchCalls.length, 0)
  assert.equal(rowsIn("weekly_reviews")[0].companion_text, null)
  ok("a weekly_reviews row that isn't for the current week is never queried/generated")

  // ================= A weekly_reviews row that already has companion_text is never re-sent =================

  seed("wskip1", { weeklyReview: { id: "w6", companion_text: "already there" } })
  const wSkipResult = await runCompanionObservationGeneration(subject("wskip1", true, "en"), FIXED_NOW)
  assert.deepEqual(wSkipResult, { generated: 0, safetyFallbackUsed: false })
  assert.equal(fetchCalls.length, 0)
  assert.equal(rowsIn("weekly_reviews")[0].companion_text, "already there")
  ok("a weekly_reviews row with companion_text already set is excluded from the query (never re-generated)")

  // ================= SWAHILI GATE: disabled in prod, treated like a missing API key (both observations AND weekly) =================

  seed("sw1", {
    observations: [PATTERN_OBS("sw1"), GAP_OBS("sw1")],
    weeklyReview: { id: "w3" },
    journal: [{ date: "2026-09-20", sentence: "siku ya kawaida" }],
    compass: { value_tags: ["Amani"], goals: [] },
  })
  const swResult = await runCompanionObservationGeneration(subject("sw1", true, "sw"), FIXED_NOW)
  assert.equal(fetchCalls.length, 0, `expected 0 fetch calls for a Swahili user, got ${fetchCalls.length}`)
  assert.equal(swResult.generated, 0)
  assert.equal(swResult.safetyFallbackUsed, false) // no distress here — this is the language gate, not the safety gate
  assert.ok(rowsIn("companion_observations").every((o) => o.generated_text === null))
  assert.equal(rowsIn("weekly_reviews")[0].companion_text, null)
  ok("preferred_language=sw, no distress: ZERO network calls, rows stay NULL for retry (same shape as a missing API key)")

  // Same account, English: must work completely normally (nothing else regressed).
  seed("en2", {
    observations: [PATTERN_OBS("en2")],
    journal: [{ date: "2026-09-20", sentence: "an ordinary day" }],
    compass: { value_tags: ["Peace"], goals: [] },
  })
  const enResult = await runCompanionObservationGeneration(subject("en2", true, "en"), FIXED_NOW)
  assert.equal(fetchCalls.length, 1)
  assert.equal(enResult.generated, 1)
  assert.equal(rowsIn("companion_observations")[0].generated_text, "MOCK GENERATED TEXT")
  ok("preferred_language=en: unaffected, generates normally (1 fetch call, text stored)")

  // ================= Already-generated observation rows are never re-sent =================

  seed("skip1", {
    observations: [{ ...PATTERN_OBS("skip1"), generated_text: "already there" }],
  })
  const skipResult = await runCompanionObservationGeneration(subject("skip1", true, "en"), FIXED_NOW)
  assert.equal(fetchCalls.length, 0)
  assert.equal(skipResult.generated, 0)
  ok("an observation row with generated_text already set is excluded from the query (never re-generated)")

  // ================= A failed model call leaves the row for next session =================

  seed("fail1", { observations: [PATTERN_OBS("fail1")] })
  fetchImpl = async () => ({ ok: false })
  const failResult = await runCompanionObservationGeneration(subject("fail1", true, "en"), FIXED_NOW)
  assert.equal(failResult.generated, 0)
  assert.equal(rowsIn("companion_observations")[0].generated_text, null)
  fetchImpl = async () => ({ ok: true, json: async () => ({ message: "MOCK GENERATED TEXT" }) })
  ok("Anthropic call failure (non-2xx): no throw, row left NULL for retry, rest of Home unaffected")

  // ================= Once-per-day guard =================

  seed("day1", { observations: [PATTERN_OBS("day1")] })
  const r1 = await runCompanionObservationGenerationOncePerDay(subject("day1", true, "en"), FIXED_NOW)
  assert.equal(r1.generated, 1)
  assert.equal(dayFlag("day1"), JSON.stringify("2026-09-22"))
  const callsAfterFirst = fetchCalls.length
  const r2 = await runCompanionObservationGenerationOncePerDay(subject("day1", true, "en"), FIXED_NOW)
  assert.equal(r2, null)
  assert.equal(fetchCalls.length, callsAfterFirst)
  ok("once-per-day guard: a second call the same day is a no-op, zero extra network calls")

  console.log(`\nall ${count} companion-generation checks passed`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
