import { supabase } from "@/lib/supabase"
import type { Compass, CompassGoal } from "@/types"

// The value tags offered in Compass. Canonical English strings — stored
// verbatim in user_compass.value_tags (text[], not an enum), displayed via
// t(`compass.values.<lowercased>`). Extending this list needs a matching
// key in compass.values (en + sw) but no migration. Spec section 3.
export const COMPASS_VALUES = [
  "Curiosity",
  "Creativity",
  "Kindness",
  "Freedom",
  "Growth",
  "Impact",
  "Calm",
  "Connection",
  "Honesty",
  "Adventure",
  "Balance",
  "Presence",
] as const

export type CompassValue = (typeof COMPASS_VALUES)[number]

// Soft caps — generous enough to never get in the way of a genuine answer,
// there only to stop a runaway paste. No minimums, no "fill this in" gate.
export const MAX_VISION_LENGTH = 600
export const MAX_GOAL_LENGTH = 120
export const MAX_FUTURE_SELF_LENGTH = 400

export interface CompassDraft {
  value_tags: string[]
  vision: string
  goals: CompassGoal[]
  future_self: string
}

export const EMPTY_COMPASS_DRAFT: CompassDraft = {
  value_tags: [],
  vision: "",
  goals: [],
  future_self: "",
}

export function newGoal(text = ""): CompassGoal {
  return {
    id: crypto.randomUUID(),
    text: text.trim().slice(0, MAX_GOAL_LENGTH),
    created_at: new Date().toISOString(),
  }
}

export function compassToDraft(compass: Compass | null): CompassDraft {
  if (!compass) return { ...EMPTY_COMPASS_DRAFT }
  return {
    value_tags: compass.value_tags ?? [],
    vision: compass.vision ?? "",
    goals: compass.goals ?? [],
    future_self: compass.future_self ?? "",
  }
}

// Read the user's Compass. Returns null when they've never saved one —
// callers render the empty editor in that case, never an error.
export async function getCompass(userId: string): Promise<Compass | null> {
  const { data, error } = await supabase
    .from("user_compass")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw error
  return (data as Compass | null) ?? null
}

// Explicit save (never called on a timer — the user always taps Save).
// Upserts on user_id, so the first save creates the row and every later
// one replaces it: no way to end up with duplicates. Blank goal rows the
// user added but never filled are dropped here rather than persisted.
export async function saveCompass(userId: string, draft: CompassDraft): Promise<Compass> {
  const payload = {
    user_id: userId,
    value_tags: draft.value_tags,
    vision: draft.vision.trim().slice(0, MAX_VISION_LENGTH),
    goals: draft.goals
      .map((g) => ({ ...g, text: g.text.trim().slice(0, MAX_GOAL_LENGTH) }))
      .filter((g) => g.text.length > 0),
    future_self: draft.future_self.trim().slice(0, MAX_FUTURE_SELF_LENGTH),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from("user_compass")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single()

  if (error) throw error
  return data as Compass
}
