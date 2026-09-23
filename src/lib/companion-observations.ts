// Fetch/write helpers for surfacing Companion observations — the first code
// to ever read shown_at/generated_text or write shown_at/acknowledged/
// user_response on companion_observations (detection and generation only
// wrote type/payload/generated_text until now, see companion-detection.ts
// and companion-generation.ts). Kept as its own file, parallel to
// weekly-review.ts's own read/write helpers, rather than folded into
// companion-detection.ts (a fetch->detect->store pass with a different
// shape and failure story than this fetch->display->respond one).
import { supabase } from "@/lib/supabase"
import type { CompanionObservation, CompanionObservationType } from "@/types"

// weekly_checkin has its own surface (WeeklyReviewCard reads
// weekly_reviews.companion_text directly) and is never inserted into
// companion_observations any more (see the weekly ritual consolidation) —
// excluded here defensively in case an old pre-consolidation row still sits
// in the table.
const VISIBLE_TYPES: CompanionObservationType[] = ["pattern", "gap", "celebration", "first_time"]

// Only a row whose text has actually been generated counts as "pending" —
// detection can insert a row well before generation gets to it (a separate
// async pass, see companion-generation.ts), and showing/marking-shown a row
// with no generated_text yet would burn its one shot at being surfaced
// before there's anything to show.
function pendingObservationsQuery(userId: string) {
  return supabase
    .from("companion_observations")
    .select("*")
    .eq("user_id", userId)
    .in("type", VISIBLE_TYPES)
    .is("shown_at", null)
    .not("generated_text", "is", null)
}

export async function fetchPendingObservations(userId: string): Promise<CompanionObservation[]> {
  const { data, error } = await pendingObservationsQuery(userId).order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as CompanionObservation[]
}

// Cheap existence check for the entry button's dot — same rows
// fetchPendingObservations would return, just not fetched in full.
export async function hasUnshownObservation(userId: string): Promise<boolean> {
  const { data, error } = await pendingObservationsQuery(userId).limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

// Stamped the moment an observation is actually mounted on screen in the
// panel — never at fetch time, see CompanionPanel. Once set, the row drops
// out of fetchPendingObservations for good: this is a one-shot surface, not
// a notification inbox (anchor-companion-design.md section 4).
export async function markCompanionObservationShown(observation: Pick<CompanionObservation, "id">): Promise<void> {
  const { error } = await supabase
    .from("companion_observations")
    .update({ shown_at: new Date().toISOString() })
    .eq("id", observation.id)
  if (error) throw error
}

// Quick-reply path (gap/celebration cards) — writes her short response and
// acknowledges in the same update.
export async function respondToObservation(
  observation: Pick<CompanionObservation, "id">,
  userResponse: string
): Promise<void> {
  const { error } = await supabase
    .from("companion_observations")
    .update({ user_response: userResponse, acknowledged: true })
    .eq("id", observation.id)
  if (error) throw error
}

// Plain acknowledgement, no response text — the panel's per-card close
// button on every type, and the only action pattern/first_time cards offer.
// Matters beyond the UI: detectHardMoment (companion-triggers.ts) refuses a
// new 'pattern' observation while an existing one is unacknowledged, so
// closing a pattern card here is what lets detection surface the next one.
export async function acknowledgeObservation(observation: Pick<CompanionObservation, "id">): Promise<void> {
  const { error } = await supabase.from("companion_observations").update({ acknowledged: true }).eq("id", observation.id)
  if (error) throw error
}
