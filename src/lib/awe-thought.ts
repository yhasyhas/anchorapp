// Today's Awe — one small factual, wonder-inducing thought shown once a
// day on Home, reduced from the original "Discover" concept into a single
// unbrowseable thing: no "next" affordance, no category picker, nothing
// left to open once it's on screen (see the awe_thoughts / awe_thought_shown
// migration for the full schema rationale).
import { supabase } from "@/lib/supabase"
import { localDateStr, todayStr } from "@/lib/utils"
import type { AweThought, TodaysAweThought } from "@/types"

// How many past days count as "recently shown" when picking today's
// thought — softly avoided, not a hard filter (falls back to the full
// catalog once every entry has been recently shown). Longer than daily
// suggestion's 4-day recentTitles window (src/lib/daily-suggestion-context.tsx):
// the catalog here is a small fixed set (30 seed rows) rather than a
// growing custom+AI pool, so a longer window is what actually keeps
// repeats feeling meaningfully spaced out.
const RECENT_AVOID_DAYS = 14

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

// Deterministic string hash — same djb2-style rolling hash as
// getDailyQuestions (checkin-questions.ts) / getDailyJournalQuestion
// (journal-questions.ts) / pickDailySuggestion (daily-suggestion.ts), each
// with their own local copy rather than a shared util — kept consistent
// with that existing pattern here too.
function hashSeed(str: string): number {
  let seed = 0
  for (let i = 0; i < str.length; i++) {
    seed = (seed << 5) - seed + str.charCodeAt(i)
    seed |= 0
  }
  return Math.abs(seed)
}

function toDisplay(thought: AweThought, lang: "en" | "sw", opened: boolean): TodaysAweThought {
  return {
    category: thought.category,
    content: lang === "sw" ? thought.content_sw : thought.content_en,
    sourceNote: thought.source_note,
    opened,
  }
}

// Get-or-create today's thought for this user — same shape as daily
// suggestions: reopening the app the same day returns the same one,
// never a fresh pick. Returns null only if the catalog is completely
// empty (should never happen with the seed in place).
export async function getTodaysAweThought(userId: string, lang: "en" | "sw"): Promise<TodaysAweThought | null> {
  const date = todayStr()

  const { data: existing, error: existingError } = await supabase
    .from("awe_thought_shown")
    .select("awe_thought_id, opened")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle()
  if (existingError) throw existingError

  if (existing) {
    const { data: thought, error: thoughtError } = await supabase
      .from("awe_thoughts")
      .select("*")
      .eq("id", existing.awe_thought_id)
      .single()
    if (thoughtError) throw thoughtError
    return toDisplay(thought as AweThought, lang, existing.opened)
  }

  const [{ data: pool, error: poolError }, { data: recentRows, error: recentError }] = await Promise.all([
    supabase.from("awe_thoughts").select("*"),
    supabase
      .from("awe_thought_shown")
      .select("awe_thought_id")
      .eq("user_id", userId)
      .gte("date", daysAgoStr(RECENT_AVOID_DAYS)),
  ])
  if (poolError) throw poolError
  if (recentError) throw recentError

  const catalog = (pool as AweThought[]) || []
  if (catalog.length === 0) return null

  const recentIds = new Set((recentRows || []).map((r) => r.awe_thought_id as string))
  const notRecent = catalog.filter((t) => !recentIds.has(t.id))
  const candidates = notRecent.length > 0 ? notRecent : catalog

  const idx = hashSeed(`${userId}|${date}|awe`) % candidates.length
  const chosen = candidates[idx]

  // Upsert (not insert) on (user_id, date): if another device/tab raced
  // this same get-or-create, this just converges on whichever row won —
  // same reasoning as daily_suggestions' own lazy creation.
  const { data: inserted, error: insertError } = await supabase
    .from("awe_thought_shown")
    .upsert({ user_id: userId, awe_thought_id: chosen.id, date, opened: false }, { onConflict: "user_id,date" })
    .select("opened")
    .single()
  if (insertError) throw insertError

  return toDisplay(chosen, lang, inserted.opened)
}

// Marks today's thought as seen. Safe to call more than once (idempotent
// UPDATE) — the card calls this once on mount, matching
// SuggestionFollowUpCard's onSeen-on-mount convention.
export async function markTodaysAweThoughtOpened(userId: string): Promise<void> {
  const { error } = await supabase
    .from("awe_thought_shown")
    .update({ opened: true })
    .eq("user_id", userId)
    .eq("date", todayStr())
  if (error) throw error
}
