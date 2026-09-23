// The Discovery Board — a browsable, bounded view over the same awe_thoughts
// catalog Home's "Today's Awe" card already draws one thought a day from
// (src/lib/awe-thought.ts, deliberately untouched by this file: that card
// stays exactly "one thought, one day, no next affordance" regardless of
// this deeper, opt-in destination). Reached from the Hub, not a nav tab
// (product decision — revisit once there's real usage data).
//
// Bounded on purpose, per the product guardrail "no infinite scrolling as
// the default": category tiles, tap one, see its (small, fixed) list, never
// a "load more". The seed catalog has exactly 5 thoughts per category.
import { supabase } from "@/lib/supabase"
import type { AweThought, AweThoughtCategory } from "@/types"

export const DISCOVERY_BOARD_CATEGORIES: AweThoughtCategory[] = [
  "psychology",
  "nature",
  "philosophy",
  "art",
  "space",
  "people",
]

// Defensive cap, not the expected count (the seed catalog has 5 per
// category today) — keeps a category list bounded even if the catalog
// grows later, at the upper end of the "5-8" range the product doc allows.
export const MAX_THOUGHTS_PER_CATEGORY = 8

// Fixed, rule-based "explore next" suggestion per category — deliberately
// NOT AI-generated (product ask: a simple, adjustable-by-hand lookup, not a
// model call). Three reciprocal pairs today, chosen for a loose thematic
// kinship rather than any formula:
//   - psychology <-> philosophy (mind & meaning)
//   - nature <-> space (wonder at scale, small to vast)
//   - art <-> people (human culture & creativity)
// Nothing else in this file depends on the pairs being reciprocal — adjust
// any single entry independently if usage shows a bridge doesn't land.
export const CATEGORY_BRIDGE: Record<AweThoughtCategory, AweThoughtCategory> = {
  psychology: "philosophy",
  philosophy: "psychology",
  nature: "space",
  space: "nature",
  art: "people",
  people: "art",
}

// The whole catalog (30 seed rows today) — used by the board screen to show
// a per-category count on each tile. Trivially small; no pagination needed
// to just count and group in memory.
export async function listDiscoveryBoardCatalog(): Promise<AweThought[]> {
  const { data, error } = await supabase.from("awe_thoughts").select("*").order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as AweThought[]
}

// One category's bounded list, newest-seed-first isn't meaningful here
// (it's a static curated catalog) — ordered by created_at for a stable,
// predictable order instead. Capped server-side at MAX_THOUGHTS_PER_CATEGORY
// so this can never silently become a long scroll.
export async function listThoughtsByCategory(category: AweThoughtCategory): Promise<AweThought[]> {
  const { data, error } = await supabase
    .from("awe_thoughts")
    .select("*")
    .eq("category", category)
    .order("created_at", { ascending: true })
    .limit(MAX_THOUGHTS_PER_CATEGORY)
  if (error) throw error
  return (data ?? []) as AweThought[]
}
