import { supabase } from "@/lib/supabase"
import { translateCustomIntention } from "@/lib/ai-service"
import type { CustomIntention } from "@/types"

// Max active (non-archived) custom intentions at once — keeps the Home picker from
// getting crowded alongside the 5 native ones.
export const MAX_ACTIVE_CUSTOM_INTENTIONS = 3

// Soft validation only ("1-2 mots, validation douce") — a length guard against pasting a
// whole sentence in by mistake, not a strict word-count enforcer.
const MAX_LABEL_LENGTH = 30

export class CustomIntentionValidationError extends Error {}

function validateLabel(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new CustomIntentionValidationError("empty")
  if (trimmed.length > MAX_LABEL_LENGTH) throw new CustomIntentionValidationError("too_long")
  return trimmed
}

export async function listCustomIntentions(userId: string): Promise<CustomIntention[]> {
  const { data, error } = await supabase
    .from("custom_intentions")
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data ?? []
}

// language: the language she typed the intention in (current app language) — the other
// field is filled by Groq (translateCustomIntention), or falls back to the same text.
export async function createCustomIntention(
  userId: string,
  text: string,
  language: "en" | "sw",
  aiEnabled: boolean
): Promise<CustomIntention> {
  const trimmed = validateLabel(text)

  const existing = await listCustomIntentions(userId)
  if (existing.length >= MAX_ACTIVE_CUSTOM_INTENTIONS) {
    throw new CustomIntentionValidationError("max_reached")
  }

  const { label_en, label_sw } = await translateCustomIntention(trimmed, language, aiEnabled)

  const { data, error } = await supabase
    .from("custom_intentions")
    .insert({ user_id: userId, label_en, label_sw })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCustomIntentionLabels(
  id: string,
  labels: { label_en: string; label_sw: string }
): Promise<void> {
  const label_en = validateLabel(labels.label_en)
  const label_sw = validateLabel(labels.label_sw)
  const { error } = await supabase.from("custom_intentions").update({ label_en, label_sw }).eq("id", id)
  if (error) throw error
}

export async function archiveCustomIntention(id: string): Promise<void> {
  const { error } = await supabase.from("custom_intentions").update({ is_archived: true }).eq("id", id)
  if (error) throw error
}
