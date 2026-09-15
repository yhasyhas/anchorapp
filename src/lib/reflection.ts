import { supabase } from "@/lib/supabase"
import type { Reflection } from "@/types"

// Soft caps — generous enough to never get in the way of a genuine answer,
// there only to stop a runaway paste. No minimums, no "fill this in" gate.
// Same reasoning as src/lib/compass.ts's MAX_* constants.
export const MAX_REFLECTION_FIELD_LENGTH = 500

export interface ReflectionDraft {
  meaningful_today: string
  learned_today: string
  better_tomorrow: string
}

export const EMPTY_REFLECTION_DRAFT: ReflectionDraft = {
  meaningful_today: "",
  learned_today: "",
  better_tomorrow: "",
}

export function reflectionToDraft(reflection: Reflection | null): ReflectionDraft {
  if (!reflection) return { ...EMPTY_REFLECTION_DRAFT }
  return {
    meaningful_today: reflection.meaningful_today ?? "",
    learned_today: reflection.learned_today ?? "",
    better_tomorrow: reflection.better_tomorrow ?? "",
  }
}

// Read a single day's reflection. Returns null when none was ever saved —
// callers render the empty/offer state in that case, never an error.
export async function getReflection(userId: string, date: string): Promise<Reflection | null> {
  const { data, error } = await supabase
    .from("reflections")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle()

  if (error) throw error
  return (data as Reflection | null) ?? null
}

// Every reflection ever saved, most recent first — backs the simple
// "past reflections" list (Hub → Reflections). No pagination per spec;
// capped at 100 as a sane ceiling rather than fetching an unbounded table.
export async function getReflectionHistory(userId: string): Promise<Reflection[]> {
  const { data, error } = await supabase
    .from("reflections")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(100)

  if (error) throw error
  return (data as Reflection[]) ?? []
}

// Explicit save (never on a timer — the user always taps Save, same as
// Compass). Upserts on (user_id, date): the first save of the day creates
// the row, every later one that same day replaces it.
export async function saveReflection(userId: string, date: string, draft: ReflectionDraft): Promise<Reflection> {
  const payload = {
    user_id: userId,
    date,
    meaningful_today: draft.meaningful_today.trim().slice(0, MAX_REFLECTION_FIELD_LENGTH),
    learned_today: draft.learned_today.trim().slice(0, MAX_REFLECTION_FIELD_LENGTH),
    better_tomorrow: draft.better_tomorrow.trim().slice(0, MAX_REFLECTION_FIELD_LENGTH),
  }

  const { data, error } = await supabase
    .from("reflections")
    .upsert(payload, { onConflict: "user_id,date" })
    .select()
    .single()

  if (error) throw error
  return data as Reflection
}
