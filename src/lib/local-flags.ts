// Central registry for the "have I already shown/dismissed this today"
// localStorage markers scattered across the app — jar prompt, Soft Mode
// nudge dismissals, the anchor-completion confetti flag. Same key shape
// (`${base}_${userId}_${day}`, plain "true" string) these already used
// before being consolidated here, so existing flags already set on real
// devices stay valid — no migration needed.
//
// Two other localStorage helpers exist for different concerns, not
// superseded by this one: src/lib/user-storage.ts's getUserLocalData/
// setUserLocalData (JSON values, user-scoped only, no day) and
// src/lib/offline-sync.ts's getLocalData/setLocalData (JSON data mirrors
// like `anchor_<userId>_<date>`, key built by the caller).

function dailyFlagKey(base: string, userId: string | undefined, day: string): string {
  return `${base}_${userId}_${day}`
}

export function isDailyFlagSet(base: string, userId: string | undefined, day: string): boolean {
  return !!localStorage.getItem(dailyFlagKey(base, userId, day))
}

export function setDailyFlag(base: string, userId: string | undefined, day: string): void {
  localStorage.setItem(dailyFlagKey(base, userId, day), "true")
}

// Every daily flag base key this app uses, in one place — grep this file
// instead of the whole codebase to see what "seen today" markers exist.
export const DAILY_FLAGS = {
  jarPromptShown: "anchor_jar_prompt_shown",
  softEnterDismissed: "anchor_soft_enter_dismissed",
  softExitDismissed: "anchor_soft_exit_dismissed",
  anchorsCelebrated: "anchor_celebrated",
} as const
