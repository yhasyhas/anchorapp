// Picks the single suggestion shown at the top of Home each day, from the
// same Move pool the Move page and Home's planning picker already build
// (src/lib/move-selection.ts). Deliberately kept isolated and simple —
// keyword matching, a deterministic per-day seed, no AI — so it can be
// made more sophisticated later (Companion, Journal/Jar words) without
// rewriting the card or the hook that consumes this. Below a minimum
// sample of real accept/decline history it's still the original tiered
// rotation; above it, a small weighted-scoring model blends Compass match
// with what she's actually accepted/declined (see the LEARNED_BIAS_*
// section) — still no ML, just documented, named-constant rules.

import type { MoveSuggestion } from "@/types"

// Keyword hints per Compass value (canonical English strings, see
// COMPASS_VALUES in src/lib/compass.ts). Matched as lowercased substrings
// against a Move entry's title text. Intentionally a small hand-list: the
// goal is a gentle nudge toward something that resonates with what she said
// matters, not a precise classifier.
export const VALUE_KEYWORDS: Record<string, string[]> = {
  Curiosity: ["learn", "explore", "discover", "new", "read", "question", "try"],
  Creativity: ["create", "make", "draw", "write", "paint", "play", "build", "craft", "song"],
  Kindness: ["kind", "help", "thank", "care", "gift", "compliment", "support", "gentle"],
  Freedom: ["walk", "outside", "wander", "break", "roam", "open", "unplug"],
  Growth: ["learn", "practice", "grow", "read", "stretch", "challenge", "skill", "new"],
  Impact: ["help", "volunteer", "contribute", "reach out", "share", "give", "someone"],
  Calm: ["breathe", "rest", "slow", "quiet", "meditate", "pause", "stretch", "tea", "bath"],
  Connection: ["call", "text", "friend", "someone", "reach out", "meet", "share", "family", "message"],
  Honesty: ["journal", "write", "reflect", "name", "true", "say", "note"],
  Adventure: ["new", "explore", "try", "spot", "different", "wander", "outside", "route"],
  Balance: ["rest", "boundary", "pause", "walk", "unplug", "slow", "breathe"],
  Presence: ["breathe", "notice", "savor", "slow", "mindful", "present", "walk", "listen", "sit"],
}

export interface DailySuggestionPick {
  // move_suggestions row id, or null when the pick came from the static pool.
  sourceMoveItemId: string | null
  text: string
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

// The substring-keyword matcher underlying matchByValues below — pulled out
// so other callers with their own keyword list (not a Compass value's fixed
// VALUE_KEYWORDS entry) can reuse the exact same matching technique instead
// of reimplementing it. Used by src/lib/weekly-review.ts to check whether a
// free-text Compass goal resonates with a suggestion, the same way a
// Compass value does here.
export function filterByKeywords<T extends { title: string }>(pool: T[], keywords: string[]): T[] {
  if (keywords.length === 0) return []
  return pool.filter((s) => {
    const title = normalizeTitle(s.title)
    return keywords.some((k) => title.includes(k))
  })
}

// Deterministic string hash — same djb2-style rolling hash as
// getDailyQuestions in src/lib/checkin-questions.ts, so a given seed always
// yields the same index without persisting anything.
function hashSeed(str: string): number {
  let seed = 0
  for (let i = 0; i < str.length; i++) {
    seed = (seed << 5) - seed + str.charCodeAt(i)
    seed |= 0
  }
  return Math.abs(seed)
}

// A materialized static-pool row (id "default-N") or the "absence-fallback"
// sentinel isn't a real move_suggestions row — see move-selection.ts.
function isRealRow(s: MoveSuggestion): boolean {
  return !!s.id && !s.id.startsWith("default-") && s.id !== "absence-fallback"
}

// Entries whose title matches at least one keyword of at least one of the
// given values. Empty when there are no values, or none of them resonate
// with anything in the pool. Generic over anything with a `title` (not just
// MoveSuggestion) so other callers — e.g. src/lib/wrapped.ts, matching
// accepted daily_suggestions rows against Compass values for the monthly
// recap — can reuse this exact matching logic instead of duplicating it.
export function matchByValues<T extends { title: string }>(pool: T[], values: string[]): T[] {
  if (values.length === 0) return []
  const keywords = values.flatMap((v) => VALUE_KEYWORDS[v] ?? [])
  return filterByKeywords(pool, keywords)
}

// Ranks each given Compass value by how many of the accepted entries
// resonate with it (via matchByValues), returns the top 1-2 with at least
// one match, or null when none resonate. Ties break by the value's
// position in `values` (i.e. her own Compass order) — stable, not
// alphabetical or count-insertion-order. Deliberately has no opinion on
// minimum sample size: callers (Wrapped's monthly note, Patterns' rolling
// 30-day note — each with its own threshold) gate that themselves before
// calling this, so the ranking logic itself is never duplicated between them.
export function topResonatingValues(values: string[], accepted: { title: string }[]): string[] | null {
  if (values.length === 0) return null
  const counts = values
    .map((value) => ({ value, count: matchByValues(accepted, [value]).length }))
    .filter((c) => c.count > 0)
  if (counts.length === 0) return null
  counts.sort((a, b) => b.count - a.count || values.indexOf(a.value) - values.indexOf(b.value))
  return counts.slice(0, 2).map((c) => c.value)
}

// Patterns' "Lately, you've leaned toward: X, Y" note — a rolling 30-day
// window (not a calendar month, so a different threshold than Wrapped's
// MIN_ACCEPTED_SUGGESTIONS_FOR_COMPASS_NOTE in src/lib/wrapped.ts): 5
// rather than 3, since 30 rolling days is a noticeably longer sample than
// a fresh calendar month can offer early on, so a slightly higher bar
// still means "enough signal" without waiting unreasonably long for it.
export const MIN_ACCEPTED_FOR_PATTERNS_GROWTH_NOTE = 5

export function computePatternsCompassGrowth(values: string[], acceptedSuggestionTexts: string[]): string[] | null {
  if (acceptedSuggestionTexts.length < MIN_ACCEPTED_FOR_PATTERNS_GROWTH_NOTE) return null
  return topResonatingValues(
    values,
    acceptedSuggestionTexts.map((title) => ({ title }))
  )
}

// ==================== LEARNED ACCEPT/DECLINE BIAS ====================
//
// Investigation notes (read before touching any of this):
//
// "Another suggestion" leaves NO trace in daily_suggestions at all. There
// is one mutable row per (user_id, date) — tapping "Another" upserts over
// that same row (new source_move_item_id/suggestion_text, status reset to
// 'pending'), so the skipped pick is never separately persisted anywhere.
// A title skipped via "Another" is therefore structurally indistinguishable
// from a title that was never shown that day at all — there is nothing to
// weight as "a weak decline," because no row references it once it's
// overwritten. The signal below is built purely from each day's FINAL
// status (accepted/declined; 'pending' rows — never answered — are
// excluded by the caller), which is exactly what the data can actually
// support.
//
// source_move_item_id is null whenever a pick came from the static
// hardcoded pool or the absence-fallback sentinel (see isRealRow above),
// so acceptance stats are keyed by normalized suggestion_text instead —
// the same matching key every other function in this module already uses.

export type SuggestionOutcome = "accepted" | "declined"

export interface SuggestionHistoryEntry {
  title: string
  status: SuggestionOutcome
}

// Caller-side window for the accept/decline sample (src/lib/daily-
// suggestion-context.tsx fetches daily_suggestions over this many days and
// filters to accepted/declined only before calling pickDailySuggestion).
export const LEARNED_BIAS_WINDOW_DAYS = 60

// Anti-overfitting guard: below this many TOTAL answered suggestions
// (accepted + declined, across the whole pool, over LEARNED_BIAS_WINDOW_DAYS)
// there isn't enough signal to bias on without just amplifying noise — the
// selection falls back to pickByTieredRotation completely unchanged, byte
// for byte, rather than a "lightly applied" version of the new logic. This
// is a hard behavioral switch, not a confidence taper.
export const LEARNED_BIAS_MIN_TOTAL_RESPONSES = 10

// Compass match multiplier — a title resonating with one of her Compass
// values gets this much more weight than one that doesn't (baseline 1).
// Chosen so a Compass match still matters, but can't alone overwhelm a
// strongly-learned signal in the other direction (see the worked example
// on learnedWeightMultiplier below).
export const COMPASS_MATCH_WEIGHT_MULTIPLIER = 1.6

// Learned acceptance-rate multiplier range. A title with NO history at all
// is perfectly neutral (multiplier 1, no bias) — most of the pool lands
// here even for a well-answered user, since 10 total responses is a small
// sample against a much larger pool. A title's own multiplier is
// interpolated linearly between these two bounds by its accepted/
// (accepted+declined) rate:
//   - 0% accepted  -> LEARNED_MIN_WEIGHT_MULTIPLIER (never exactly 0 —
//     tastes change, see point 5: this is the residual chance floor)
//   - 100% accepted -> LEARNED_MAX_WEIGHT_MULTIPLIER
// Worked example (point 4's two cases):
//   - Compass-matching, always declined: 1.6 * 0.15 = 0.24
//   - Not Compass-matching, always accepted: 1 * 2.2 = 2.2
//   -> the well-liked non-matching entry outweighs the always-declined
//      matching one by roughly 9x, instead of the matching one dominating
//      by tier as it would have before.
export const LEARNED_MIN_WEIGHT_MULTIPLIER = 0.15
export const LEARNED_MAX_WEIGHT_MULTIPLIER = 2.2

// Recency penalty — same "soft, never a hard filter" intent the tiered
// rotation already documented, just expressed as a multiplier instead of a
// tier fallback once the weighted model is active.
export const RECENT_PENALTY_WEIGHT_MULTIPLIER = 0.2

interface TitleAcceptanceStats {
  accepted: number
  declined: number
}

function buildTitleAcceptanceStats(history: SuggestionHistoryEntry[]): Map<string, TitleAcceptanceStats> {
  const stats = new Map<string, TitleAcceptanceStats>()
  for (const h of history) {
    const key = normalizeTitle(h.title)
    const entry = stats.get(key) ?? { accepted: 0, declined: 0 }
    if (h.status === "accepted") entry.accepted++
    else entry.declined++
    stats.set(key, entry)
  }
  return stats
}

function learnedWeightMultiplier(stats: TitleAcceptanceStats | undefined): number {
  if (!stats) return 1
  const total = stats.accepted + stats.declined
  if (total === 0) return 1
  const acceptanceRate = stats.accepted / total
  return LEARNED_MIN_WEIGHT_MULTIPLIER + (LEARNED_MAX_WEIGHT_MULTIPLIER - LEARNED_MIN_WEIGHT_MULTIPLIER) * acceptanceRate
}

// Deterministic "roulette wheel" pick: same hashSeed as the rest of this
// module, but landed against the cumulative weight distribution instead of
// a plain uniform modulo. A single (seed) call always resolves to the same
// entry (so a given user+date is still stable across reloads), while many
// different seeds land on higher-weight entries proportionally more often
// — this is what makes the bias actually show up as a shifted probability
// distribution rather than a one-off coin flip.
function weightedDeterministicPick<T>(candidates: { item: T; weight: number }[], seed: string): T {
  const SCALE = 1_000_000
  const totalScaled = Math.max(
    1,
    Math.round(candidates.reduce((sum, c) => sum + c.weight, 0) * SCALE)
  )
  const target = hashSeed(seed) % totalScaled
  let cumulative = 0
  for (const c of candidates) {
    cumulative += Math.round(c.weight * SCALE)
    if (target < cumulative) return c.item
  }
  return candidates[candidates.length - 1].item
}

// The original rotation, extracted verbatim (no behavior change) — this is
// the exact path taken whenever LEARNED_BIAS_MIN_TOTAL_RESPONSES isn't met,
// so that case stays byte-for-byte identical to before this feature.
function pickByTieredRotation(
  usable: MoveSuggestion[],
  values: string[],
  seed: string,
  recentTitles: Set<string>,
  excludeTitles: Set<string>
): DailySuggestionPick {
  const valueMatched = matchByValues(usable, values)
  const notRecent = (list: MoveSuggestion[]) =>
    list.filter((s) => !recentTitles.has(normalizeTitle(s.title)))

  const tier =
    [notRecent(valueMatched), valueMatched, notRecent(usable), usable].find((list) => list.length > 0) ??
    usable

  const idx = hashSeed(`${seed}|${excludeTitles.size}`) % tier.length
  const chosen = tier[idx]

  return {
    sourceMoveItemId: isRealRow(chosen) ? chosen.id : null,
    text: chosen.title,
  }
}

// The new weighted model, only reached once LEARNED_BIAS_MIN_TOTAL_RESPONSES
// is met. Every usable entry gets a single multiplicative weight combining
// Compass match, learned accept/decline rate, and recency — no single
// factor can force another to zero (every multiplier has a positive floor),
// so nothing is ever permanently excluded, just made more or less likely.
function pickByWeightedScore(
  usable: MoveSuggestion[],
  values: string[],
  seed: string,
  recentTitles: Set<string>,
  excludeTitles: Set<string>,
  history: SuggestionHistoryEntry[]
): DailySuggestionPick {
  const stats = buildTitleAcceptanceStats(history)
  const matchedTitles = new Set(matchByValues(usable, values).map((s) => normalizeTitle(s.title)))

  const weighted = usable.map((s) => {
    const key = normalizeTitle(s.title)
    let weight = 1
    if (matchedTitles.has(key)) weight *= COMPASS_MATCH_WEIGHT_MULTIPLIER
    weight *= learnedWeightMultiplier(stats.get(key))
    if (recentTitles.has(key)) weight *= RECENT_PENALTY_WEIGHT_MULTIPLIER
    return { item: s, weight }
  })

  const chosen = weightedDeterministicPick(weighted, `${seed}|${excludeTitles.size}`)

  return {
    sourceMoveItemId: isRealRow(chosen) ? chosen.id : null,
    text: chosen.title,
  }
}

export interface PickDailySuggestionParams {
  pool: MoveSuggestion[]
  // Compass value tags (may be empty — then it's pure rotation, or pure
  // learned bias once the threshold below is met).
  values: string[]
  // Stable per-day anchor, e.g. `${userId}:${date}` — makes the pick
  // identical across reloads on the same day.
  seed: string
  // Titles surfaced in the last few days (as daily suggestions or in her
  // anchors) — softly avoided so the same thing doesn't resurface two days
  // running. Never a hard filter: a tiny pool won't go silent.
  recentTitles?: Set<string>
  // Hard exclude — the current pick(s) when she taps "Another suggestion".
  excludeTitles?: Set<string>
  // Accepted/declined outcomes over LEARNED_BIAS_WINDOW_DAYS (never-
  // answered rows already excluded by the caller). Omitted, or fewer than
  // LEARNED_BIAS_MIN_TOTAL_RESPONSES entries, falls back unchanged to
  // pickByTieredRotation — see that guard's own comment.
  history?: SuggestionHistoryEntry[]
}

// Returns null only when the pool is genuinely empty after exclusions —
// the caller then either resets exclusions or hides the card.
export function pickDailySuggestion(params: PickDailySuggestionParams): DailySuggestionPick | null {
  const { pool, values, seed, recentTitles = new Set(), excludeTitles = new Set(), history = [] } = params

  const usable = pool.filter((s) => s.title && !excludeTitles.has(normalizeTitle(s.title)))
  if (usable.length === 0) return null

  if (history.length < LEARNED_BIAS_MIN_TOTAL_RESPONSES) {
    return pickByTieredRotation(usable, values, seed, recentTitles, excludeTitles)
  }

  return pickByWeightedScore(usable, values, seed, recentTitles, excludeTitles, history)
}
