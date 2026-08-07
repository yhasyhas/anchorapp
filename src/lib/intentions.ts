import type { TFunction } from "i18next"
import { intentions } from "@/lib/constants"
import type { CustomIntention } from "@/types"

// A raw daily_intention value is either one of the 5 hardcoded native words
// (src/lib/constants.ts's `intentions`, stored/matched case-insensitively) or a custom
// intention's label_en (see src/lib/custom-intentions.ts — custom intentions are stored
// canonically in English, same convention as native ones).
export function isNativeIntention(raw: string | null | undefined): boolean {
  if (!raw) return false
  const lower = raw.toLowerCase()
  return intentions.some((i) => i.toLowerCase() === lower)
}

export function findCustomIntention(
  raw: string | null | undefined,
  customIntentions: CustomIntention[]
): CustomIntention | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  return customIntentions.find((c) => c.label_en.toLowerCase() === lower) ?? null
}

// Resolves a raw stored intention value to a display label in the given language — native
// intentions go through i18next as before, customs use their own stored translation, and
// anything unrecognized (e.g. a since-archived custom, or legacy data) falls back to the
// raw text itself rather than showing a broken i18n key.
export function resolveIntentionLabel(
  t: TFunction,
  raw: string | null | undefined,
  language: "en" | "sw",
  customIntentions: CustomIntention[]
): string | null {
  if (!raw) return null
  if (isNativeIntention(raw)) {
    return t(`intentions.${raw.toLowerCase()}`)
  }
  const custom = findCustomIntention(raw, customIntentions)
  if (custom) {
    return language === "sw" ? custom.label_sw : custom.label_en
  }
  return raw
}

export interface SelectableIntention {
  value: string
  label: string
  isCustom: boolean
}

// The full picker list for Home: native intentions first (unchanged order), then active
// customs — each already resolved to a display label so callers don't repeat the
// native-vs-custom branching themselves.
export function buildSelectableIntentions(
  t: TFunction,
  language: "en" | "sw",
  customIntentions: CustomIntention[]
): SelectableIntention[] {
  const native = intentions.map((i) => ({ value: i, label: t(`intentions.${i.toLowerCase()}`), isCustom: false }))
  const custom = customIntentions.map((c) => ({
    value: c.label_en,
    label: language === "sw" ? c.label_sw : c.label_en,
    isCustom: true,
  }))
  return [...native, ...custom]
}
