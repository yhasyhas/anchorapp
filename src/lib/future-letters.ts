// Pure helpers for the "write to your future self" feature — shared by the
// write flow, the waiting/archive lists on the Letters page, and the open
// ritual. Content itself never passes through here (see FutureLetter's own
// comment in src/types/index.ts): this file only ever handles dates/labels.

import { addMonths, differenceInCalendarDays } from "date-fns"
import { localDateStr } from "@/lib/utils"

export const MAX_PENDING_LETTERS = 3

export type LetterDurationMonths = 1 | 3

// Delivery date is computed from HER local calendar day (not UTC) — same
// convention as every other "today" in this app (see localDateStr's own
// comment in utils.ts).
export function computeDeliverOn(months: LetterDurationMonths): string {
  return localDateStr(addMonths(new Date(), months))
}

export function daysUntil(deliverOn: string): number {
  const target = new Date(`${deliverOn}T00:00:00`)
  const today = new Date(`${localDateStr()}T00:00:00`)
  return Math.max(0, differenceInCalendarDays(target, today))
}

export function isDue(deliverOn: string): boolean {
  return deliverOn <= localDateStr()
}

export function daysAgo(writtenAt: string): number {
  return Math.max(0, differenceInCalendarDays(new Date(), new Date(writtenAt)))
}

export function formatDeliverOn(deliverOn: string, lang: string): string {
  const locale = lang === "sw" ? "sw-TZ" : "en-US"
  const date = new Date(`${deliverOn}T00:00:00`)
  return date.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" })
}
