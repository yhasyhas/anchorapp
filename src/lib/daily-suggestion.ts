// Picks the single suggestion shown at the top of Home each day, from the
// same Move pool the Move page and Home's planning picker already build
// (src/lib/move-selection.ts). Deliberately kept isolated and simple —
// keyword matching, a deterministic per-day seed, no AI, no scoring model —
// so it can be sophisticated later (Companion, Journal/Jar words) without
// rewriting the card or the hook that consumes this.

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

// Move entries whose title matches at least one keyword of at least one of
// the user's selected values. Empty when she has no Compass values, or none
// of them resonate with anything currently in the pool.
export function matchByValues(pool: MoveSuggestion[], values: string[]): MoveSuggestion[] {
  if (values.length === 0) return []
  const keywords = values.flatMap((v) => VALUE_KEYWORDS[v] ?? [])
  if (keywords.length === 0) return []
  return pool.filter((s) => {
    const title = normalizeTitle(s.title)
    return keywords.some((k) => title.includes(k))
  })
}

export interface PickDailySuggestionParams {
  pool: MoveSuggestion[]
  // Compass value tags (may be empty — then it's pure rotation).
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
}

// Returns null only when the pool is genuinely empty after exclusions —
// the caller then either resets exclusions or hides the card.
export function pickDailySuggestion(params: PickDailySuggestionParams): DailySuggestionPick | null {
  const { pool, values, seed, recentTitles = new Set(), excludeTitles = new Set() } = params

  const usable = pool.filter((s) => s.title && !excludeTitles.has(normalizeTitle(s.title)))
  if (usable.length === 0) return null

  const valueMatched = matchByValues(usable, values)
  const notRecent = (list: MoveSuggestion[]) =>
    list.filter((s) => !recentTitles.has(normalizeTitle(s.title)))

  // Preference order, most specific first:
  //   1. resonates with a value AND not shown recently
  //   2. resonates with a value (any)
  //   3. not shown recently
  //   4. anything usable
  const tier =
    [notRecent(valueMatched), valueMatched, notRecent(usable), usable].find((list) => list.length > 0) ??
    usable

  // Deterministic index. `excludeTitles.size` shifts the seed so each
  // "Another suggestion" tap lands on a different entry.
  const idx = hashSeed(`${seed}|${excludeTitles.size}`) % tier.length
  const chosen = tier[idx]

  return {
    sourceMoveItemId: isRealRow(chosen) ? chosen.id : null,
    text: chosen.title,
  }
}
