import { useState } from "react"

export type ActiveNudge = "soft_exit" | "soft_enter" | "gratitude" | "push" | "wrapped_teaser" | null

export interface UseNudgeArbitrationResult {
  activeNudge: ActiveNudge
  setGratitudeNudgeWants: (wants: boolean) => void
  setPushNudgeWants: (wants: boolean) => void
}

// Extracted from src/pages/home.tsx. At most one nudge shown per Home visit
// (CircleInviteNudge is exempt — a real pending action from a friend, not a
// discretionary engagement nudge, so it's rendered separately outside this
// arbitration). GratitudeReminderCard and PushNudge decide their own
// eligibility internally and report back via onVisibilityChange; this hook
// just picks which one (if any) actually wins the slot, in priority order:
// an active Soft Mode transition matters more than a habit reminder, which
// matters more than the purely cosmetic Wrapped teaser.
export function useNudgeArbitration(showSoftEnterNudge: boolean, showSoftExitNudge: boolean, showWrappedTeaser: boolean): UseNudgeArbitrationResult {
  const [gratitudeNudgeWants, setGratitudeNudgeWants] = useState(false)
  const [pushNudgeWants, setPushNudgeWants] = useState(false)

  const activeNudge: ActiveNudge = showSoftExitNudge
    ? "soft_exit"
    : showSoftEnterNudge
      ? "soft_enter"
      : gratitudeNudgeWants
        ? "gratitude"
        : pushNudgeWants
          ? "push"
          : showWrappedTeaser
            ? "wrapped_teaser"
            : null

  return { activeNudge, setGratitudeNudgeWants, setPushNudgeWants }
}
