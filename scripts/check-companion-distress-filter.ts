// Fixture-based check for src/lib/companion-distress-filter.ts — the
// deterministic gate that must run before ANY Companion generation call.
// Positive fixtures are clear, unambiguous distress/self-harm language;
// negative fixtures are ordinary low mood, sadness, stress and venting that
// the Companion is supposed to be able to respond to normally — the filter
// must NOT fire on those, or it would silence the feature for its most
// important use case. Pure, no network, no bundling needed (the module has
// zero external imports). Run with `npm run check-companion-distress-filter`.
import assert from "node:assert/strict"
import { containsDistressSignal, hasDistressSignal, SAFETY_FALLBACK_TEXT } from "../src/lib/companion-distress-filter.ts"

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

// ==================== POSITIVE: should fire ====================

const POSITIVE_EN = [
  "I want to kill myself",
  "I've been thinking about killing myself lately",
  "sometimes I just want to die",
  "I keep thinking about ending my life",
  "I don't want to live anymore",
  "I wish I wasn't here",
  "I wish I didn't exist",
  "everyone would be better off dead",
  "there's no reason to live",
  "I've been cutting myself again",
  "I want to hurt myself",
  "I feel suicidal",
]

const POSITIVE_SW = [
  "nataka kufa",
  "sitaki kuishi tena",
  "nafikiria kujiua",
  "sina sababu ya kuishi",
  "nimekuwa nikijikata",
  "ningependa nisiwepo",
]

for (const text of POSITIVE_EN) {
  test(`fires on (EN) "${text}"`, () => assert.equal(containsDistressSignal(text), true))
}
for (const text of POSITIVE_SW) {
  test(`fires on (SW) "${text}"`, () => assert.equal(containsDistressSignal(text), true))
}

// ==================== NEGATIVE: must NOT fire ====================
// Ordinary low mood / stress / venting — the exact everyday content the
// Companion needs to keep responding to normally.

const NEGATIVE = [
  "today was really hard, I feel so low",
  "I'm exhausted and stressed about work",
  "I feel like I'm dying of embarrassment", // idiomatic, not literal
  "this deadline is killing me", // idiomatic
  "I had a bad day and cried a lot",
  "I feel heavy and sad lately",
  "I'm so tired of everything going wrong",
  "nimechoka sana leo", // "I'm very tired today" (SW)
  "leo lilikuwa gumu kihisia", // "today was emotionally hard" (SW)
  "",
  "great day, feeling good!",
]

for (const text of NEGATIVE) {
  test(`does NOT fire on "${text}"`, () => assert.equal(containsDistressSignal(text), false))
}

test("containsDistressSignal(null/undefined) -> false", () => {
  assert.equal(containsDistressSignal(null), false)
  assert.equal(containsDistressSignal(undefined), false)
})

// ==================== hasDistressSignal: aggregation over Journal + Jar ====================

test("hasDistressSignal: fires if ANY journal sentence matches", () => {
  assert.equal(
    hasDistressSignal({ journalSentences: ["a nice walk today", "I want to kill myself"], gratitudeTexts: [] }),
    true
  )
})

test("hasDistressSignal: fires if ANY gratitude/jar entry matches", () => {
  assert.equal(
    hasDistressSignal({ journalSentences: [], gratitudeTexts: ["grateful for coffee", "I wish I didn't exist"] }),
    true
  )
})

test("hasDistressSignal: all-clear text on both sources -> false", () => {
  assert.equal(
    hasDistressSignal({
      journalSentences: ["a hard day but I got through it", "felt proud of myself today"],
      gratitudeTexts: ["my sister", "warm tea", "a good book"],
    }),
    false
  )
})

test("hasDistressSignal: empty inputs -> false", () => {
  assert.equal(hasDistressSignal({ journalSentences: [], gratitudeTexts: [] }), false)
})

// ==================== Fixed fallback text sanity ====================

test("SAFETY_FALLBACK_TEXT: both languages present, both link to findahelpline.com", () => {
  assert.ok(SAFETY_FALLBACK_TEXT.en.includes("https://findahelpline.com"))
  assert.ok(SAFETY_FALLBACK_TEXT.sw.includes("https://findahelpline.com"))
})

test("SAFETY_FALLBACK_TEXT: no exclamation points (brand voice: never a default register)", () => {
  assert.ok(!SAFETY_FALLBACK_TEXT.en.includes("!"))
  assert.ok(!SAFETY_FALLBACK_TEXT.sw.includes("!"))
})

console.log(`${passed} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
console.log("✓ Distress filter behaves as specified.")
