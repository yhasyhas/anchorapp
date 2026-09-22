import { useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { runCompanionObservationGenerationOncePerDay } from "@/lib/companion-generation"
import { isOnline } from "@/lib/offline-sync"

// Silent, data-only: fills in generated_text on any Companion observation
// still waiting for it, and companion_text on this week's weekly_reviews
// row if one qualifies, when Home mounts (see src/lib/companion-generation.ts
// for the fetch -> safety-filter -> generate -> store pass). Renders
// nothing, never surfaces an error to her. Deliberately a separate hook from
// useCompanionDetection rather than folded into it — detection and
// generation are two different failure/retry stories (a failed detection
// pass should retry sooner than a failed Anthropic call), and this mirrors
// the module split between companion-detection.ts and
// companion-generation.ts.
export function useCompanionGeneration(): void {
  const { user, profile } = useAuth()
  const userId = user?.id
  const profileCreatedAt = profile?.created_at
  // Settings' "Enable AI insights" (profiles.ai_enabled, off by default) —
  // same gate as detection, checked again here independently rather than
  // assumed from detection having run, since generation can be triggered
  // on its own.
  const aiEnabled = profile?.ai_enabled ?? false
  const language = profile?.preferred_language === "sw" ? "sw" : "en"

  useEffect(() => {
    if (!userId || !profileCreatedAt || !aiEnabled || !isOnline()) return
    runCompanionObservationGenerationOncePerDay({ userId, aiEnabled, language, profileCreatedAt }).catch((err) => {
      console.error("Companion observation generation failed:", err)
    })
    // aiEnabled is a dep so switching the toggle on while Home is mounted
    // starts a run; switching it off never does (the guard returns early).
  }, [userId, profileCreatedAt, aiEnabled, language])
}
