import { supabase } from "@/lib/supabase"
import { CircleError } from "@/lib/circle"
import type { CircleWeeklyRitual, CircleWeeklyRitualHistoryEntry } from "@/types"

// Fixed rotation, one prompt per ISO week (Monday reset, for free — see the
// migration). Kept in sync BY HAND with the identical array in
// supabase/migrations/20260915120000_create_circle_weekly_ritual.sql's
// circle_current_weekly_prompt_key() — same convention as this schema's
// other fixed lists (e.g. COMPASS_VALUES / circle_shared_intentions).
// Text lives here (i18n-resolved via circle.weekly_ritual.prompts.<key>),
// the database only ever stores the key.
export const WEEKLY_RITUAL_PROMPT_KEYS = [
  "aligned_moment",
  "small_help",
  "proud_of",
  "let_go",
  "unexpected_good",
  "leaning_on",
  "brave_moment",
  "grateful_for",
] as const

export type WeeklyRitualPromptKey = (typeof WEEKLY_RITUAL_PROMPT_KEYS)[number]

export const MAX_WEEKLY_RITUAL_RESPONSE_LENGTH = 300

function toCircleError(error: { message?: string } | null): CircleError {
  return new CircleError(error?.message || "unknown_error")
}

interface WeeklyRitualJson {
  prompt_id: string
  week_key: string
  prompt_key: string
  my_response: string | null
  other_answered: boolean | null
  revealed: boolean
  responses: { user_id: string; response: string }[] | null
}

function fromJson(json: WeeklyRitualJson): CircleWeeklyRitual {
  return {
    promptId: json.prompt_id,
    weekKey: json.week_key,
    promptKey: json.prompt_key,
    myResponse: json.my_response,
    otherAnswered: json.other_answered,
    revealed: json.revealed,
    responses: json.responses ? json.responses.map((r) => ({ userId: r.user_id, response: r.response })) : null,
  }
}

// Get-or-creates this week's prompt with p_friend_id and returns the ritual
// state from the caller's point of view. Never carries the friend's answer
// (or even whether she's answered) until the caller has submitted her own —
// enforced server-side, see the migration.
export async function getWeeklyRitual(friendId: string): Promise<CircleWeeklyRitual> {
  const { data, error } = await supabase.rpc("circle_get_weekly_ritual", { p_friend_id: friendId })
  if (error) throw toCircleError(error)
  return fromJson(data as WeeklyRitualJson)
}

export async function submitWeeklyRitualResponse(friendId: string, response: string): Promise<CircleWeeklyRitual> {
  const { data, error } = await supabase.rpc("circle_submit_weekly_response", {
    p_friend_id: friendId,
    p_response: response,
  })
  if (error) throw toCircleError(error)
  return fromJson(data as WeeklyRitualJson)
}

// Past weeks, fully revealed only — see the migration's own comment on why
// a half-answered week never appears here.
export async function getWeeklyRitualHistory(friendId: string): Promise<CircleWeeklyRitualHistoryEntry[]> {
  const { data, error } = await supabase.rpc("circle_get_weekly_ritual_history", { p_friend_id: friendId })
  if (error) throw toCircleError(error)
  return ((data ?? []) as { week_key: string; prompt_key: string; my_response: string; friend_response: string; created_at: string }[]).map(
    (r) => ({
      weekKey: r.week_key,
      promptKey: r.prompt_key,
      myResponse: r.my_response,
      friendResponse: r.friend_response,
      createdAt: r.created_at,
    })
  )
}
