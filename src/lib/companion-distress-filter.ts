// Deterministic safety gate for Companion text generation — runs BEFORE any
// model call, never after. This is not the model's job: an LLM can be
// talked past a system-prompt instruction, a keyword filter over the raw
// text cannot. If this fires, src/lib/companion-generation.ts must never
// reach the network call to api/insights.ts for that generation pass — the
// pre-written SAFETY_FALLBACK_TEXT below is used instead.
//
// Scope: only Journal (journal_entries.sentence) and Jar/gratitude
// (gratitudes.text) free text are checked, because those are the only two
// free-text sources this feature ever forwards to the model as context (see
// anchor-companion-design.md section 6: "extraits courts et pertinents du
// Journal/Jar"). mood_logs itself carries no free text in this schema (mood
// is an enum, MoodType) — there is currently nothing to check there; if a
// free-text mood note is ever added, it must be wired into this same check
// before it's allowed anywhere near generation.
//
// This list is deliberately narrow: clear, unambiguous expressions of acute
// distress (active suicidal ideation, stated self-harm intent), NOT ordinary
// low mood, sadness, stress or venting — those are exactly what the
// Companion is supposed to be able to respond to normally. It is not, and
// cannot be, exhaustive; treat it as a first, deterministic line of defense
// worth revisiting as real usage surfaces gaps, not a clinical instrument.
// English and Swahili are both checked regardless of the user's chosen app
// language, since free text can code-switch.
const DISTRESS_PATTERNS: RegExp[] = [
  // --- English: suicidal ideation ---
  /\bkill(ing)? myself\b/i,
  /\bwant(ed|ing)? to die\b/i,
  /\bend(ing)? my (own )?life\b/i,
  /\btake my (own )?life\b/i,
  /\bsuicid(e|al)\b/i,
  /\bdon'?t want to (be alive|live anymore|exist anymore)\b/i,
  /\bwish i (was|were)n'?t (alive|here)\b/i,
  /\bwish i didn'?t exist\b/i,
  /\bbetter off dead\b/i,
  /\bno reason to (live|keep living)\b/i,
  /\bnot worth living\b/i,
  // --- English: self-harm intent ---
  /\b(hurt|hurting|harm|harming) myself\b/i,
  /\b(cut|cutting) myself\b/i,
  // --- Swahili: suicidal ideation ---
  // No leading word boundary on the reflexive roots below (jiua/jidhuru/
  // jikata): Swahili conjugates by stacking subject/tense prefixes directly
  // onto the verb root (kujiua -> nataka kujiua, anajiua, amejiua, ...), so
  // anchoring to the infinitive's own start would miss real conjugated
  // statements — the worse failure mode for a safety filter. The trade-off
  // is a small risk of an unrelated word incidentally containing the same
  // substring; treated as acceptable here given what's at stake, but this
  // (like the rest of the Swahili coverage) deserves native-speaker review.
  /jiua/i,
  /\bnataka kufa\b/i,
  /\bsitaki kuishi tena\b/i,
  /\bsina sababu ya kuishi\b/i,
  /\bafadhali (ni)?fe\b/i,
  /\bningependa (nisiwepo|nisingekuwepo|nife)\b/i,
  // --- Swahili: self-harm intent ---
  /jidhuru/i,
  /jikata/i,
]

// True if `text` contains an unambiguous distress/self-harm signal. Pure,
// synchronous, no network — safe to call on every candidate string before
// any generation call.
export function containsDistressSignal(text: string | null | undefined): boolean {
  if (!text) return false
  return DISTRESS_PATTERNS.some((p) => p.test(text))
}

// Checks every recent Journal/Jar string in one pass. Any single match is
// enough to gate the whole generation run for this user this session — the
// filter's job is to be conservative, not to isolate which specific entry
// triggered it.
export function hasDistressSignal(inputs: { journalSentences: string[]; gratitudeTexts: string[] }): boolean {
  return inputs.journalSentences.some(containsDistressSignal) || inputs.gratitudeTexts.some(containsDistressSignal)
}

// Fixed, pre-written text shown instead of any generated message when
// hasDistressSignal() fires. NEVER passed through the model — this is the
// exact string stored in companion_observations.generated_text /
// companion_weekly_checkins.summary for that row. Warm presence, a real
// human resource, no diagnosis, steady register (no exclamation points),
// consistent with the rest of the Companion's fixed-fallback copy (see
// LOCAL_REASSURANCE_FALLBACK in src/lib/ai-service.ts).
export const SAFETY_FALLBACK_TEXT: Record<"en" | "sw", string> = {
  en:
    "This sounds heavier than I can hold well through text. Please reach out to a real " +
    "person right now — https://findahelpline.com has free, confidential support, day or " +
    "night, in most countries. You don't have to carry this alone.",
  sw:
    "Hii inaonekana nzito kuliko ninavyoweza kuishughulikia vizuri kupitia ujumbe. Tafadhali " +
    "wasiliana na mtu halisi sasa hivi — https://findahelpline.com ina msaada wa bure na wa " +
    "siri, mchana na usiku, katika nchi nyingi. Huhitaji kubeba hili peke yako.",
}
