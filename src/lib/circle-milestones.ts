import { supabase } from "@/lib/supabase"
import { CircleError } from "@/lib/circle"
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"
import type { CircleMilestone } from "@/types"

const SEEN_KEY_BASE = "anchor_circle_milestones_seen"

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

// MISSION 4 — recent (7d) milestones reached by active circle friends.
export async function getRecentCircleMilestones(): Promise<CircleMilestone[]> {
  const { data, error } = await supabase.rpc("circle_get_recent_milestones")
  if (error) throw toCircleError(error)
  return (data ?? []) as CircleMilestone[]
}

// Dismissal ("seen") is purely local — celebrating must never become an
// obligation, so there's no server-side ack, just "don't show me this
// specific one again on this device." Same convention as
// anchor_streak_milestones_celebrated (use-daily-cycle.ts).
function seenKey(friendId: string, milestone: number): string {
  return `${friendId}:${milestone}`
}

export function filterUnseenMilestones(userId: string, milestones: CircleMilestone[]): CircleMilestone[] {
  const seen = new Set(getUserLocalData<string[]>(SEEN_KEY_BASE, userId) ?? [])
  return milestones.filter((m) => !seen.has(seenKey(m.friend_id, m.milestone)))
}

export function markMilestoneSeen(userId: string, milestone: CircleMilestone): void {
  const seen = new Set(getUserLocalData<string[]>(SEEN_KEY_BASE, userId) ?? [])
  seen.add(seenKey(milestone.friend_id, milestone.milestone))
  setUserLocalData(SEEN_KEY_BASE, userId, [...seen])
}
