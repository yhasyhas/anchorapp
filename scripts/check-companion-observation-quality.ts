// Ad-hoc quality review, NOT a CI check (not wired into package.json): calls
// the REAL Anthropic API with realistic fixtures, one per Companion
// observation type, using the exact same system prompt and fact-formatting
// api/insights.ts's handleCompanionObservation uses (imported directly, not
// re-typed here, so what you read below is genuinely what production would
// send). Needs ANTHROPIC_API_KEY in .env. Run with:
//   npx tsx --env-file=.env scripts/check-companion-observation-quality.ts
import {
  buildLiteralTokens,
  callAnthropicHaiku,
  collapseDuplicateUnitWords,
  COMPANION_OBSERVATION_SYSTEM_PROMPT,
  formatObservationFacts,
  substituteLiteralTokens,
} from "../api/insights.ts"

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY not set (expected in .env)")
  process.exit(1)
}

interface Fixture {
  label: string
  observationType: string
  payload: Record<string, unknown>
  compassValues: string[]
  compassGoals: string[]
  excerpts: string[]
  language: "en" | "sw"
  localDate: string
  timeOfDay: "morning" | "afternoon" | "evening" | "night"
}

const FIXTURES: Fixture[] = [
  {
    label: "pattern (hard moment) — EN",
    observationType: "pattern",
    payload: { trigger: "hard_moment", runStart: "2026-09-19", runEnd: "2026-09-21", runLength: 3 },
    compassValues: ["Peace", "Growth"],
    compassGoals: ["Be gentler with myself", "Start therapy"],
    excerpts: ["work has been a lot this week", "just want to sleep it off"],
    language: "en",
    localDate: "2026-09-22",
    timeOfDay: "morning",
  },
  {
    label: "gap (Compass goal untouched) — EN",
    observationType: "gap",
    payload: { goalText: "Meditate every morning", weeks: 6 },
    compassValues: ["Peace", "Discipline"],
    compassGoals: ["Meditate every morning", "Read more fiction"],
    excerpts: ["finally finished that novel I'd been putting off"],
    language: "en",
    localDate: "2026-09-22",
    timeOfDay: "evening",
  },
  {
    label: "celebration (14-day anchor streak) — SW",
    observationType: "celebration",
    payload: { milestone: 14, currentAnchorStreak: 15 },
    compassValues: ["Uthabiti", "Ukuaji"],
    compassGoals: ["Kuandika kila siku"],
    excerpts: ["leo nimejisikia fahari kidogo"],
    language: "sw",
    localDate: "2026-09-22",
    timeOfDay: "afternoon",
  },
  {
    label: "pattern (hard moment) — SW",
    observationType: "pattern",
    payload: { trigger: "hard_moment", runStart: "2026-09-19", runEnd: "2026-09-21", runLength: 3 },
    compassValues: ["Amani", "Ukuaji"],
    compassGoals: ["Kuwa mpole zaidi na mwenyewe"],
    excerpts: ["kazi imekuwa nyingi wiki hii"],
    language: "sw",
    localDate: "2026-09-22",
    timeOfDay: "morning",
  },
  {
    label: "first_time (new category accepted) — EN",
    observationType: "first_time",
    payload: { trigger: "first_category", category: "creative", isVeryFirst: false },
    compassValues: ["Creativity"],
    compassGoals: ["Paint again"],
    excerpts: ["haven't picked up a brush in years, felt weird but good"],
    language: "en",
    localDate: "2026-09-22",
    timeOfDay: "afternoon",
  },
  {
    label: "first_time (Circle return after long absence) — EN",
    observationType: "first_time",
    payload: { trigger: "circle_return", absenceDays: 95 },
    compassValues: ["Connection"],
    compassGoals: [],
    excerpts: [],
    language: "en",
    localDate: "2026-09-22",
    timeOfDay: "night",
  },
  {
    label: "weekly_checkin — EN",
    observationType: "weekly_checkin",
    payload: { weekStart: "2026-09-21" },
    compassValues: ["Peace", "Growth"],
    compassGoals: ["Be gentler with myself"],
    excerpts: ["trying to notice when I'm being hard on myself"],
    language: "en",
    localDate: "2026-09-22",
    timeOfDay: "morning",
  },
]

function buildUserMessage(f: Fixture): string {
  const contextLines = [
    `Observation type: ${f.observationType}`,
    formatObservationFacts(f.observationType, f.payload),
    f.compassValues.length > 0 ? `Her Compass values: ${f.compassValues.join(", ")}` : null,
    f.compassGoals.length > 0 ? `Her Compass goals: ${f.compassGoals.map((g) => `"${g}"`).join("; ")}` : null,
    f.excerpts.length > 0 ? `Recent things she's written (Journal/Jar):\n${f.excerpts.map((e) => `- "${e}"`).join("\n")}` : null,
    `Current local moment: ${f.localDate}, [[TIME_OF_DAY]].`,
    ``,
    `Language: ${f.language === "sw" ? "Swahili" : "English"}.`,
    `Write the message now.`,
  ].filter((l): l is string => l !== null)
  return contextLines.join("\n")
}

// Heuristic sweep for "did a digit slip through unsubstituted" — after
// substitution, the only digits that should remain are ones that came from
// substituteLiteralTokens itself (i.e. the pre-formatted literal values we
// handed it), never something the model typed on its own. We check this by
// substituting into a COPY with each literal blanked out first: any digit
// still present after that came from the model, not from us.
function findModelWrittenDigits(rawModelText: string, tokens: Record<string, string>): string[] {
  let withoutOurLiterals = rawModelText
  for (const token of Object.keys(tokens)) {
    withoutOurLiterals = withoutOurLiterals.split(token).join("") // remove the token itself too
  }
  const matches = withoutOurLiterals.match(/\d+/g) ?? []
  return matches
}

// SECOND check, added after the first run of this script missed a real
// failure: the Arabic-numeral check above says "clean" even when the model
// spells a number out in words instead ("saba" = seven, in Swahili — which
// is what actually happened, unrelated to the real RUN_LENGTH of 3, with
// the token itself just omitted). Not exhaustive — small hand-lists of
// number words, same "good enough, not perfect" spirit as this app's other
// keyword lists (VALUE_KEYWORDS, the distress filter) — but catches the
// exact failure mode a digit-only regex structurally cannot.
const NUMBER_WORDS: Record<"en" | "sw", string[]> = {
  en: [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred",
  ],
  sw: [
    "moja", "mbili", "tatu", "nne", "tano", "sita", "saba", "nane", "tisa", "kumi",
    "ishirini", "thelathini", "arobaini", "hamsini", "sitini", "sabini", "themanini", "tisini", "mia",
  ],
}

function findModelWrittenNumberWords(rawModelText: string, tokens: Record<string, string>, language: "en" | "sw"): string[] {
  let withoutOurLiterals = rawModelText
  for (const token of Object.keys(tokens)) withoutOurLiterals = withoutOurLiterals.split(token).join("")
  const found: string[] = []
  for (const word of NUMBER_WORDS[language]) {
    if (new RegExp(`\\b${word}\\b`, "i").test(withoutOurLiterals)) found.push(word)
  }
  return found
}

for (const f of FIXTURES) {
  const userMessage = buildUserMessage(f)
  const rawMessage = await callAnthropicHaiku(COMPANION_OBSERVATION_SYSTEM_PROMPT, userMessage, 300, apiKey)
  console.log(`\n${"=".repeat(70)}\n${f.label}\n${"=".repeat(70)}`)
  console.log("--- sent (user message, with [[TOKEN]]s) ---")
  console.log(userMessage)
  console.log("--- raw model output (before substitution) ---")
  console.log(rawMessage ?? "(call failed — null)")

  if (rawMessage) {
    const tokens = buildLiteralTokens(f.observationType, f.payload, f.language, f.timeOfDay)
    const withLiterals = substituteLiteralTokens(rawMessage, tokens)
    const final = collapseDuplicateUnitWords(withLiterals, f.language)
    console.log("--- final (after substitution + cleanup — what would actually be stored) ---")
    console.log(final)
    if (final !== withLiterals) console.log(`  (cleanup collapsed a duplicate unit word: was "${withLiterals}")`)
    const strayDigits = findModelWrittenDigits(rawMessage, tokens)
    console.log(
      strayDigits.length === 0
        ? "--- digit check: OK, no digit in the raw output outside our own [[TOKEN]]s ---"
        : `--- digit check: ⚠ model wrote its own digit(s) not from a token: ${JSON.stringify(strayDigits)} ---`
    )
    const strayWords = findModelWrittenNumberWords(rawMessage, tokens, f.language)
    console.log(
      strayWords.length === 0
        ? "--- spelled-out-number check: OK, no number word outside our own [[TOKEN]]s ---"
        : `--- spelled-out-number check: ⚠ model wrote its own number word(s) not from a token: ${JSON.stringify(strayWords)} (verify by hand — this check can false-positive on idioms) ---`
    )
  }
}
