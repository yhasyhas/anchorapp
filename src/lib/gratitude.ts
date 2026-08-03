import { supabase } from "@/lib/supabase"
import { localDateStr } from "@/lib/utils"
import type { Gratitude, MoodLog, MoodType } from "@/types"

const LOW_MOODS = new Set(["low", "stressed"])
const MAX_GRATITUDE_LENGTH = 140

export async function addGratitude(text: string): Promise<Gratitude> {
  const trimmed = text.trim().slice(0, MAX_GRATITUDE_LENGTH)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("not_authenticated")

  const { data, error } = await supabase
    .from("gratitudes")
    .insert({ user_id: user.id, text: trimmed })
    .select()
    .single()

  if (error) throw error
  return data as Gratitude
}

export async function listGratitudes(limit: number, offset: number): Promise<Gratitude[]> {
  const { data, error } = await supabase
    .from("gratitudes")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error
  return (data ?? []) as Gratitude[]
}

export async function countGratitudes(): Promise<number> {
  const { count, error } = await supabase.from("gratitudes").select("id", { count: "exact", head: true })
  if (error) throw error
  return count ?? 0
}

// Jar entries are short single lines, so fetching the full history to
// shuffle client-side (rather than a random-order query) is the simplest
// option and stays consistent with how this app already fetches other
// small per-user tables in full (move_suggestions, a check-in window).
export async function getAllGratitudesForReveal(): Promise<Gratitude[]> {
  const { data, error } = await supabase.from("gratitudes").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as Gratitude[]
}

export async function getLastGratitudeDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from("gratitudes")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data?.created_at ? localDateStr(new Date(data.created_at)) : null
}

// Pure, no network — today's just-selected mood is low/stressed AND
// yesterday's logged mood (from the caller's already-loaded recentMoods)
// was too. This is the entire "2nd consecutive day" trigger for the jar
// reveal offer; nothing else about the day matters.
export function isSecondConsecutiveLowMoodDay(todayMood: MoodType, recentMoods: MoodLog[]): boolean {
  if (!LOW_MOODS.has(todayMood)) return false
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = localDateStr(yesterday)
  const yesterdayMood = recentMoods.find((m) => m.date === yesterdayStr)?.mood
  return !!yesterdayMood && LOW_MOODS.has(yesterdayMood)
}
