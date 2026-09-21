// End-to-end check of src/lib/companion-detection.ts (the fetch -> detect ->
// insert orchestrator) against an in-memory fake of supabase and of the
// Circle/Compass/i18n modules it calls. The orchestrator can't be imported
// under plain tsx (src/lib/supabase.ts reads import.meta.env at load), so
// this bundles it with esbuild — already installed as a dependency of vite
// and tsx — swapping those few modules for the fakes below and leaving
// everything else (the real detectors, streaks, move-selection, ...) as is.
// Run with `npm run check-companion-detection`.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// ---- fake modules (source text, loaded by the esbuild plugin below) ----
const FAKE_SOURCE = `
const db = (globalThis.__companionFakeDb ??= { tables: {}, calls: [], failReads: false, goals: [], circle: [] })

function builder(name) {
  let op = "select", payload = null
  const filters = []
  const api = {
    select() { return api },
    insert(row) { op = "insert"; payload = row; return api },
    eq(c, v) { filters.push((r) => r[c] === v); return api },
    gte(c, v) { filters.push((r) => r[c] >= v); return api },
    then(resolve) {
      db.calls.push(op + ":" + name)
      const table = (db.tables[name] ??= [])
      const violation = { data: null, error: { code: "23505", message: "unique violation" } }
      if (op === "insert") {
        // Mirrors the unique indexes in the companion migration.
        if (name === "companion_observations") {
          const dup = table.some((r) => r.user_id === payload.user_id && r.payload.dedupeKey === payload.payload.dedupeKey)
          const pending = payload.type === "pattern" &&
            table.some((r) => r.user_id === payload.user_id && r.type === "pattern" && !r.acknowledged)
          if (dup || pending) return resolve(violation)
          table.push({ acknowledged: false, shown_at: null, user_response: null, ...payload })
        } else if (name === "companion_weekly_checkins") {
          if (table.some((r) => r.user_id === payload.user_id && r.week_start === payload.week_start)) return resolve(violation)
          table.push({ ...payload })
        } else table.push({ ...payload })
        return resolve({ data: null, error: null })
      }
      if (db.failReads) return resolve({ data: null, error: { code: "XX000", message: "read failed" } })
      return resolve({ data: table.filter((r) => filters.every((f) => f(r))), error: null })
    },
  }
  return api
}
export const supabase = { from: (n) => { db.calls.push("from:" + n); return builder(n) } }
export default { getFixedT: () => (k) => k }
export const getCompass = async () => { db.calls.push("getCompass"); return { goals: db.goals } }
export const listSentEncouragements = async () => { db.calls.push("rpc:encouragements"); return db.circle.map((created_at) => ({ created_at })) }
export const listSentVoiceEncouragements = async () => { db.calls.push("rpc:voice"); return [] }
export const listOwnSosHistory = async () => { db.calls.push("rpc:sos"); return [] }
`
const FAKED = new Set(["supabase", "i18n", "compass", "circle", "circle-voice", "circle-sos"])

const workDir = mkdtempSync(path.join(tmpdir(), "companion-detection-check-"))
const outfile = path.join(workDir, "bundle.mjs")
try {
  await build({
    entryPoints: [path.join(repoRoot, "src/lib/companion-detection.ts")],
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

  // ---- browser globals the orchestrator touches ----
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const { runCompanionDetection, runCompanionDetectionOncePerDay } = await import(pathToFileURL(outfile).href)
  const db = globalThis.__companionFakeDb

  // ---- fixtures ----
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const NOW = new Date()
  const daysAgo = (n) => {
    const d = new Date(NOW)
    d.setDate(d.getDate() - n)
    return d
  }
  const ago = (n) => fmt(daysAgo(n))
  const relativeTo = (base, n) => {
    const d = new Date(base)
    d.setDate(d.getDate() - n)
    return d
  }
  const CREATED_60_DAYS_AGO = daysAgo(60).toISOString()
  const sundayOnOrAfter = (d) => {
    const s = new Date(d)
    s.setDate(s.getDate() + ((7 - s.getDay()) % 7))
    s.setHours(10, 0, 0, 0)
    return s
  }

  // Data that trips ALL four detectors (and, on a Sunday, the weekly row):
  // 3 low moods -> hard moment; a 90-day-old Compass goal nothing matches ->
  // goal gap; a Circle return after 100 days + a first accepted "social"
  // suggestion -> first_time; an 8-day complete anchor streak -> celebration.
  // Everything is dated relative to `base` (the "now" the run is given) —
  // except the anchors: calculateStreaks reads the real clock, so those stay
  // relative to the real today.
  function seed(uid, base = NOW) {
    db.tables = {}
    db.calls = []
    db.failReads = false
    const t = (n) => (db.tables[n] ??= [])
    for (const n of [2, 1, 0]) {
      t("mood_logs").push({ user_id: uid, date: fmt(relativeTo(base, n)), mood: n === 1 ? "stressed" : "low", timestamp: relativeTo(base, n).toISOString() })
    }
    for (let n = 1; n <= 8; n++) {
      t("daily_anchors").push({
        user_id: uid, date: ago(n), future_completed: true, mindbody_completed: true, life_completed: true,
        soft_mode_day: false, daily_intention: "", created_at: daysAgo(n).toISOString(),
      })
    }
    t("daily_suggestions").push({ user_id: uid, status: "accepted", date: fmt(relativeTo(base, 50)), suggestion_text: "move.default.walk", source_move_item_id: null })
    t("daily_suggestions").push({ user_id: uid, status: "accepted", date: fmt(relativeTo(base, 2)), suggestion_text: "move.default.text_someone", source_move_item_id: null })
    db.goals = [{ id: "g1", text: "Meditate every morning", created_at: relativeTo(base, 90).toISOString() }]
    db.circle = [relativeTo(base, 1).toISOString(), relativeTo(base, 101).toISOString()]
  }
  const subject = (userId, aiEnabled) => ({ userId, profileCreatedAt: CREATED_60_DAYS_AGO, aiEnabled })
  const rowsIn = (name) => db.tables[name] ?? []
  const insertsIn = (name) => db.calls.filter((c) => c === `insert:${name}`).length
  const dayFlag = (uid) => store.get(`anchor_companion_detection_ran_${uid}`)

  let count = 0
  const ok = (name) => console.log(`ok   ${++count}. ${name}`)

  // ================= AI toggle guard =================

  // 0. Control: the same data with the toggle ON really does trigger everything
  // — otherwise the "off" assertions below would pass for the wrong reason.
  const sunday = sundayOnOrAfter(NOW)
  seed("ctl", sunday)
  const control = await runCompanionDetection(subject("ctl", true), sunday)
  assert.equal(control.observationsCreated.length, 4, JSON.stringify(control))
  assert.equal(control.weeklyCheckinCreated, true)
  assert.equal(rowsIn("companion_observations").length, 4)
  assert.equal(rowsIn("companion_weekly_checkins").length, 1)
  ok("control: toggle ON with this data stores 4 observations + the Sunday weekly row")

  // 1. Toggle OFF, same data, orchestrator entry point: nothing at all.
  seed("off1", sunday)
  const off = await runCompanionDetection(subject("off1", false), sunday)
  assert.deepEqual(off, { observationsCreated: [], weeklyCheckinCreated: false })
  assert.equal(rowsIn("companion_observations").length, 0)
  assert.equal(rowsIn("companion_weekly_checkins").length, 0)
  assert.equal(db.calls.length, 0, `expected zero calls, got ${JSON.stringify(db.calls)}`)
  ok("toggle OFF (same triggering data, Sunday, 60-day account): 0 observations, 0 weekly rows, 0 network calls")

  // 2. Toggle OFF through the once-per-day entry point the hook calls.
  seed("off2", sunday)
  assert.equal(await runCompanionDetectionOncePerDay(subject("off2", false), sunday), null)
  assert.equal(insertsIn("companion_observations") + insertsIn("companion_weekly_checkins"), 0)
  assert.equal(db.calls.length, 0)
  assert.equal(rowsIn("companion_observations").length + rowsIn("companion_weekly_checkins").length, 0)
  ok("toggle OFF via runCompanionDetectionOncePerDay: returns null, zero calls, zero rows")

  // 3. A skipped run must not burn today's slot: enabling later the same day still runs.
  assert.equal(dayFlag("off2"), undefined)
  const enabledLater = await runCompanionDetectionOncePerDay(subject("off2", true), sunday)
  assert.equal(enabledLater.observationsCreated.length, 4)
  assert.equal(enabledLater.weeklyCheckinCreated, true)
  assert.equal(dayFlag("off2"), JSON.stringify(fmt(sunday)))
  ok("toggle off -> on the same day: the skipped run didn't consume the day; detection then runs and stores")

  // 4. Repeated OFF calls stay inert (no per-render leakage).
  seed("off3", sunday)
  for (let i = 0; i < 5; i++) await runCompanionDetectionOncePerDay(subject("off3", false), sunday)
  assert.equal(db.calls.length, 0)
  assert.equal(dayFlag("off3"), undefined)
  ok("5 repeated calls while OFF: still zero calls, no day flag written")

  // 5. Turning it OFF later: nothing new is stored, what was already stored stays.
  seed("off4")
  await runCompanionDetection(subject("off4", true), NOW)
  const storedWhileOn = rowsIn("companion_observations").length
  assert.ok(storedWhileOn > 0)
  db.calls = []
  db.tables.mood_logs.push({ user_id: "off4", date: ago(3), mood: "low", timestamp: daysAgo(3).toISOString() })
  const tomorrow = new Date(NOW)
  tomorrow.setDate(tomorrow.getDate() + 1)
  await runCompanionDetectionOncePerDay(subject("off4", false), tomorrow)
  assert.equal(db.calls.length, 0)
  assert.equal(rowsIn("companion_observations").length, storedWhileOn)
  ok("toggle switched OFF after a run: later days add nothing and existing rows are untouched")

  // 6. The guard is strict: only a literal true enables it.
  seed("off5", sunday)
  for (const falsy of [false, undefined, null, 0, ""]) {
    await runCompanionDetection({ userId: "off5", profileCreatedAt: CREATED_60_DAYS_AGO, aiEnabled: falsy }, sunday)
  }
  assert.equal(db.calls.length, 0)
  ok("falsy aiEnabled values (false/undefined/null/0/'') are all treated as OFF")

  // ================= Regression: behavior with the toggle ON =================

  seed("U1")
  const r1 = await runCompanionDetectionOncePerDay(subject("U1", true), NOW)
  assert.equal(r1.observationsCreated.length, 4, JSON.stringify(r1))
  assert.deepEqual(rowsIn("companion_observations").map((o) => o.type).sort(), ["celebration", "first_time", "gap", "pattern"])
  assert.ok(rowsIn("companion_observations").every((o) => o.shown_at === null && o.acknowledged === false && o.user_response === null))
  ok("toggle ON, first open of the day: 4 observations stored, all shown_at NULL / unacknowledged")

  const callsBefore = db.calls.length
  assert.equal(await runCompanionDetectionOncePerDay(subject("U1", true), NOW), null)
  assert.equal(await runCompanionDetectionOncePerDay(subject("U1", true), NOW), null)
  assert.equal(db.calls.length, callsBefore)
  ok("toggle ON, repeat calls the same day: zero network calls (once-per-day guard)")

  const r2 = await runCompanionDetection(subject("U1", true), NOW)
  const r3 = await runCompanionDetection(subject("U1", true), NOW)
  assert.equal(r2.observationsCreated.length, 1) // the second first_time event, one per pass by design
  assert.equal(r3.observationsCreated.length, 0)
  assert.equal(rowsIn("companion_observations").length, 5)
  ok("re-detecting already-recorded conditions never stacks a duplicate")

  seed("U2")
  const [a, b] = await Promise.all([runCompanionDetection(subject("U2", true), NOW), runCompanionDetection(subject("U2", true), NOW)])
  assert.equal(rowsIn("companion_observations").length, 4)
  assert.equal(a.observationsCreated.length + b.observationsCreated.length, 4)
  ok("two concurrent runs: 4 rows total, the unique-violation path doesn't throw")

  seed("U3")
  db.failReads = true
  await assert.rejects(runCompanionDetectionOncePerDay(subject("U3", true), NOW), (e) => e.message === "read failed")
  assert.equal(dayFlag("U3"), undefined)
  db.failReads = false
  const afterFail = db.calls.length
  assert.equal(await runCompanionDetectionOncePerDay(subject("U3", true), NOW), null)
  assert.equal(db.calls.length, afterFail)
  const nextDay = new Date(NOW)
  nextDay.setDate(nextDay.getDate() + 1)
  const retried = await runCompanionDetectionOncePerDay(subject("U3", true), nextDay)
  assert.ok(retried && retried.observationsCreated.length >= 1)
  ok("a failed run leaves the day flag unset, isn't hammered this page load, and retries next day")

  seed("U4")
  const saturday = new Date(sunday)
  saturday.setDate(saturday.getDate() - 1)
  const sat = await runCompanionDetection(subject("U4", true), saturday)
  assert.equal(sat.weeklyCheckinCreated, false)
  assert.ok(!db.calls.includes("select:companion_weekly_checkins") && !db.calls.includes("insert:companion_weekly_checkins"))
  const sun1 = await runCompanionDetection(subject("U4", true), sunday)
  const sun2 = await runCompanionDetection(subject("U4", true), sunday)
  assert.equal(sun1.weeklyCheckinCreated, true)
  assert.equal(sun2.weeklyCheckinCreated, false)
  assert.equal(rowsIn("companion_weekly_checkins").length, 1)
  assert.equal(rowsIn("companion_weekly_checkins")[0].status, "pending")
  ok("weekly ritual: none on Saturday, exactly one pending row on Sunday, no duplicate on a second run")

  seed("U5")
  const young = await runCompanionDetection(
    { userId: "U5", profileCreatedAt: daysAgo(10).toISOString(), aiEnabled: true },
    sunday
  )
  assert.equal(young.weeklyCheckinCreated, false)
  ok("weekly ritual: no row for an account under 3 weeks old")

  console.log(`\nall ${count} companion-detection checks passed`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
